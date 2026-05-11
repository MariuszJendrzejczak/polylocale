import { describe, expect, it } from 'vitest';

import type { ICUNode, LocalizationProject, TranslationValue } from '@polylocale/core';

import { editorReducer, initialEditorState, pendingKey, type EditorState } from './editor-state.js';

const en = (text: string): TranslationValue => ({
  ir: [{ kind: 'text', value: text }] satisfies ICUNode[],
  raw: text,
  reviewed: true,
  modifiedAt: 0,
  source: 'imported',
});

function projectWithTwoKeys(): LocalizationProject {
  return {
    id: 'p1',
    name: 'test',
    locales: ['en', 'pl'],
    baseLocale: 'en',
    keys: [
      {
        id: 'k1',
        path: 'greet',
        values: { en: en('Hello'), pl: undefined },
        status: 'missing-translation',
      },
      {
        id: 'k2',
        path: 'bye',
        values: { en: en('Bye'), pl: undefined },
        status: 'missing-translation',
      },
    ],
    files: [],
    settings: {},
  };
}

function loaded(project: LocalizationProject): EditorState {
  return editorReducer(initialEditorState, {
    type: 'loaded',
    project,
    fsMode: 'fallback',
    directoryHandle: null,
    directoryName: null,
    fileHandles: new Map(),
    skipped: [],
  });
}

describe('editorReducer', () => {
  it('setValue defaults to source=manual when omitted', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, {
      type: 'setValue',
      keyPath: 'greet',
      locale: 'pl',
      ir: [{ kind: 'text', value: 'Cześć' }],
      raw: 'Cześć',
    });
    const greet = next.project!.keys.find((k) => k.path === 'greet')!;
    expect(greet.values['pl']?.source).toBe('manual');
    expect(greet.values['pl']?.aiProvider).toBeUndefined();
    expect(next.dirty.has('k1')).toBe(true);
  });

  it('setValue with source=ai records aiProvider and clears the matching pending entry', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'translationStart',
      entries: [{ keyId: 'k1', locale: 'pl' }],
    });
    expect(state.pendingTranslations.get(pendingKey('k1', 'pl'))).toBe('pending');

    state = editorReducer(state, {
      type: 'setValue',
      keyPath: 'greet',
      locale: 'pl',
      ir: [{ kind: 'text', value: 'Cześć' }],
      raw: 'Cześć',
      source: 'ai',
      aiProvider: 'deepl',
    });

    const greet = state.project!.keys.find((k) => k.path === 'greet')!;
    expect(greet.values['pl']?.source).toBe('ai');
    expect(greet.values['pl']?.aiProvider).toBe('deepl');
    expect(greet.status).toBe('ok');
    expect(state.pendingTranslations.has(pendingKey('k1', 'pl'))).toBe(false);
  });

  it('setValuesBatch lands every entry, recomputes status, clears pending entries', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'translationStart',
      entries: [
        { keyId: 'k1', locale: 'pl' },
        { keyId: 'k2', locale: 'pl' },
      ],
    });
    expect(state.pendingTranslations.size).toBe(2);

    state = editorReducer(state, {
      type: 'setValuesBatch',
      entries: [
        {
          keyPath: 'greet',
          locale: 'pl',
          ir: [{ kind: 'text', value: 'Cześć' }],
          raw: 'Cześć',
          source: 'ai',
          aiProvider: 'deepl',
        },
        {
          keyPath: 'bye',
          locale: 'pl',
          ir: [{ kind: 'text', value: 'Pa' }],
          raw: 'Pa',
          source: 'ai',
          aiProvider: 'deepl',
        },
      ],
    });

    const greet = state.project!.keys.find((k) => k.path === 'greet')!;
    const bye = state.project!.keys.find((k) => k.path === 'bye')!;
    expect(greet.values['pl']?.source).toBe('ai');
    expect(bye.values['pl']?.source).toBe('ai');
    expect(greet.status).toBe('ok');
    expect(bye.status).toBe('ok');
    expect(state.dirty).toEqual(new Set(['k1', 'k2']));
    expect(state.pendingTranslations.size).toBe(0);
  });

  it('setValuesBatch ignores entries whose keyPath is unknown', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, {
      type: 'setValuesBatch',
      entries: [
        {
          keyPath: 'no-such-key',
          locale: 'pl',
          ir: [{ kind: 'text', value: 'x' }],
          raw: 'x',
          source: 'ai',
          aiProvider: 'deepl',
        },
      ],
    });
    expect(next).toBe(state);
  });

  it('translationFail records an error entry without touching the project', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'translationStart',
      entries: [{ keyId: 'k1', locale: 'pl' }],
    });
    state = editorReducer(state, {
      type: 'translationFail',
      keyId: 'k1',
      locale: 'pl',
      message: 'unsupported locale',
    });
    expect(state.pendingTranslations.get(pendingKey('k1', 'pl'))).toEqual({
      error: 'unsupported locale',
    });
    const greet = state.project!.keys.find((k) => k.path === 'greet')!;
    expect(greet.values['pl']).toBeUndefined();
  });

  it('translationClear removes the listed entries only', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'translationStart',
      entries: [
        { keyId: 'k1', locale: 'pl' },
        { keyId: 'k2', locale: 'pl' },
      ],
    });
    state = editorReducer(state, {
      type: 'translationClear',
      entries: [{ keyId: 'k1', locale: 'pl' }],
    });
    expect(state.pendingTranslations.has(pendingKey('k1', 'pl'))).toBe(false);
    expect(state.pendingTranslations.has(pendingKey('k2', 'pl'))).toBe(true);
  });

  it('addKey appends a new key with id=path, base-locale value, and marks dirty', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, {
      type: 'addKey',
      path: 'newKey',
      baseValue: { ir: [{ kind: 'text', value: 'New' }], raw: 'New' },
    });
    const added = next.project!.keys.find((k) => k.path === 'newKey')!;
    expect(added.id).toBe('newKey');
    expect(added.values['en']?.raw).toBe('New');
    expect(added.values['en']?.source).toBe('manual');
    expect(added.status).toBe('missing-translation');
    expect(next.dirty.has('newKey')).toBe(true);
  });

  it('addKey is a no-op when path already exists', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, {
      type: 'addKey',
      path: 'greet',
      baseValue: { ir: [{ kind: 'text', value: 'x' }], raw: 'x' },
    });
    expect(next).toBe(state);
  });

  it('removeKey drops the key, prunes pending entries, keeps Save enabled via dirty', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'translationStart',
      entries: [{ keyId: 'k1', locale: 'pl' }],
    });
    state = editorReducer(state, { type: 'removeKey', keyId: 'k1' });
    expect(state.project!.keys.find((k) => k.id === 'k1')).toBeUndefined();
    expect(state.project!.keys).toHaveLength(1);
    expect(state.pendingTranslations.has(pendingKey('k1', 'pl'))).toBe(false);
    expect(state.dirty.has('k1')).toBe(true);
  });

  it('removeKey is a no-op when keyId is unknown', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, { type: 'removeKey', keyId: 'no-such' });
    expect(next).toBe(state);
  });

  it('renameKey updates id+path, migrates dirty Set and pendingTranslations', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'setValue',
      keyPath: 'greet',
      locale: 'pl',
      ir: [{ kind: 'text', value: 'x' }],
      raw: 'x',
    });
    expect(state.dirty.has('k1')).toBe(true);
    state = editorReducer(state, {
      type: 'translationStart',
      entries: [{ keyId: 'k1', locale: 'pl' }],
    });
    expect(state.pendingTranslations.has(pendingKey('k1', 'pl'))).toBe(true);

    state = editorReducer(state, {
      type: 'renameKey',
      keyId: 'k1',
      newPath: 'hello',
    });

    const renamed = state.project!.keys.find((k) => k.path === 'hello')!;
    expect(renamed.id).toBe('hello');
    expect(state.project!.keys.find((k) => k.path === 'greet')).toBeUndefined();
    expect(state.dirty.has('k1')).toBe(false);
    expect(state.dirty.has('hello')).toBe(true);
    expect(state.pendingTranslations.has(pendingKey('k1', 'pl'))).toBe(false);
    expect(state.pendingTranslations.has(pendingKey('hello', 'pl'))).toBe(true);
  });

  it('renameKey is a no-op when newPath collides with another key', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, {
      type: 'renameKey',
      keyId: 'k1',
      newPath: 'bye',
    });
    expect(next).toBe(state);
  });

  it('renameKey is a no-op when newPath equals the current path', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, {
      type: 'renameKey',
      keyId: 'k1',
      newPath: 'greet',
    });
    expect(next).toBe(state);
  });

  it('setBaseLocale switches the project base locale', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, { type: 'setBaseLocale', locale: 'pl' });
    expect(next.project!.baseLocale).toBe('pl');
  });

  it('setBaseLocale is a no-op when locale equals the current base', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, { type: 'setBaseLocale', locale: 'en' });
    expect(next).toBe(state);
  });

  it('setBaseLocale is a no-op when locale is not part of project.locales', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, { type: 'setBaseLocale', locale: 'de' });
    expect(next).toBe(state);
  });

  it('setAiProviderPref sets a default and round-trips through the project model', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, { type: 'setAiProviderPref', default: 'openai' });
    expect(state.project!.settings.aiProviderPrefs?.default).toBe('openai');
    // Provider preferences don't dirty individual keys.
    expect(state.dirty.size).toBe(0);
  });

  it('setAiProviderPref records per-locale overrides without touching the default', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, { type: 'setAiProviderPref', default: 'openai' });
    state = editorReducer(state, {
      type: 'setAiProviderPref',
      perLocale: { locale: 'pl', provider: 'anthropic' },
    });
    expect(state.project!.settings.aiProviderPrefs?.default).toBe('openai');
    expect(state.project!.settings.aiProviderPrefs?.perLocale?.['pl']).toBe('anthropic');
  });

  it('setAiProviderPref is a no-op when nothing changes', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, { type: 'setAiProviderPref', default: 'openai' });
    const same = editorReducer(state, { type: 'setAiProviderPref', default: 'openai' });
    expect(same).toBe(state);
  });

  it('addGlossaryEntry appends a new entry and does not dirty any key', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, {
      type: 'addGlossaryEntry',
      entry: { term: 'polylocale', perLocale: { pl: { doNotTranslate: true } } },
    });
    expect(next.project!.glossary).toEqual([
      { term: 'polylocale', perLocale: { pl: { doNotTranslate: true } } },
    ]);
    expect(next.dirty).toBe(state.dirty);
  });

  it('addGlossaryEntry is a no-op when term already exists', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'addGlossaryEntry',
      entry: { term: 'polylocale', perLocale: {} },
    });
    const same = editorReducer(state, {
      type: 'addGlossaryEntry',
      entry: { term: 'polylocale', perLocale: { pl: { doNotTranslate: true } } },
    });
    expect(same).toBe(state);
  });

  it('updateGlossaryEntry renames a term and updates per-locale', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'addGlossaryEntry',
      entry: { term: 'polylocale', perLocale: {} },
    });
    const next = editorReducer(state, {
      type: 'updateGlossaryEntry',
      previousTerm: 'polylocale',
      entry: { term: 'polylocale-tool', perLocale: { pl: { translation: 'narzędzie' } } },
    });
    expect(next.project!.glossary).toEqual([
      { term: 'polylocale-tool', perLocale: { pl: { translation: 'narzędzie' } } },
    ]);
    expect(next.dirty).toBe(state.dirty);
  });

  it('updateGlossaryEntry rejects renaming onto an existing term', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'addGlossaryEntry',
      entry: { term: 'one', perLocale: {} },
    });
    state = editorReducer(state, {
      type: 'addGlossaryEntry',
      entry: { term: 'two', perLocale: {} },
    });
    const same = editorReducer(state, {
      type: 'updateGlossaryEntry',
      previousTerm: 'one',
      entry: { term: 'two', perLocale: {} },
    });
    expect(same).toBe(state);
  });

  it('updateGlossaryEntry is a no-op when previousTerm is unknown', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, {
      type: 'updateGlossaryEntry',
      previousTerm: 'missing',
      entry: { term: 'missing', perLocale: {} },
    });
    expect(next).toBe(state);
  });

  it('removeGlossaryEntry drops the entry and collapses to undefined when empty', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'addGlossaryEntry',
      entry: { term: 'polylocale', perLocale: {} },
    });
    const next = editorReducer(state, { type: 'removeGlossaryEntry', term: 'polylocale' });
    expect(next.project!.glossary).toBeUndefined();
    expect(next.dirty).toBe(state.dirty);
  });

  it('removeGlossaryEntry is a no-op when term is unknown', () => {
    const state = loaded(projectWithTwoKeys());
    const next = editorReducer(state, { type: 'removeGlossaryEntry', term: 'no-such' });
    expect(next).toBe(state);
  });

  it('loaded resets pendingTranslations', () => {
    let state = loaded(projectWithTwoKeys());
    state = editorReducer(state, {
      type: 'translationStart',
      entries: [{ keyId: 'k1', locale: 'pl' }],
    });
    expect(state.pendingTranslations.size).toBe(1);
    const reloaded = editorReducer(state, {
      type: 'loaded',
      project: projectWithTwoKeys(),
      fsMode: 'fallback',
      directoryHandle: null,
      directoryName: null,
      fileHandles: new Map(),
      skipped: [],
    });
    expect(reloaded.pendingTranslations.size).toBe(0);
  });
});
