import { describe, expect, it } from 'vitest';
import { bcp47ToDeepLSource, bcp47ToDeepLTarget } from './deepl-locales.js';
import { UnsupportedLocaleError } from './provider.js';

describe('bcp47ToDeepLSource', () => {
  it.each([
    ['en', 'EN'],
    ['en-US', 'EN'],
    ['pl', 'PL'],
    ['pl-PL', 'PL'],
    ['zh-Hant', 'ZH'],
    ['pt-BR', 'PT'],
  ])('maps %s -> %s', (input, expected) => {
    expect(bcp47ToDeepLSource(input)).toBe(expected);
  });

  it('throws UnsupportedLocaleError for unsupported source', () => {
    expect(() => bcp47ToDeepLSource('xx')).toThrowError(UnsupportedLocaleError);
  });
});

describe('bcp47ToDeepLTarget', () => {
  it.each([
    ['en', 'EN-US'],
    ['en-US', 'EN-US'],
    ['en-GB', 'EN-GB'],
    ['pl', 'PL'],
    ['pl-PL', 'PL'],
    ['pt', 'PT-PT'],
    ['pt-BR', 'PT-BR'],
    ['pt-PT', 'PT-PT'],
    ['zh', 'ZH'],
    ['zh-Hans', 'ZH-HANS'],
    ['zh-Hant', 'ZH-HANT'],
    ['es-419', 'ES-419'],
  ])('maps %s -> %s', (input, expected) => {
    expect(bcp47ToDeepLTarget(input)).toBe(expected);
  });

  it('throws UnsupportedLocaleError for unsupported target', () => {
    expect(() => bcp47ToDeepLTarget('xx')).toThrowError(UnsupportedLocaleError);
  });
});
