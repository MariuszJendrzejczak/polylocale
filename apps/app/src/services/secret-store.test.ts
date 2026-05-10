import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  InvalidPassphraseError,
  SecretStoreLockedError,
  createSecretStore,
} from './secret-store.js';

describe('createSecretStore', () => {
  let idb: IDBFactory;

  beforeEach(() => {
    idb = new IDBFactory();
  });

  afterEach(() => {
    // fake-indexeddb leaks state across tests if we don't drop it explicitly
    idb = new IDBFactory();
  });

  it('rejects access before unlock', async () => {
    const store = createSecretStore({ idb });
    expect(store.isUnlocked()).toBe(false);
    await expect(store.set('deepl', 'k')).rejects.toBeInstanceOf(SecretStoreLockedError);
    await expect(store.get('deepl')).rejects.toBeInstanceOf(SecretStoreLockedError);
    await expect(store.list()).rejects.toBeInstanceOf(SecretStoreLockedError);
    await expect(store.delete('deepl')).rejects.toBeInstanceOf(SecretStoreLockedError);
  });

  it('round-trips a value through set / get', async () => {
    const store = createSecretStore({ idb });
    await store.unlock('correct horse battery staple');
    expect(store.isUnlocked()).toBe(true);
    await store.set('deepl', 'abc:fx');
    expect(await store.get('deepl')).toBe('abc:fx');
  });

  it('returns undefined for an unknown name', async () => {
    const store = createSecretStore({ idb });
    await store.unlock('p');
    expect(await store.get('nope')).toBeUndefined();
  });

  it('survives lock + unlock cycle with the same passphrase', async () => {
    const a = createSecretStore({ idb });
    await a.unlock('p');
    await a.set('deepl', 'abc:fx');
    a.lock();
    expect(a.isUnlocked()).toBe(false);
    await expect(a.get('deepl')).rejects.toBeInstanceOf(SecretStoreLockedError);

    await a.unlock('p');
    expect(await a.get('deepl')).toBe('abc:fx');
  });

  it('rejects unlock with the wrong passphrase, even on a populated store', async () => {
    const a = createSecretStore({ idb });
    await a.unlock('p');
    await a.set('deepl', 'abc:fx');
    a.lock();

    await expect(a.unlock('different')).rejects.toBeInstanceOf(InvalidPassphraseError);
    expect(a.isUnlocked()).toBe(false);
  });

  it('keeps separate slots independent', async () => {
    const store = createSecretStore({ idb });
    await store.unlock('p');
    await store.set('deepl', 'A');
    await store.set('openai', 'B');
    expect(await store.get('deepl')).toBe('A');
    expect(await store.get('openai')).toBe('B');
    expect(await store.list()).toEqual(['deepl', 'openai']);
  });

  it('list returns sorted names', async () => {
    const store = createSecretStore({ idb });
    await store.unlock('p');
    await store.set('zeta', '1');
    await store.set('alpha', '2');
    await store.set('mu', '3');
    expect(await store.list()).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('delete removes the slot', async () => {
    const store = createSecretStore({ idb });
    await store.unlock('p');
    await store.set('deepl', 'k');
    await store.delete('deepl');
    expect(await store.get('deepl')).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('binds ciphertext to slot name (AAD): a swapped record fails to decrypt', async () => {
    const store = createSecretStore({ idb });
    await store.unlock('p');
    await store.set('deepl', 'A');
    await store.set('openai', 'B');

    // Reach into the IDB and swap the two ciphertext+iv blobs between
    // records, leaving everything else intact. AES-GCM AAD binds to the
    // slot name, so reading either back must throw.
    const db = await openRaw(idb);
    const tx = db.transaction('secrets', 'readwrite');
    const objStore = tx.objectStore('secrets');
    const deepl = await idbGetRaw<{ name: string; iv: ArrayBuffer; ciphertext: ArrayBuffer }>(
      objStore,
      'deepl',
    );
    const openai = await idbGetRaw<{ name: string; iv: ArrayBuffer; ciphertext: ArrayBuffer }>(
      objStore,
      'openai',
    );
    objStore.put({ name: 'deepl', iv: openai.iv, ciphertext: openai.ciphertext });
    objStore.put({ name: 'openai', iv: deepl.iv, ciphertext: deepl.ciphertext });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    await expect(store.get('deepl')).rejects.toThrow();
    await expect(store.get('openai')).rejects.toThrow();
  });

  it('two store instances on the same idb share state', async () => {
    const a = createSecretStore({ idb });
    await a.unlock('p');
    await a.set('deepl', 'k');

    const b = createSecretStore({ idb });
    await b.unlock('p');
    expect(await b.get('deepl')).toBe('k');
  });

  it('changePassphrase rotates every slot under the new passphrase', async () => {
    const store = createSecretStore({ idb });
    await store.unlock('old-pp');
    await store.set('deepl', 'd-key:fx');
    await store.set('openai', 'sk-openai-123');

    await store.changePassphrase('old-pp', 'new-pp');
    expect(store.isUnlocked()).toBe(true);

    store.lock();
    await expect(store.unlock('old-pp')).rejects.toBeInstanceOf(InvalidPassphraseError);
    expect(store.isUnlocked()).toBe(false);

    await store.unlock('new-pp');
    expect(await store.get('deepl')).toBe('d-key:fx');
    expect(await store.get('openai')).toBe('sk-openai-123');
  });

  it('changePassphrase rejects a wrong old passphrase without mutating storage', async () => {
    const store = createSecretStore({ idb });
    await store.unlock('correct');
    await store.set('deepl', 'd-key:fx');

    await expect(store.changePassphrase('wrong', 'whatever')).rejects.toBeInstanceOf(
      InvalidPassphraseError,
    );

    store.lock();
    await store.unlock('correct');
    expect(await store.get('deepl')).toBe('d-key:fx');
  });

  it('changePassphrase rewrites the verifier so the old passphrase cannot derive it', async () => {
    const store = createSecretStore({ idb });
    await store.unlock('old-pp');
    await store.set('deepl', 'd-key:fx');

    await store.changePassphrase('old-pp', 'new-pp');

    // A fresh store on the same IDB must reject the old passphrase entirely,
    // and accept the new one. This proves the verifier ciphertext is no
    // longer decryptable under the key derived from 'old-pp'.
    const fresh = createSecretStore({ idb });
    await expect(fresh.unlock('old-pp')).rejects.toBeInstanceOf(InvalidPassphraseError);
    await fresh.unlock('new-pp');
    expect(await fresh.get('deepl')).toBe('d-key:fx');
  });
});

function openRaw(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open('polylocale-secrets', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGetRaw<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}
