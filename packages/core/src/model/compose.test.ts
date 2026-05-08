import { describe, expect, it } from 'vitest';
import type { ParsedFile } from './compose.js';
import { composeProject } from './compose.js';
import type { TranslationKey, TranslationValue } from './types.js';

function value(text: string): TranslationValue {
  return {
    ir: [{ kind: 'text', value: text }],
    raw: text,
    reviewed: false,
    modifiedAt: 0,
    source: 'imported',
  };
}

function key(path: string, locale: string, text: string): TranslationKey {
  return {
    id: path,
    path,
    values: { [locale]: value(text) },
    status: 'ok',
  };
}

function file(locale: string, keys: readonly TranslationKey[]): ParsedFile {
  return { locale, format: 'json-flat', path: `${locale}.json`, keys };
}

describe('composeProject', () => {
  it('merges per-locale values for shared keys', () => {
    const en = file('en', [key('greeting', 'en', 'Hello'), key('save', 'en', 'Save')]);
    const pl = file('pl-PL', [key('greeting', 'pl-PL', 'Cześć'), key('save', 'pl-PL', 'Zapisz')]);

    const project = composeProject({
      id: 'p',
      name: 'demo',
      baseLocale: 'en',
      sources: [en, pl],
    });

    expect(project.locales).toEqual(['en', 'pl-PL']);
    expect(project.keys.map((k) => k.path)).toEqual(['greeting', 'save']);
    expect(project.keys.every((k) => k.status === 'ok')).toBe(true);
    expect(project.keys[0]!.values).toEqual({
      en: value('Hello'),
      'pl-PL': value('Cześć'),
    });
    expect(project.files.map((f) => f.locale).sort()).toEqual(['en', 'pl-PL']);
  });

  it('marks keys missing in some locale as missing-translation', () => {
    const en = file('en', [key('greeting', 'en', 'Hello'), key('extra', 'en', 'Bonus')]);
    const pl = file('pl-PL', [key('greeting', 'pl-PL', 'Cześć')]);

    const project = composeProject({
      id: 'p',
      name: 'demo',
      baseLocale: 'en',
      sources: [en, pl],
    });

    const greeting = project.keys.find((k) => k.path === 'greeting')!;
    const extra = project.keys.find((k) => k.path === 'extra')!;
    expect(greeting.status).toBe('ok');
    expect(extra.status).toBe('missing-translation');
    expect(extra.values).toEqual({ en: value('Bonus') });
  });

  it('sorts keys alphabetically by path', () => {
    const en = file('en', [
      key('zebra', 'en', 'Z'),
      key('apple', 'en', 'A'),
      key('mango', 'en', 'M'),
    ]);

    const project = composeProject({ id: 'p', name: 'demo', baseLocale: 'en', sources: [en] });
    expect(project.keys.map((k) => k.path)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('defaults settings to {} when omitted', () => {
    const project = composeProject({ id: 'p', name: 'demo', baseLocale: 'en', sources: [] });
    expect(project.settings).toEqual({});
    expect(project.locales).toEqual([]);
    expect(project.keys).toEqual([]);
    expect(project.files).toEqual([]);
  });
});
