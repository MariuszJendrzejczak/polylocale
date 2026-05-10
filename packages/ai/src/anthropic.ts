/**
 * Anthropic adapter for {@link AIProvider}.
 *
 * Wraps the Anthropic Messages endpoint behind the shared
 * {@link llmTranslateFragments} helper. Same masking flow as the OpenAI
 * adapter: collect text fragments, hand them to the LLM as a strict
 * JSON-shaped prompt, reassemble the IR. Placeholders, plural offsets,
 * selector keys, and tag names are never serialised into the request body.
 *
 * ## Default model
 *
 * `claude-haiku-4-5-20251001` — pinned (not the rolling alias) so future
 * refreshes are deliberate. Cheapest and fastest current Claude family
 * member; matches the brief's "Haiku for speed/cost" recommendation.
 * Override via `model` if you want a stronger Sonnet-class model.
 *
 * ## CORS
 *
 * Anthropic gates browser-origin requests behind the
 * `anthropic-dangerous-direct-browser-access: true` header. We send it
 * unconditionally; in Node it's a no-op, and in the browser it allows
 * the request to leave the origin without a same-origin proxy. Users
 * who prefer a proxy can override `endpoint`.
 *
 * ## Response shape
 *
 * Anthropic's stable API returns
 * `{content: [{type: 'text', text: '...'}, ...]}`. We pull the first
 * text block and feed it to the helper, which validates the JSON shape.
 * `output_config` (the SDK's typed-output mode) is currently beta and
 * intentionally not used here.
 */

import { collectTextNodes } from './icu-walk.js';
import { llmTranslateFragments, type LlmChat, type LlmChatRequest } from './llm-translate.js';
import { LLMResponseError, ProviderHttpError, type AIProvider } from './provider.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;
const PROVIDER_ID = 'anthropic';

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  /** Defaults to `claude-haiku-4-5-20251001`. */
  readonly model?: string;
  /** Override for proxy deployments. Defaults to Anthropic's messages URL. */
  readonly endpoint?: string;
  /** Anthropic API version header. Defaults to `2023-06-01` (current stable). */
  readonly anthropicVersion?: string;
  /** Inject for tests / non-browser environments; defaults to the global. */
  readonly fetch?: typeof fetch;
}

interface AnthropicResponse {
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: unknown }>;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): AIProvider {
  if (options.apiKey.length === 0) {
    throw new Error('createAnthropicProvider: apiKey must not be empty');
  }
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL;
  const version = options.anthropicVersion ?? DEFAULT_VERSION;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'createAnthropicProvider: no fetch available — pass options.fetch in non-browser environments',
    );
  }

  const chat: LlmChat = async (req: LlmChatRequest): Promise<string> => {
    const body = {
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    };

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': options.apiKey,
        'anthropic-version': version,
        'Content-Type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
        'User-Agent': 'polylocale/0.0.0',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await safeText(response);
      throw new ProviderHttpError(PROVIDER_ID, response.status, text);
    }

    const payload = (await response.json()) as AnthropicResponse;
    const firstText = payload.content?.find((b) => b.type === 'text');
    const text = firstText?.text;
    if (typeof text !== 'string' || text.length === 0) {
      throw new LLMResponseError(
        PROVIDER_ID,
        'response had no text content block',
        JSON.stringify(payload).slice(0, 300),
      );
    }
    return text;
  };

  return {
    id: PROVIDER_ID,
    async translate(request) {
      const collected = collectTextNodes(request.nodes);
      if (collected.texts.length === 0) {
        return request.nodes;
      }
      const translated = await llmTranslateFragments({
        fragments: collected.texts,
        from: request.from,
        to: request.to,
        providerId: PROVIDER_ID,
        chat,
        ...(request.glossary !== undefined ? { glossary: request.glossary } : {}),
        ...(request.context !== undefined ? { context: request.context } : {}),
      });
      return collected.reassemble(translated);
    },
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
