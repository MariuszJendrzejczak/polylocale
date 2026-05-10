/**
 * Lazy AI-provider host for the editor.
 *
 * Each AI provider (DeepL, OpenAI, Anthropic) has its own slot in the
 * encrypted secret store and its own cached factory. `getProvider(id)`
 * runs two gates the first time a provider is needed — passphrase to
 * unlock the store, then API key to populate the slot if empty — and
 * caches an `AIProvider` instance per (id, apiKey) pair until either
 * `reset()` is called or the secret store is locked again.
 *
 * The default endpoint for DeepL points at the same-origin Vite dev
 * proxy (`/api/deepl/v2/translate`); OpenAI and Anthropic have proper
 * CORS so they hit their upstream endpoints directly.
 */

import {
  createAnthropicProvider,
  createDeepLProvider,
  createOpenAIProvider,
  type AIProvider,
} from '@polylocale/ai';

import type { SecretStore } from './secret-store.js';

export type ProviderId = 'deepl' | 'openai' | 'anthropic';

const DEFAULT_DEEPL_ENDPOINT = '/api/deepl/v2/translate';

interface ProviderSlot {
  readonly slot: string;
  readonly label: string;
  readonly build: (apiKey: string) => AIProvider;
}

const PROVIDER_SLOTS: Readonly<Record<ProviderId, ProviderSlot>> = {
  deepl: {
    slot: 'deepl-api-key',
    label: 'DeepL',
    build: (apiKey) => createDeepLProvider({ apiKey, endpoint: DEFAULT_DEEPL_ENDPOINT }),
  },
  openai: {
    slot: 'openai-api-key',
    label: 'OpenAI',
    build: (apiKey) => createOpenAIProvider({ apiKey }),
  },
  anthropic: {
    slot: 'anthropic-api-key',
    label: 'Anthropic',
    build: (apiKey) => createAnthropicProvider({ apiKey }),
  },
};

export const PROVIDER_IDS: readonly ProviderId[] = ['deepl', 'openai', 'anthropic'];

export function providerLabel(id: ProviderId): string {
  return PROVIDER_SLOTS[id].label;
}

export function providerSlotName(id: ProviderId): string {
  return PROVIDER_SLOTS[id].slot;
}

export interface AIProviderHost {
  getProvider(id: ProviderId): Promise<AIProvider | null>;
  /** Drops the cache for one provider; the next `getProvider(id)` rebuilds. */
  reset(id?: ProviderId): void;
}

export interface AIProviderHostDeps {
  readonly secretStore: SecretStore;
  /** Resolves true on successful unlock, false when the user cancels. */
  readonly requestUnlock: () => Promise<boolean>;
  /**
   * Resolves true after the api-key slot is populated, false when cancelled.
   * Receives the slot name and a human-friendly provider label so the prompt
   * can render "OpenAI API key" without hard-coding strings here.
   */
  readonly requestApiKey: (slot: string, providerLabel: string) => Promise<boolean>;
  /** Override for tests; production wires the per-provider factories above. */
  readonly buildProvider?: (id: ProviderId, apiKey: string) => AIProvider;
}

interface CachedProvider {
  readonly apiKey: string;
  readonly provider: AIProvider;
}

export function createAIProviderHost(deps: AIProviderHostDeps): AIProviderHost {
  const buildProvider =
    deps.buildProvider ?? ((id: ProviderId, apiKey: string) => PROVIDER_SLOTS[id].build(apiKey));
  const cached = new Map<ProviderId, CachedProvider>();

  return {
    async getProvider(id) {
      const slot = PROVIDER_SLOTS[id];
      if (!deps.secretStore.isUnlocked()) {
        const ok = await deps.requestUnlock();
        if (!ok) return null;
      }
      let apiKey = await deps.secretStore.get(slot.slot);
      if (apiKey === undefined) {
        const ok = await deps.requestApiKey(slot.slot, slot.label);
        if (!ok) return null;
        apiKey = await deps.secretStore.get(slot.slot);
        if (apiKey === undefined) return null;
      }
      const cachedFor = cached.get(id);
      if (cachedFor !== undefined && cachedFor.apiKey === apiKey) return cachedFor.provider;
      const provider = buildProvider(id, apiKey);
      cached.set(id, { apiKey, provider });
      return provider;
    },
    reset(id) {
      if (id === undefined) {
        cached.clear();
      } else {
        cached.delete(id);
      }
    },
  };
}

export const __test = {
  PROVIDER_SLOTS,
  DEFAULT_DEEPL_ENDPOINT,
};
