import { describe, expect, it } from 'vitest';

import type { LocalizationProject, SourceFile, TranslationKey } from '@polylocale/core';

import { validateKeyPath } from './validate-path.js';

function makeKey(id: string, path: string): TranslationKey {
  return {
    id,
    path,
    values: { en: { ir: [], reviewed: true, modifiedAt: 0 } },
    status: 'ok',
  };
}

function makeProject(opts: {
  readonly keys: readonly TranslationKey[];
  readonly files: readonly SourceFile[];
}): LocalizationProject {
  return {
    id: 'p',
    name: 'test',
    locales: ['en'],
    baseLocale: 'en',
    keys: opts.keys,
    files: opts.files,
    settings: {},
  };
}

const flatFiles: readonly SourceFile[] = [{ locale: 'en', format: 'json-flat', path: 'en.json' }];
const nestedFiles: readonly SourceFile[] = [
  { locale: 'en', format: 'json-nested', path: 'en.json' },
];

describe('validateKeyPath', () => {
  it('rejects empty / whitespace-only paths', () => {
    const project = makeProject({ keys: [], files: flatFiles });
    expect(validateKeyPath('', project)).toEqual({ ok: false, reason: 'empty' });
    expect(validateKeyPath('   ', project)).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects duplicates of an existing key path', () => {
    const project = makeProject({
      keys: [makeKey('k1', 'home.title')],
      files: flatFiles,
    });
    expect(validateKeyPath('home.title', project)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('allows the same path when excluded by keyId (rename to identity)', () => {
    const project = makeProject({
      keys: [makeKey('k1', 'home.title')],
      files: flatFiles,
    });
    expect(validateKeyPath('home.title', project, { excludeKeyId: 'k1' })).toEqual({ ok: true });
  });

  it('allows dotted segments in flat-format projects', () => {
    const project = makeProject({
      keys: [makeKey('k1', 'home.title')],
      files: flatFiles,
    });
    expect(validateKeyPath('home.title.button', project)).toEqual({ ok: true });
  });

  it('rejects empty segments only when project has nested-JSON files', () => {
    const flat = makeProject({ keys: [], files: flatFiles });
    const nested = makeProject({ keys: [], files: nestedFiles });
    expect(validateKeyPath('home..title', flat)).toEqual({ ok: true });
    expect(validateKeyPath('home..title', nested)).toEqual({
      ok: false,
      reason: 'illegal-segment',
    });
    expect(validateKeyPath('.home', nested)).toEqual({ ok: false, reason: 'illegal-segment' });
    expect(validateKeyPath('home.', nested)).toEqual({ ok: false, reason: 'illegal-segment' });
  });

  it('rejects prefix collisions in nested-JSON projects (new path under existing leaf)', () => {
    const project = makeProject({
      keys: [makeKey('k1', 'home.title')],
      files: nestedFiles,
    });
    expect(validateKeyPath('home.title.button', project)).toEqual({
      ok: false,
      reason: 'prefix-collision',
    });
  });

  it('rejects prefix collisions in nested-JSON projects (existing leaf under new path)', () => {
    const project = makeProject({
      keys: [makeKey('k1', 'home.title.button')],
      files: nestedFiles,
    });
    expect(validateKeyPath('home.title', project)).toEqual({
      ok: false,
      reason: 'prefix-collision',
    });
  });

  it('does not flag siblings as colliding in nested-JSON projects', () => {
    const project = makeProject({
      keys: [makeKey('k1', 'home.title'), makeKey('k2', 'home.subtitle')],
      files: nestedFiles,
    });
    expect(validateKeyPath('home.action', project)).toEqual({ ok: true });
  });

  it('does not flag prefix collisions in flat-format projects', () => {
    const project = makeProject({
      keys: [makeKey('k1', 'home.title')],
      files: flatFiles,
    });
    expect(validateKeyPath('home.title.button', project)).toEqual({ ok: true });
  });
});
