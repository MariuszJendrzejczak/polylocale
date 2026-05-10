/**
 * Editor persistence — IndexedDB-backed cache of the last opened directory
 * handle and a small bag of project-level UI metadata (project name, base
 * locale). Mirrors the raw-IDB style of `secret-store.ts`; no `idb` package
 * dependency.
 *
 * Directory handles round-trip through IDB via the structured-clone path on
 * Chromium. After a reload, the handle is re-readable but each access still
 * needs `queryPermission` / `requestPermission`.
 */

const DB_NAME = 'polylocale-editor';
const DB_VERSION = 1;
const HANDLE_STORE = 'directory-handles';
const META_STORE = 'editor-meta';
const HANDLE_KEY = 'last';
const META_KEY = 'last';

export interface EditorMeta {
  readonly projectName: string;
  readonly baseLocale: string;
  readonly lastOpenedAt: number;
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  try {
    await idbPut(db, HANDLE_STORE, HANDLE_KEY, handle);
  } finally {
    db.close();
  }
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openDb();
  try {
    const value = await idbGet(db, HANDLE_STORE, HANDLE_KEY);
    return value as FileSystemDirectoryHandle | undefined;
  } finally {
    db.close();
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  const db = await openDb();
  try {
    await idbDelete(db, HANDLE_STORE, HANDLE_KEY);
  } finally {
    db.close();
  }
}

export async function saveEditorMeta(meta: EditorMeta): Promise<void> {
  const db = await openDb();
  try {
    await idbPut(db, META_STORE, META_KEY, meta);
  } finally {
    db.close();
  }
}

export async function loadEditorMeta(): Promise<EditorMeta | undefined> {
  const db = await openDb();
  try {
    const value = await idbGet(db, META_STORE, META_KEY);
    return value as EditorMeta | undefined;
  } finally {
    db.close();
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('persistence: openDb failed'));
  });
}

function idbGet(db: IDBDatabase, store: string, key: IDBValidKey): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('persistence: idbGet failed'));
  });
}

function idbPut(db: IDBDatabase, store: string, key: IDBValidKey, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('persistence: idbPut failed'));
    tx.onabort = () => reject(tx.error ?? new Error('persistence: idbPut aborted'));
  });
}

function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('persistence: idbDelete failed'));
    tx.onabort = () => reject(tx.error ?? new Error('persistence: idbDelete aborted'));
  });
}
