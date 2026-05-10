import { describe, expect, it, vi } from 'vitest';

import type { AIProvider } from '@polylocale/ai';

import { createAIProviderHost, PROVIDER_IDS, __test, type ProviderId } from './ai-provider-host.js';
import type { SecretStore } from './secret-store.js';

const stubProvider: AIProvider = {
  id: 'stub',
  async translate({ nodes }) {
    return nodes;
  },
};

function createFakeSecretStore(): SecretStore {
  const data = new Map<string, string>();
  let unlocked = false;
  return {
    async unlock() {
      unlocked = true;
    },
    isUnlocked: () => unlocked,
    async set(name, value) {
      data.set(name, value);
    },
    async get(name) {
      return data.get(name);
    },
    async delete(name) {
      data.delete(name);
    },
    async list() {
      return [...data.keys()].sort();
    },
    async changePassphrase() {
      // No-op for the host tests — they never exercise rotation.
    },
    lock() {
      unlocked = false;
    },
  };
}

describe('createAIProviderHost', () => {
  it('declares one slot per provider', () => {
    expect(PROVIDER_IDS).toEqual(['deepl', 'openai', 'anthropic']);
    expect(__test.PROVIDER_SLOTS.deepl.slot).toBe('deepl-api-key');
    expect(__test.PROVIDER_SLOTS.openai.slot).toBe('openai-api-key');
    expect(__test.PROVIDER_SLOTS.anthropic.slot).toBe('anthropic-api-key');
  });

  it('runs both gates on first call, caches provider on second', async () => {
    const store = createFakeSecretStore();
    const requestUnlock = vi.fn(async () => {
      await store.unlock('passphrase');
      return true;
    });
    const requestApiKey = vi.fn(async (slot: string) => {
      await store.set(slot, 'free-key:fx');
      return true;
    });
    const buildProvider = vi.fn(() => stubProvider);

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    const first = await host.getProvider('deepl');
    expect(first).toBe(stubProvider);
    expect(requestUnlock).toHaveBeenCalledTimes(1);
    expect(requestApiKey).toHaveBeenCalledExactlyOnceWith('deepl-api-key', 'DeepL');
    expect(buildProvider).toHaveBeenCalledExactlyOnceWith('deepl', 'free-key:fx');

    const second = await host.getProvider('deepl');
    expect(second).toBe(stubProvider);
    expect(requestUnlock).toHaveBeenCalledTimes(1);
    expect(requestApiKey).toHaveBeenCalledTimes(1);
    expect(buildProvider).toHaveBeenCalledTimes(1);
  });

  it('returns null when the passphrase prompt is cancelled (no api-key prompt)', async () => {
    const store = createFakeSecretStore();
    const requestUnlock = vi.fn(async () => false);
    const requestApiKey = vi.fn(async () => true);
    const buildProvider = vi.fn(() => stubProvider);

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    const result = await host.getProvider('deepl');
    expect(result).toBeNull();
    expect(requestUnlock).toHaveBeenCalledTimes(1);
    expect(requestApiKey).not.toHaveBeenCalled();
    expect(buildProvider).not.toHaveBeenCalled();
  });

  it('returns null when the api-key prompt is cancelled', async () => {
    const store = createFakeSecretStore();
    const requestUnlock = vi.fn(async () => {
      await store.unlock('p');
      return true;
    });
    const requestApiKey = vi.fn(async () => false);
    const buildProvider = vi.fn(() => stubProvider);

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    const result = await host.getProvider('deepl');
    expect(result).toBeNull();
    expect(requestUnlock).toHaveBeenCalledTimes(1);
    expect(requestApiKey).toHaveBeenCalledTimes(1);
    expect(buildProvider).not.toHaveBeenCalled();
  });

  it('skips both gates when the store is already unlocked and the slot is filled', async () => {
    const store = createFakeSecretStore();
    await store.unlock('p');
    await store.set('deepl-api-key', 'pre-existing:fx');
    const requestUnlock = vi.fn(async () => true);
    const requestApiKey = vi.fn(async () => true);
    const buildProvider = vi.fn(() => stubProvider);

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    await host.getProvider('deepl');
    expect(requestUnlock).not.toHaveBeenCalled();
    expect(requestApiKey).not.toHaveBeenCalled();
    expect(buildProvider).toHaveBeenCalledExactlyOnceWith('deepl', 'pre-existing:fx');
  });

  it('reset() drops every cached provider; reset(id) drops only that one', async () => {
    const store = createFakeSecretStore();
    await store.unlock('p');
    await store.set('deepl-api-key', 'd:fx');
    await store.set('openai-api-key', 'sk-x');
    const requestUnlock = vi.fn(async () => true);
    const requestApiKey = vi.fn(async () => true);
    const buildProvider = vi.fn((_id: ProviderId, apiKey: string) => ({
      ...stubProvider,
      id: `stub:${apiKey}`,
    }));

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    await host.getProvider('deepl');
    await host.getProvider('openai');
    expect(buildProvider).toHaveBeenCalledTimes(2);

    host.reset('openai');
    await host.getProvider('deepl');
    await host.getProvider('openai');
    // deepl from cache (still 2 calls), openai rebuilt (now 3).
    expect(buildProvider).toHaveBeenCalledTimes(3);

    host.reset();
    await host.getProvider('deepl');
    await host.getProvider('openai');
    // Both rebuilt.
    expect(buildProvider).toHaveBeenCalledTimes(5);
  });

  it('re-runs the unlock gate after secretStore.lock()', async () => {
    const store = createFakeSecretStore();
    await store.unlock('p');
    await store.set('deepl-api-key', 'k:fx');
    const requestUnlock = vi.fn(async () => {
      await store.unlock('p');
      return true;
    });
    const requestApiKey = vi.fn(async () => true);
    const buildProvider = vi.fn(() => stubProvider);

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    await host.getProvider('deepl');
    expect(requestUnlock).not.toHaveBeenCalled();
    store.lock();
    await host.getProvider('deepl');
    expect(requestUnlock).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the provider when the api-key slot value changes', async () => {
    const store = createFakeSecretStore();
    await store.unlock('p');
    await store.set('deepl-api-key', 'old:fx');
    const requestUnlock = vi.fn(async () => true);
    const requestApiKey = vi.fn(async () => true);
    const buildProvider = vi.fn((_id: ProviderId, apiKey: string) => ({
      ...stubProvider,
      id: `stub:${apiKey}`,
    }));

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    const a = await host.getProvider('deepl');
    expect(a?.id).toBe('stub:old:fx');
    await store.set('deepl-api-key', 'new:fx');
    const b = await host.getProvider('deepl');
    expect(b?.id).toBe('stub:new:fx');
    expect(buildProvider).toHaveBeenCalledTimes(2);
  });

  it('walks the right slot for openai and anthropic', async () => {
    const store = createFakeSecretStore();
    await store.unlock('p');
    const requestUnlock = vi.fn(async () => true);
    const requestApiKey = vi.fn(async (slot: string) => {
      await store.set(slot, `${slot}:value`);
      return true;
    });
    const buildProvider = vi.fn((_id: ProviderId, apiKey: string) => ({
      ...stubProvider,
      id: apiKey,
    }));

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    const openai = await host.getProvider('openai');
    expect(openai?.id).toBe('openai-api-key:value');
    expect(requestApiKey).toHaveBeenCalledWith('openai-api-key', 'OpenAI');

    const anthropic = await host.getProvider('anthropic');
    expect(anthropic?.id).toBe('anthropic-api-key:value');
    expect(requestApiKey).toHaveBeenCalledWith('anthropic-api-key', 'Anthropic');

    expect(buildProvider).toHaveBeenCalledWith('openai', 'openai-api-key:value');
    expect(buildProvider).toHaveBeenCalledWith('anthropic', 'anthropic-api-key:value');
  });
});
