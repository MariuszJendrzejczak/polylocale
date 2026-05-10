/**
 * Encrypted secret store backed by IndexedDB + WebCrypto.
 *
 * Designed for storing AI provider API keys without the project file ever
 * touching them — see ARCHITECTURE.md §3.4 / §3.10. Keys are encrypted with
 * AES-GCM under a 256-bit key derived from a user passphrase via PBKDF2
 * (600 000 iterations, SHA-256, OWASP 2023 baseline). Each ciphertext binds
 * to its slot name through the AES-GCM Additional Authenticated Data, so
 * blobs cannot be swapped between slots without invalidating the tag.
 *
 * The factory takes `IDBFactory` and `Crypto` as parameters so tests can
 * substitute `fake-indexeddb` and a deterministic crypto stub when needed.
 *
 * Lifecycle:
 *  - `unlock(passphrase)` — derives the key. On the first call ever it
 *    creates a fresh salt and a sentinel verifier ciphertext so subsequent
 *    `unlock` calls can fail loudly when the passphrase is wrong.
 *  - `set` / `get` / `delete` / `list` — only valid while unlocked.
 *  - `changePassphrase(old, new)` — verifies `old` against the verifier,
 *    decrypts every slot in memory, then commits a fresh salt + verifier
 *    + re-encrypted slots in a single IndexedDB transaction. Decryption
 *    failures throw before any write opens; the rotation tx rolls back
 *    atomically on commit errors.
 *  - `lock()` — drops the in-memory key. The IndexedDB blobs stay; the next
 *    `unlock` rebuilds the key from the stored salt.
 */

const DB_NAME = 'polylocale-secrets';
const DB_VERSION = 1;
const META_STORE = 'meta';
const SECRETS_STORE = 'secrets';
const META_ID = 'config';
const VERIFIER_PLAINTEXT = 'polylocale-verifier-v1';
const VERIFIER_AAD = 'polylocale:verifier';
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export class InvalidPassphraseError extends Error {
  constructor() {
    super('secret-store: passphrase did not match the stored verifier');
    this.name = 'InvalidPassphraseError';
  }
}

export class SecretStoreLockedError extends Error {
  constructor() {
    super('secret-store: store is locked — call unlock(passphrase) first');
    this.name = 'SecretStoreLockedError';
  }
}

export interface SecretStore {
  unlock(passphrase: string): Promise<void>;
  isUnlocked(): boolean;
  set(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | undefined>;
  delete(name: string): Promise<void>;
  list(): Promise<readonly string[]>;
  /**
   * Re-encrypts every stored slot under a new passphrase. Verifies the old
   * passphrase first; on any decryption failure during the rotation, throws
   * without mutating IndexedDB. On success the store stays unlocked under
   * the new passphrase.
   */
  changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void>;
  lock(): void;
}

export interface SecretStoreOptions {
  readonly idb: IDBFactory;
  readonly crypto?: Crypto;
}

interface MetaRecord {
  readonly id: typeof META_ID;
  readonly salt: ArrayBuffer;
  readonly verifierIv: ArrayBuffer;
  readonly verifierCiphertext: ArrayBuffer;
}

interface SecretRecord {
  readonly name: string;
  readonly iv: ArrayBuffer;
  readonly ciphertext: ArrayBuffer;
}

export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const idb = options.idb;
  const cryptoImpl = options.crypto ?? globalThis.crypto;
  if (cryptoImpl === undefined || typeof cryptoImpl.subtle === 'undefined') {
    throw new Error('createSecretStore: WebCrypto (crypto.subtle) is not available');
  }

  let cachedKey: CryptoKey | undefined;

  return {
    async unlock(passphrase) {
      const db = await openDb(idb);
      try {
        const meta = (await idbGet(db, META_STORE, META_ID)) as MetaRecord | undefined;
        if (meta === undefined) {
          await initialiseMeta(db, cryptoImpl, passphrase);
          cachedKey = await deriveKey(cryptoImpl, passphrase, (await readMeta(db)).salt);
          return;
        }
        cachedKey = await verifyPassphrase(cryptoImpl, passphrase, meta);
      } finally {
        db.close();
      }
    },

    isUnlocked() {
      return cachedKey !== undefined;
    },

    async set(name, value) {
      const key = requireKey();
      const iv = randomBytes(cryptoImpl, IV_BYTES);
      const ciphertext = await cryptoImpl.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encodeUtf8(name) },
        key,
        encodeUtf8(value),
      );
      const db = await openDb(idb);
      try {
        await idbPut(db, SECRETS_STORE, { name, iv: iv.buffer, ciphertext } satisfies SecretRecord);
      } finally {
        db.close();
      }
    },

    async get(name) {
      const key = requireKey();
      const db = await openDb(idb);
      let record: SecretRecord | undefined;
      try {
        record = (await idbGet(db, SECRETS_STORE, name)) as SecretRecord | undefined;
      } finally {
        db.close();
      }
      if (record === undefined) return undefined;
      const plaintext = await cryptoImpl.subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv, additionalData: encodeUtf8(name) },
        key,
        record.ciphertext,
      );
      return decodeUtf8(plaintext);
    },

    async delete(name) {
      requireKey();
      const db = await openDb(idb);
      try {
        await idbDelete(db, SECRETS_STORE, name);
      } finally {
        db.close();
      }
    },

    async list() {
      requireKey();
      const db = await openDb(idb);
      try {
        const keys = await idbGetAllKeys(db, SECRETS_STORE);
        return keys.filter((k): k is string => typeof k === 'string').sort();
      } finally {
        db.close();
      }
    },

    async changePassphrase(oldPassphrase, newPassphrase) {
      const db = await openDb(idb);
      try {
        const meta = (await idbGet(db, META_STORE, META_ID)) as MetaRecord | undefined;
        if (meta === undefined) throw new InvalidPassphraseError();
        const oldKey = await verifyPassphrase(cryptoImpl, oldPassphrase, meta);

        const slotNames = (await idbGetAllKeys(db, SECRETS_STORE)).filter(
          (k): k is string => typeof k === 'string',
        );
        const plaintexts: { readonly name: string; readonly value: string }[] = [];
        for (const name of slotNames) {
          const record = (await idbGet(db, SECRETS_STORE, name)) as SecretRecord | undefined;
          if (record === undefined) continue;
          const plaintext = await cryptoImpl.subtle.decrypt(
            { name: 'AES-GCM', iv: record.iv, additionalData: encodeUtf8(name) },
            oldKey,
            record.ciphertext,
          );
          plaintexts.push({ name, value: decodeUtf8(plaintext) });
        }

        const newSalt = randomBytes(cryptoImpl, SALT_BYTES);
        const newKey = await deriveKey(cryptoImpl, newPassphrase, newSalt.buffer);
        const newVerifierIv = randomBytes(cryptoImpl, IV_BYTES);
        const newVerifierCiphertext = await cryptoImpl.subtle.encrypt(
          { name: 'AES-GCM', iv: newVerifierIv, additionalData: encodeUtf8(VERIFIER_AAD) },
          newKey,
          encodeUtf8(VERIFIER_PLAINTEXT),
        );
        const newRecords: SecretRecord[] = [];
        for (const { name, value } of plaintexts) {
          const iv = randomBytes(cryptoImpl, IV_BYTES);
          const ciphertext = await cryptoImpl.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: encodeUtf8(name) },
            newKey,
            encodeUtf8(value),
          );
          newRecords.push({ name, iv: iv.buffer, ciphertext });
        }

        await commitRotation(
          db,
          {
            id: META_ID,
            salt: newSalt.buffer,
            verifierIv: newVerifierIv.buffer,
            verifierCiphertext: newVerifierCiphertext,
          } satisfies MetaRecord,
          newRecords,
        );

        cachedKey = newKey;
      } finally {
        db.close();
      }
    },

    lock() {
      cachedKey = undefined;
    },
  };

  function requireKey(): CryptoKey {
    if (cachedKey === undefined) throw new SecretStoreLockedError();
    return cachedKey;
  }

  async function readMeta(db: IDBDatabase): Promise<MetaRecord> {
    const meta = (await idbGet(db, META_STORE, META_ID)) as MetaRecord | undefined;
    if (meta === undefined) throw new Error('secret-store: meta record disappeared after init');
    return meta;
  }
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE))
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SECRETS_STORE))
        db.createObjectStore(SECRETS_STORE, { keyPath: 'name' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('secret-store: openDb failed'));
  });
}

async function initialiseMeta(
  db: IDBDatabase,
  cryptoImpl: Crypto,
  passphrase: string,
): Promise<void> {
  const salt = randomBytes(cryptoImpl, SALT_BYTES);
  const key = await deriveKey(cryptoImpl, passphrase, salt.buffer);
  const verifierIv = randomBytes(cryptoImpl, IV_BYTES);
  const verifierCiphertext = await cryptoImpl.subtle.encrypt(
    { name: 'AES-GCM', iv: verifierIv, additionalData: encodeUtf8(VERIFIER_AAD) },
    key,
    encodeUtf8(VERIFIER_PLAINTEXT),
  );
  await idbPut(db, META_STORE, {
    id: META_ID,
    salt: salt.buffer,
    verifierIv: verifierIv.buffer,
    verifierCiphertext,
  } satisfies MetaRecord);
}

async function deriveKey(
  cryptoImpl: Crypto,
  passphrase: string,
  salt: ArrayBuffer,
): Promise<CryptoKey> {
  const baseKey = await cryptoImpl.subtle.importKey(
    'raw',
    encodeUtf8(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return cryptoImpl.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function verifyPassphrase(
  cryptoImpl: Crypto,
  passphrase: string,
  meta: MetaRecord,
): Promise<CryptoKey> {
  const candidate = await deriveKey(cryptoImpl, passphrase, meta.salt);
  try {
    await cryptoImpl.subtle.decrypt(
      { name: 'AES-GCM', iv: meta.verifierIv, additionalData: encodeUtf8(VERIFIER_AAD) },
      candidate,
      meta.verifierCiphertext,
    );
  } catch {
    throw new InvalidPassphraseError();
  }
  return candidate;
}

function commitRotation(
  db: IDBDatabase,
  meta: MetaRecord,
  records: readonly SecretRecord[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, SECRETS_STORE], 'readwrite');
    const secretsStore = tx.objectStore(SECRETS_STORE);
    secretsStore.clear();
    for (const record of records) secretsStore.put(record);
    tx.objectStore(META_STORE).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('secret-store: rotation tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('secret-store: rotation tx aborted'));
  });
}

function idbGet(db: IDBDatabase, store: string, key: IDBValidKey): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('secret-store: idbGet failed'));
  });
}

function idbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('secret-store: idbPut failed'));
    tx.onabort = () => reject(tx.error ?? new Error('secret-store: idbPut aborted'));
  });
}

function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('secret-store: idbDelete failed'));
    tx.onabort = () => reject(tx.error ?? new Error('secret-store: idbDelete aborted'));
  });
}

function idbGetAllKeys(db: IDBDatabase, store: string): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('secret-store: idbGetAllKeys failed'));
  });
}

function randomBytes(cryptoImpl: Crypto, length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  cryptoImpl.getRandomValues(bytes);
  return bytes;
}

function encodeUtf8(s: string): Uint8Array<ArrayBuffer> {
  // TextEncoder always produces a fresh ArrayBuffer, but the lib types
  // widen to ArrayBufferLike. Re-narrow so it lines up with WebCrypto's
  // BufferSource constraint under TS 5.7+ strict array buffer flavours.
  const out = new TextEncoder().encode(s);
  return out as Uint8Array<ArrayBuffer>;
}

function decodeUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}
