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
 * ## Glossary
 *
 * `request.glossary` is honoured via {@link createDeepLGlossaryService}:
 * the service looks up or creates a DeepL glossary that matches the
 * `(from, to)` pair, caches the resulting `glossary_id` by content hash,
 * and the adapter passes it on the `/v2/translate` request. When the
 * pair is not glossary-supported by DeepL the request goes through
 * without a glossary — translation still works, just without the term
 * overrides. See ARCHITECTURE.md §4.7.
 *
 * ## Context
 *
 * `request.context` is still ignored — DeepL exposes a per-request
 * `context` field for sentence-level disambiguation, but it doesn't map
 * cleanly to "key path + description" without distorting meaning. The
 * LLM adapters use `context` instead.
 */

import { collectTextNodes } from './icu-walk.js';
import { bcp47ToDeepLSource, bcp47ToDeepLTarget } from './deepl-locales.js';
import { createDeepLGlossaryService, type DeepLGlossaryService } from './deepl-glossary.js';
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
  /**
   * Inject for tests, or to share a glossary cache across multiple adapter
   * instances. Defaults to a per-provider service derived from `apiKey`,
   * `endpoint`, and `fetch`.
   */
  readonly glossaryService?: DeepLGlossaryService;
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

  const glossaryService =
    options.glossaryService ??
    createDeepLGlossaryService({
      apiKey: options.apiKey,
      baseEndpoint: deriveBaseEndpoint(endpoint),
      fetch: fetchImpl,
    });

  return {
    id: 'deepl',
    async translate(request) {
      const collected = collectTextNodes(request.nodes);
      if (collected.texts.length === 0) {
        return request.nodes;
      }

      const glossaryId =
        request.glossary !== undefined && request.glossary.length > 0
          ? await glossaryService.ensure({
              from: request.from,
              to: request.to,
              entries: request.glossary,
            })
          : undefined;

      const body = buildBody(request, collected.texts, glossaryId);
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
  readonly glossary_id?: string;
}

function buildBody(
  request: TranslateRequest,
  texts: readonly string[],
  glossaryId: string | undefined,
): DeepLRequestBody {
  return {
    text: texts,
    source_lang: bcp47ToDeepLSource(request.from),
    target_lang: bcp47ToDeepLTarget(request.to),
    // Keeps capitalization and trailing whitespace, both of which matter
    // for fragments that sit immediately around placeholders.
    preserve_formatting: true,
    ...(glossaryId !== undefined ? { glossary_id: glossaryId } : {}),
  };
}

/**
 * The translate endpoint is `<base>/v2/translate`. Glossary endpoints
 * live under the same `<base>/v2`. We strip the trailing `/translate`
 * to derive the base — works for both the upstream URL and any
 * `/api/deepl/v2/translate` proxy shape.
 */
function deriveBaseEndpoint(translateEndpoint: string): string {
  if (translateEndpoint.endsWith('/translate')) {
    return translateEndpoint.slice(0, -'/translate'.length);
  }
  return translateEndpoint;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
