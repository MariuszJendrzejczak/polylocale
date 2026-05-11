import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

import type { GlossaryEntry } from '@polylocale/core';

import { loadEditorMeta, saveEditorMeta, type EditorMeta } from './persistence.js';

afterEach(async () => {
  // fake-indexeddb keeps state across tests in the same worker. Wipe the
  // store between cases so each test starts on a clean slate.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('polylocale-editor');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('delete failed'));
    req.onblocked = () => resolve();
  });
});

describe('persistence: EditorMeta', () => {
  it('round-trips meta without a glossary as glossary: undefined', async () => {
    const meta: EditorMeta = {
      projectName: 'demo',
      baseLocale: 'en',
      lastOpenedAt: 1700000000000,
    };
    await saveEditorMeta(meta);
    const back = await loadEditorMeta();
    expect(back).toEqual(meta);
    expect(back?.glossary).toBeUndefined();
  });

  it('round-trips meta with a one-entry glossary', async () => {
    const entry: GlossaryEntry = {
      term: 'polylocale',
      perLocale: { pl: { doNotTranslate: true }, en: { translation: 'polylocale' } },
      notes: 'product name',
    };
    const meta: EditorMeta = {
      projectName: 'demo',
      baseLocale: 'en',
      lastOpenedAt: 1700000000000,
      glossary: [entry],
    };
    await saveEditorMeta(meta);
    const back = await loadEditorMeta();
    expect(back?.glossary).toEqual([entry]);
  });

  it('omits an empty glossary array from the persisted record', async () => {
    await saveEditorMeta({
      projectName: 'demo',
      baseLocale: 'en',
      lastOpenedAt: 1700000000000,
      glossary: [],
    });
    const back = await loadEditorMeta();
    expect(back).toBeDefined();
    expect(back?.glossary).toBeUndefined();
  });

  it('returns undefined when the store is empty', async () => {
    const back = await loadEditorMeta();
    expect(back).toBeUndefined();
  });
});
