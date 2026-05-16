/**
 * Network mocks for the three AI providers polylocale supports.
 *
 * Every scenario under Groups C, D, E goes through this helper. It
 * intercepts the real provider URLs at the Playwright network layer,
 * answers with a deterministic suffix-based transformation, and records
 * every request so the test can assert on what the SPA actually sent.
 *
 * Why one helper, not per-test `page.route`:
 *
 * - The deterministic transformation lives in one place, so two
 *   scenarios that translate the same fragment always see the same
 *   answer. Drift between specs is impossible.
 * - The response shape mirrors the real provider contracts byte-for-byte
 *   (DeepL `{translations:[{text}]}`, OpenAI Chat Completions wrapped
 *   `{choices:[{message:{content: <JSON string>}}]}`, Anthropic Messages
 *   `{content:[{type:'text', text: <JSON string>}]}`). A mock that
 *   diverges is a test pretending to test what it doesn't.
 * - The helper returns a handle the test can read at the end to inspect
 *   per-provider request counts, bodies, and the most-recent request.
 *
 * The transformation: for each input text fragment `s`, the mock returns
 * `${s} [${targetLocale}]`. Whitespace-only fragments pass through
 * unchanged — the LLM prompt explicitly asks for that, and DeepL behaves
 * the same way on punctuation-only inputs, so the mock honours both.
 */

import type { Page, Request, Route } from '@playwright/test';

export interface MockProvidersOptions {
  /** Mock DeepL `/v2/translate` (and `/v2/glossary-language-pairs`). */
  readonly deepl?: boolean;
  /** Mock OpenAI `/v1/chat/completions`. */
  readonly openai?: boolean;
  /** Mock Anthropic `/v1/messages`. */
  readonly anthropic?: boolean;
  /**
   * Mock DeepL glossary endpoints. Defaults to `false`. When true, the
   * `/v2/glossary-language-pairs` response declares `EN→PL` (and a few
   * others) as glossary-supported, and `/v2/glossaries` answers create /
   * list calls with a fake `glossary_id`. E1 turns this on; the C/D
   * scenarios leave it off because no scenario configures a glossary.
   */
  readonly glossary?: boolean;
}

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  /**
   * The parsed request body when it is valid JSON, otherwise the raw
   * string. Tests assert on shape (e.g. DeepL `target_lang`, OpenAI
   * `model`) without re-parsing.
   */
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

export interface MockProvidersHandle {
  /** All requests intercepted, in arrival order. */
  readonly all: () => readonly RecordedRequest[];
  /** Requests scoped to one provider. */
  readonly deepl: () => readonly RecordedRequest[];
  readonly openai: () => readonly RecordedRequest[];
  readonly anthropic: () => readonly RecordedRequest[];
  /** Last `/v2/translate`, `/chat/completions`, or `/messages` request seen. */
  readonly lastTranslate: () => RecordedRequest | undefined;
}

const DEEPL_TRANSLATE_GLOB = '**/v2/translate';
const DEEPL_GLOSSARY_PAIRS_GLOB = '**/v2/glossary-language-pairs';
const DEEPL_GLOSSARIES_GLOB = '**/v2/glossaries**';
const OPENAI_CHAT_GLOB = '**/v1/chat/completions';
const ANTHROPIC_MESSAGES_GLOB = '**/v1/messages';

/**
 * Wire `page.route` handlers for the requested providers and return a
 * handle for post-hoc assertions. Idempotent — calling it twice on the
 * same page just layers a second set of handlers, so per-`beforeEach`
 * usage is safe.
 */
export async function mockProviders(
  page: Page,
  opts: MockProvidersOptions = {},
): Promise<MockProvidersHandle> {
  const recorded: RecordedRequest[] = [];

  function classify(req: RecordedRequest): 'deepl' | 'openai' | 'anthropic' | null {
    if (req.url.includes('/v2/translate')) return 'deepl';
    if (req.url.includes('/v2/glossar')) return 'deepl';
    if (req.url.includes('/v1/chat/completions')) return 'openai';
    if (req.url.includes('/v1/messages')) return 'anthropic';
    return null;
  }

  function record(request: Request): RecordedRequest {
    const rec: RecordedRequest = {
      url: request.url(),
      method: request.method(),
      body: safeJson(request.postData()),
      headers: request.headers(),
    };
    recorded.push(rec);
    return rec;
  }

  if (opts.deepl !== false) {
    await page.route(DEEPL_TRANSLATE_GLOB, async (route) => {
      const rec = record(route.request());
      await respondDeepLTranslate(route, rec);
    });
    await page.route(DEEPL_GLOSSARY_PAIRS_GLOB, async (route) => {
      record(route.request());
      await respondGlossaryPairs(route, opts.glossary === true);
    });
    await page.route(DEEPL_GLOSSARIES_GLOB, async (route) => {
      record(route.request());
      await respondGlossariesEndpoint(route, opts.glossary === true);
    });
  }

  if (opts.openai !== false) {
    await page.route(OPENAI_CHAT_GLOB, async (route) => {
      const rec = record(route.request());
      await respondOpenAIChat(route, rec);
    });
  }

  if (opts.anthropic !== false) {
    await page.route(ANTHROPIC_MESSAGES_GLOB, async (route) => {
      const rec = record(route.request());
      await respondAnthropicMessages(route, rec);
    });
  }

  return {
    all: () => recorded.slice(),
    deepl: () => recorded.filter((r) => classify(r) === 'deepl'),
    openai: () => recorded.filter((r) => classify(r) === 'openai'),
    anthropic: () => recorded.filter((r) => classify(r) === 'anthropic'),
    lastTranslate: () => {
      for (let i = recorded.length - 1; i >= 0; i--) {
        const r = recorded[i]!;
        if (
          r.url.includes('/v2/translate') ||
          r.url.includes('/v1/chat/completions') ||
          r.url.includes('/v1/messages')
        ) {
          return r;
        }
      }
      return undefined;
    },
  };
}

/**
 * Deterministic, per-target-locale transformation. The same fragment
 * always becomes the same translated string, scenarios stay
 * order-independent, and the suffix makes a quick visual inspection of
 * the DOM trivial. Whitespace fragments are returned untouched (matches
 * the real LLM contract and DeepL behaviour on punctuation).
 */
export function fakeTranslate(fragment: string, target: string): string {
  if (fragment.trim() === '') return fragment;
  return `${fragment} [${target}]`;
}

async function respondDeepLTranslate(route: Route, rec: RecordedRequest): Promise<void> {
  const body = (rec.body as Partial<{ text: unknown; target_lang: unknown }>) ?? {};
  const text = Array.isArray(body.text) ? (body.text as readonly unknown[]) : [];
  const target = typeof body.target_lang === 'string' ? body.target_lang : 'XX';
  const translations = text.map((t) => ({
    text: fakeTranslate(typeof t === 'string' ? t : String(t), target),
    detected_source_language: 'EN',
  }));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ translations }),
  });
}

async function respondGlossaryPairs(route: Route, enabled: boolean): Promise<void> {
  const supported_languages = enabled
    ? [
        { source_lang: 'EN', target_lang: 'PL' },
        { source_lang: 'EN', target_lang: 'DE' },
        { source_lang: 'EN', target_lang: 'FR' },
      ]
    : [];
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supported_languages }),
  });
}

async function respondGlossariesEndpoint(route: Route, enabled: boolean): Promise<void> {
  const method = route.request().method();
  if (method === 'GET') {
    // Listing existing glossaries — return empty so the adapter creates one.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ glossaries: [] }),
    });
    return;
  }
  if (method === 'POST') {
    // Create flow — only relevant when glossary is enabled.
    if (!enabled) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'glossary mock not enabled' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        glossary_id: 'mock-glossary-id',
        name: 'polylocale:mock',
        source_lang: 'EN',
        target_lang: 'PL',
        entry_count: 1,
        ready: true,
      }),
    });
    return;
  }
  await route.fallback();
}

async function respondOpenAIChat(route: Route, rec: RecordedRequest): Promise<void> {
  const { fragments, target } = readLlmBody(rec.body);
  const translations = fragments.map((f) => fakeTranslate(f, target));
  const content = JSON.stringify({ translations });
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'mock-chatcmpl-id',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
    }),
  });
}

async function respondAnthropicMessages(route: Route, rec: RecordedRequest): Promise<void> {
  const { fragments, target } = readLlmBody(rec.body);
  const translations = fragments.map((f) => fakeTranslate(f, target));
  const content = JSON.stringify({ translations });
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'mock-msg-id',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: content }],
      stop_reason: 'end_turn',
    }),
  });
}

interface LlmCallShape {
  readonly fragments: readonly string[];
  readonly target: string;
}

/**
 * Both LLM adapters serialise the user message as a JSON string of
 * `{from, to, fragments}` (see `llm-translate.ts`). The mock recovers
 * `to` and `fragments` so it can stay symmetric with the DeepL path. If
 * the body shape ever changes, this is the single point of failure —
 * intentionally so.
 */
function readLlmBody(body: unknown): LlmCallShape {
  if (body === null || typeof body !== 'object') {
    return { fragments: [], target: 'XX' };
  }
  const messages = (body as { messages?: unknown }).messages;
  // Anthropic carries `system` at the top level and only the user message
  // inside `messages`. OpenAI carries both. In both cases the user JSON is
  // the last message with role === 'user'.
  if (!Array.isArray(messages)) return { fragments: [], target: 'XX' };
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown };
    if (m.role !== 'user') continue;
    const content = m.content;
    if (typeof content !== 'string') continue;
    try {
      const parsed = JSON.parse(content) as {
        readonly to?: unknown;
        readonly fragments?: unknown;
      };
      const target = typeof parsed.to === 'string' ? parsed.to : 'XX';
      const fragments = Array.isArray(parsed.fragments)
        ? parsed.fragments.filter((f): f is string => typeof f === 'string')
        : [];
      return { fragments, target };
    } catch {
      return { fragments: [], target: 'XX' };
    }
  }
  return { fragments: [], target: 'XX' };
}

function safeJson(raw: string | null): unknown {
  if (raw === null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
