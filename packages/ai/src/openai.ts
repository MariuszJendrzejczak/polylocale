/**
 * OpenAI adapter for {@link AIProvider}.
 *
 * Wraps the OpenAI Chat Completions endpoint behind the shared
 * {@link llmTranslateFragments} helper. The masking flow is identical to
 * the other adapters: collect text fragments via {@link collectTextNodes},
 * hand them to the LLM as a strict JSON-shaped prompt, and reassemble the
 * IR. Placeholders, plural offsets, selector keys, and tag names are never
 * serialised into the request body — they live only in the surrounding IR
 * the adapter walks before and after the call.
 *
 * ## Default model
 *
 * `gpt-4o-mini` (current as of 2026-05-10). Cheapest GPT-4-class model
 * available on every OpenAI account tier. Override via `model` if your
 * account has access to something cheaper (e.g. GPT-5 mini).
 *
 * ## CORS
 *
 * OpenAI returns CORS headers; calling `https://api.openai.com` directly
 * from a browser origin works without a proxy.
 *
 * ## Response shape
 *
 * The request asks for a JSON-schema-strict response, so the model returns
 * exactly `{translations: string[]}`. The helper still validates length
 * and element types — strict mode is best-effort, not a contract.
 */

import { collectTextNodes } from './icu-walk.js';
import { llmTranslateFragments, type LlmChat, type LlmChatRequest } from './llm-translate.js';
import { LLMResponseError, ProviderHttpError, type AIProvider } from './provider.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const PROVIDER_ID = 'openai';

export interface OpenAIProviderOptions {
  readonly apiKey: string;
  /** Defaults to `gpt-4o-mini`. */
  readonly model?: string;
  /** Override for proxy deployments. Defaults to OpenAI's chat completions URL. */
  readonly endpoint?: string;
  /** Inject for tests / non-browser environments; defaults to the global. */
  readonly fetch?: typeof fetch;
}

interface OpenAIResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: unknown };
  }>;
}

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'translations',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['translations'],
      properties: {
        translations: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  },
} as const;

export function createOpenAIProvider(options: OpenAIProviderOptions): AIProvider {
  if (options.apiKey.length === 0) {
    throw new Error('createOpenAIProvider: apiKey must not be empty');
  }
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'createOpenAIProvider: no fetch available — pass options.fetch in non-browser environments',
    );
  }

  const chat: LlmChat = async (req: LlmChatRequest): Promise<string> => {
    const body = {
      model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: RESPONSE_FORMAT,
      temperature: 0,
    };

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'polylocale/0.0.0',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await safeText(response);
      throw new ProviderHttpError(PROVIDER_ID, response.status, text);
    }

    const payload = (await response.json()) as OpenAIResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new LLMResponseError(
        PROVIDER_ID,
        'response had no assistant message content',
        JSON.stringify(payload).slice(0, 300),
      );
    }
    return content;
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
