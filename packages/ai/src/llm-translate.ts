/**
 * Shared LLM translation helper.
 *
 * Provider-agnostic: takes the ordered list of text fragments produced by
 * {@link collectTextNodes}, hands them to a provider-supplied {@link LlmChat}
 * callable as a strict JSON-shaped prompt, and returns the translated
 * fragments in the same order. The caller (each LLM adapter) wraps the
 * `LlmChat` around its own HTTP shape — masking, validation, and the
 * over-the-cap split happen in this one place.
 *
 * ## Prompt contract (system → user)
 *
 * The system prompt nails the output shape: a single JSON object
 * `{translations: string[]}` of identical length to the input array, in
 * order, with whitespace and punctuation preserved. The user prompt is
 * the literal JSON `{from, to, fragments}`. The response is parsed and
 * validated; anything that doesn't match throws {@link LLMResponseError}
 * so the orchestrator can surface a structured failure.
 *
 * ## Why the cap
 *
 * One AIProvider call always equals one input IR (see ARCHITECTURE.md
 * §4). For pathological keys with many text fragments (a `select` with
 * dozens of cases, each carrying multiple text spans), we split the
 * fragment list into chunks of {@link MAX_FRAGMENTS_PER_CALL} and stitch
 * the results back. The split is invisible to callers — they still get
 * one ordered array out for one input array in.
 */

import type { GlossaryEntry, LocaleCode } from '@polylocale/core';

import { LLMResponseError, type TranslateContext } from './provider.js';

export interface LlmChatRequest {
  readonly system: string;
  readonly user: string;
}

/**
 * Provider-supplied callable. Receives a system + user pair, returns the
 * raw assistant message text. The helper does the JSON parsing and
 * validation; the chat function only has to talk to the API.
 */
export type LlmChat = (req: LlmChatRequest) => Promise<string>;

export interface LlmTranslateOptions {
  readonly fragments: readonly string[];
  readonly from: LocaleCode;
  readonly to: LocaleCode;
  /** Provider id used in {@link LLMResponseError} messages. */
  readonly providerId: string;
  readonly chat: LlmChat;
  readonly glossary?: readonly GlossaryEntry[];
  readonly context?: TranslateContext;
}

/** Hard cap per request; over this we split into multiple chat calls. */
export const MAX_FRAGMENTS_PER_CALL = 100;

export async function llmTranslateFragments(
  options: LlmTranslateOptions,
): Promise<readonly string[]> {
  if (options.fragments.length === 0) return [];

  if (options.fragments.length <= MAX_FRAGMENTS_PER_CALL) {
    return runOneChunk(options, options.fragments);
  }

  const chunks: string[] = [];
  for (let i = 0; i < options.fragments.length; i += MAX_FRAGMENTS_PER_CALL) {
    const slice = options.fragments.slice(i, i + MAX_FRAGMENTS_PER_CALL);
    const out = await runOneChunk(options, slice);
    chunks.push(...out);
  }
  return chunks;
}

async function runOneChunk(
  options: LlmTranslateOptions,
  fragments: readonly string[],
): Promise<readonly string[]> {
  const system = buildSystemPrompt(options);
  const user = JSON.stringify({
    from: options.from,
    to: options.to,
    fragments,
  });
  const raw = await options.chat({ system, user });
  return parseAndValidate(raw, fragments.length, options.providerId);
}

function buildSystemPrompt(options: LlmTranslateOptions): string {
  const lines = [
    'You are a localization translator that preserves message structure exactly.',
    'You will receive a JSON object {from, to, fragments}.',
    'Translate every element of `fragments` from `from` to `to`.',
    'Return a single JSON object {"translations": string[]} of identical length and order.',
    'Preserve leading and trailing whitespace verbatim.',
    'Never add, remove, merge, or split fragments.',
    'If a fragment is purely whitespace or punctuation, return it unchanged.',
    'Do not output any text outside the JSON object.',
  ];

  if (options.context !== undefined) {
    lines.push(`Key path: ${options.context.keyPath}`);
    if (options.context.description !== undefined) {
      lines.push(`Description: ${options.context.description}`);
    }
  }

  if (options.glossary !== undefined && options.glossary.length > 0) {
    const terms = collectGlossaryHints(options.glossary, options.to);
    if (terms.length > 0) {
      lines.push(
        'Glossary (apply when the source term appears verbatim, otherwise translate normally):',
        ...terms,
      );
    }
  }

  return lines.join('\n');
}

function collectGlossaryHints(
  entries: readonly GlossaryEntry[],
  to: LocaleCode,
): readonly string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const target = entry.perLocale[to];
    if (target === undefined) continue;
    if (target.doNotTranslate === true) {
      out.push(`- "${entry.term}" → keep as "${entry.term}" (do not translate)`);
    } else if (target.translation !== undefined && target.translation.length > 0) {
      out.push(`- "${entry.term}" → "${target.translation}"`);
    }
  }
  return out;
}

function parseAndValidate(
  raw: string,
  expectedLength: number,
  providerId: string,
): readonly string[] {
  const trimmed = raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new LLMResponseError(providerId, 'response was not valid JSON', trimmed);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LLMResponseError(providerId, 'response was not a JSON object', trimmed);
  }
  const translations = (parsed as { translations?: unknown }).translations;
  if (!Array.isArray(translations)) {
    throw new LLMResponseError(providerId, 'response is missing a `translations` array', trimmed);
  }
  if (translations.length !== expectedLength) {
    throw new LLMResponseError(
      providerId,
      `expected ${expectedLength} translations, got ${translations.length}`,
      trimmed,
    );
  }
  for (let i = 0; i < translations.length; i++) {
    if (typeof translations[i] !== 'string') {
      throw new LLMResponseError(providerId, `translations[${i}] is not a string`, trimmed);
    }
  }
  return translations as readonly string[];
}
