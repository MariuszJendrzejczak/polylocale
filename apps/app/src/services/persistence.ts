/**
 * Editor persistence — IndexedDB-backed cache of the last opened directory
 * handle and a small bag of project-level UI metadata (project name, base
 * locale, glossary). Mirrors the raw-IDB style of `secret-store.ts`; no
 * `idb` package dependency.
 *
 * Directory handles round-trip through IDB via the structured-clone path on
 * Chromium. After a reload, the handle is re-readable but each access still
 * needs `queryPermission` / `requestPermission`.
 */

import type { GlossaryEntry } from '@polylocale/core';

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
  readonly glossary?: readonly GlossaryEntry[];
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
    await idbPut(db, META_STORE, META_KEY, normalizeMeta(meta));
  } finally {
    db.close();
  }
}

export async function loadEditorMeta(): Promise<EditorMeta | undefined> {
  const db = await openDb();
  try {
    const value = await idbGet(db, META_STORE, META_KEY);
    return sanitizeMeta(value);
  } finally {
    db.close();
  }
}

function normalizeMeta(meta: EditorMeta): EditorMeta {
  if (meta.glossary === undefined || meta.glossary.length === 0) {
    const { glossary: _omit, ...rest } = meta;
    return rest;
  }
  return meta;
}

function sanitizeMeta(value: unknown): EditorMeta | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const projectName = typeof raw.projectName === 'string' ? raw.projectName : undefined;
  const baseLocale = typeof raw.baseLocale === 'string' ? raw.baseLocale : undefined;
  const lastOpenedAt = typeof raw.lastOpenedAt === 'number' ? raw.lastOpenedAt : undefined;
  if (projectName === undefined || baseLocale === undefined || lastOpenedAt === undefined) {
    return undefined;
  }
  const glossary = sanitizeGlossary(raw.glossary);
  return {
    projectName,
    baseLocale,
    lastOpenedAt,
    ...(glossary !== undefined ? { glossary } : {}),
  };
}

function sanitizeGlossary(value: unknown): readonly GlossaryEntry[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: GlossaryEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') return undefined;
    const e = item as Record<string, unknown>;
    if (typeof e.term !== 'string') return undefined;
    if (e.perLocale === null || typeof e.perLocale !== 'object') return undefined;
    const perLocale: Record<string, { translation?: string; doNotTranslate?: boolean }> = {};
    for (const [locale, raw] of Object.entries(e.perLocale as Record<string, unknown>)) {
      if (raw === null || typeof raw !== 'object') return undefined;
      const r = raw as Record<string, unknown>;
      const translation = typeof r.translation === 'string' ? r.translation : undefined;
      const doNotTranslate = typeof r.doNotTranslate === 'boolean' ? r.doNotTranslate : undefined;
      perLocale[locale] = {
        ...(translation !== undefined ? { translation } : {}),
        ...(doNotTranslate !== undefined ? { doNotTranslate } : {}),
      };
    }
    const notes = typeof e.notes === 'string' ? e.notes : undefined;
    out.push({
      term: e.term,
      perLocale,
      ...(notes !== undefined ? { notes } : {}),
    });
  }
  return out;
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
