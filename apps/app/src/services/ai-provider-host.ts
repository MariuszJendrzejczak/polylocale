/**
 * Lazy AI-provider host for the editor.
 *
 * Wraps the secret store and one or more provider gates behind a single
 * `getProvider()` call. The first invocation may pop two modals — passphrase
 * (to unlock the secret store) and API key (to populate the slot when empty);
 * later calls return a cached `AIProvider` instance until either `reset()` is
 * called explicitly or the secret store is locked again.
 *
 * v1 hard-codes DeepL. The `buildProvider` dependency is the only thing that
 * needs to change when Session 8 adds per-locale provider selection — call
 * sites stay on `host.getProvider()`.
 *
 * The default endpoint points at `/api/deepl/v2/translate` so the Vite dev
 * proxy and any production same-origin proxy carry the request without a
 * direct CORS-blocked browser → DeepL hop (see ARCHITECTURE.md §4.3).
 */

import { createDeepLProvider, type AIProvider } from '@polylocale/ai';

import type { SecretStore } from './secret-store.js';

const DEEPL_KEY_SLOT = 'deepl-api-key';
const DEFAULT_DEEPL_ENDPOINT = '/api/deepl/v2/translate';

export interface AIProviderHost {
  getProvider(): Promise<AIProvider | null>;
  /** Drops the cached provider; the next `getProvider()` rebuilds it. */
  reset(): void;
}

export interface AIProviderHostDeps {
  readonly secretStore: SecretStore;
  /** Resolves true on successful unlock, false when the user cancels. */
  readonly requestUnlock: () => Promise<boolean>;
  /** Resolves true after the api-key slot is populated, false when cancelled. */
  readonly requestApiKey: () => Promise<boolean>;
  /** Override for tests; production wires `createDeepLProvider`. */
  readonly buildProvider?: (apiKey: string) => AIProvider;
}

export function createAIProviderHost(deps: AIProviderHostDeps): AIProviderHost {
  const buildProvider = deps.buildProvider ?? defaultBuildProvider;
  let cached: { readonly apiKey: string; readonly provider: AIProvider } | undefined;

  return {
    async getProvider() {
      if (!deps.secretStore.isUnlocked()) {
        const ok = await deps.requestUnlock();
        if (!ok) return null;
      }
      let apiKey = await deps.secretStore.get(DEEPL_KEY_SLOT);
      if (apiKey === undefined) {
        const ok = await deps.requestApiKey();
        if (!ok) return null;
        apiKey = await deps.secretStore.get(DEEPL_KEY_SLOT);
        if (apiKey === undefined) return null;
      }
      if (cached !== undefined && cached.apiKey === apiKey) return cached.provider;
      const provider = buildProvider(apiKey);
      cached = { apiKey, provider };
      return provider;
    },
    reset() {
      cached = undefined;
    },
  };
}

function defaultBuildProvider(apiKey: string): AIProvider {
  return createDeepLProvider({ apiKey, endpoint: DEFAULT_DEEPL_ENDPOINT });
}

export const __test = { DEEPL_KEY_SLOT, DEFAULT_DEEPL_ENDPOINT };
