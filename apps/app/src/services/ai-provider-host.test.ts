import { describe, expect, it, vi } from 'vitest';

import type { AIProvider } from '@polylocale/ai';

import { createAIProviderHost, __test } from './ai-provider-host.js';
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
    lock() {
      unlocked = false;
    },
  };
}

describe('createAIProviderHost', () => {
  it('runs both gates on first call, caches provider on second', async () => {
    const store = createFakeSecretStore();
    const requestUnlock = vi.fn(async () => {
      await store.unlock('passphrase');
      return true;
    });
    const requestApiKey = vi.fn(async () => {
      await store.set(__test.DEEPL_KEY_SLOT, 'free-key:fx');
      return true;
    });
    const buildProvider = vi.fn(() => stubProvider);

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    const first = await host.getProvider();
    expect(first).toBe(stubProvider);
    expect(requestUnlock).toHaveBeenCalledTimes(1);
    expect(requestApiKey).toHaveBeenCalledTimes(1);
    expect(buildProvider).toHaveBeenCalledExactlyOnceWith('free-key:fx');

    const second = await host.getProvider();
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

    const result = await host.getProvider();
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

    const result = await host.getProvider();
    expect(result).toBeNull();
    expect(requestUnlock).toHaveBeenCalledTimes(1);
    expect(requestApiKey).toHaveBeenCalledTimes(1);
    expect(buildProvider).not.toHaveBeenCalled();
  });

  it('skips both gates when the store is already unlocked and the slot is filled', async () => {
    const store = createFakeSecretStore();
    await store.unlock('p');
    await store.set(__test.DEEPL_KEY_SLOT, 'pre-existing:fx');
    const requestUnlock = vi.fn(async () => true);
    const requestApiKey = vi.fn(async () => true);
    const buildProvider = vi.fn(() => stubProvider);

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    await host.getProvider();
    expect(requestUnlock).not.toHaveBeenCalled();
    expect(requestApiKey).not.toHaveBeenCalled();
    expect(buildProvider).toHaveBeenCalledExactlyOnceWith('pre-existing:fx');
  });

  it('reset() drops the cached provider; next call rebuilds without re-prompting', async () => {
    const store = createFakeSecretStore();
    await store.unlock('p');
    await store.set(__test.DEEPL_KEY_SLOT, 'k:fx');
    const requestUnlock = vi.fn(async () => true);
    const requestApiKey = vi.fn(async () => true);
    const buildProvider = vi.fn(() => stubProvider);

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    await host.getProvider();
    expect(buildProvider).toHaveBeenCalledTimes(1);
    host.reset();
    await host.getProvider();
    expect(buildProvider).toHaveBeenCalledTimes(2);
    expect(requestUnlock).not.toHaveBeenCalled();
  });

  it('re-runs the unlock gate after secretStore.lock()', async () => {
    const store = createFakeSecretStore();
    await store.unlock('p');
    await store.set(__test.DEEPL_KEY_SLOT, 'k:fx');
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

    await host.getProvider();
    expect(requestUnlock).not.toHaveBeenCalled();
    store.lock();
    await host.getProvider();
    expect(requestUnlock).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the provider when the api-key slot value changes', async () => {
    const store = createFakeSecretStore();
    await store.unlock('p');
    await store.set(__test.DEEPL_KEY_SLOT, 'old:fx');
    const requestUnlock = vi.fn(async () => true);
    const requestApiKey = vi.fn(async () => true);
    const buildProvider = vi.fn((apiKey: string) => ({
      ...stubProvider,
      id: `stub:${apiKey}`,
    }));

    const host = createAIProviderHost({
      secretStore: store,
      requestUnlock,
      requestApiKey,
      buildProvider,
    });

    const a = await host.getProvider();
    expect(a?.id).toBe('stub:old:fx');
    await store.set(__test.DEEPL_KEY_SLOT, 'new:fx');
    const b = await host.getProvider();
    expect(b?.id).toBe('stub:new:fx');
    expect(buildProvider).toHaveBeenCalledTimes(2);
  });
});
