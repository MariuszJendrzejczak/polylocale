/**
 * DeepL adapter for {@link AIProvider}.
 *
 * Posts collected text nodes to DeepL's `/v2/translate` endpoint as JSON,
 * receives the translations in the same order, and reassembles the ICU IR.
 * Placeholders, plural offsets, case keys, and tag names are preserved by
 * construction (see {@link collectTextNodes}); DeepL only ever sees plain
 * text.
 *
 * ## CORS
 *
 * DeepL does not return CORS headers, so calling `https://api-free.deepl.com`
 * directly from a browser origin is blocked. Two intended deployments:
 *
 *  - Node / CLI / tests: use the default endpoint as-is.
 *  - Browser: route through a same-origin proxy (Vite dev server proxy in
 *    development, self-hosted Cloudflare Worker / nginx in production) and
 *    pass that proxy URL as `endpoint`. The adapter is endpoint-agnostic.
 *
 * ## Free vs Pro
 *
 * Free-tier API keys end with `:fx`. The adapter routes them to
 * `api-free.deepl.com`; everything else goes to `api.deepl.com`. Override by
 * passing `endpoint` explicitly.
 *
 * ## Glossary / context
 *
 * Both inputs are accepted on the request shape but ignored by this adapter
 * for now. DeepL has a separate `/v2/glossaries` flow that the next session
 * can wire in without touching the {@link AIProvider} surface.
 */

import { collectTextNodes } from './icu-walk.js';
import { bcp47ToDeepLSource, bcp47ToDeepLTarget } from './deepl-locales.js';
import { ProviderHttpError, type AIProvider, type TranslateRequest } from './provider.js';

const FREE_KEY_SUFFIX = ':fx';
const FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate';
const PRO_ENDPOINT = 'https://api.deepl.com/v2/translate';

export interface DeepLProviderOptions {
  readonly apiKey: string;
  /** Override for proxy deployments; defaults derived from `apiKey` suffix. */
  readonly endpoint?: string;
  /** Inject for tests / non-browser environments; defaults to the global. */
  readonly fetch?: typeof fetch;
}

interface DeepLResponse {
  readonly translations: ReadonlyArray<{
    readonly text: string;
    readonly detected_source_language?: string;
  }>;
}

export function createDeepLProvider(options: DeepLProviderOptions): AIProvider {
  if (options.apiKey.length === 0) {
    throw new Error('createDeepLProvider: apiKey must not be empty');
  }

  const endpoint = options.endpoint ?? defaultEndpointFor(options.apiKey);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'createDeepLProvider: no fetch available — pass options.fetch in non-browser environments',
    );
  }

  return {
    id: 'deepl',
    async translate(request) {
      const collected = collectTextNodes(request.nodes);
      if (collected.texts.length === 0) {
        return request.nodes;
      }

      const body = buildBody(request, collected.texts);
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${options.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'polylocale/0.0.0',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await safeText(response);
        throw new ProviderHttpError('deepl', response.status, text);
      }

      const payload = (await response.json()) as DeepLResponse;
      const translations = payload.translations.map((t) => t.text);
      if (translations.length !== collected.texts.length) {
        throw new Error(
          `deepl: response carried ${translations.length} translations for ${collected.texts.length} inputs`,
        );
      }

      return collected.reassemble(translations);
    },
  };
}

function defaultEndpointFor(apiKey: string): string {
  return apiKey.endsWith(FREE_KEY_SUFFIX) ? FREE_ENDPOINT : PRO_ENDPOINT;
}

interface DeepLRequestBody {
  readonly text: readonly string[];
  readonly source_lang: string;
  readonly target_lang: string;
  readonly preserve_formatting: boolean;
}

function buildBody(request: TranslateRequest, texts: readonly string[]): DeepLRequestBody {
  return {
    text: texts,
    source_lang: bcp47ToDeepLSource(request.from),
    target_lang: bcp47ToDeepLTarget(request.to),
    // Keeps capitalization and trailing whitespace, both of which matter
    // for fragments that sit immediately around placeholders.
    preserve_formatting: true,
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
