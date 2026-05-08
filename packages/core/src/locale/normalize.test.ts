import { describe, expect, it } from 'vitest';
import { normalizeLocale } from './normalize.js';

describe('normalizeLocale', () => {
  it.each([
    ['en', 'en'],
    ['EN', 'en'],
    ['en-US', 'en-US'],
    ['en_US', 'en-US'],
    ['en-us', 'en-US'],
    ['EN_us', 'en-US'],
    ['pl_PL', 'pl-PL'],
    ['pl-pl', 'pl-PL'],
    ['zh-Hant', 'zh-Hant'],
    ['ZH-HANT', 'zh-Hant'],
    ['zh-hant-tw', 'zh-Hant-TW'],
    ['fil', 'fil'],
    ['es-419', 'es-419'],
    ['  en-US  ', 'en-US'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });

  it.each(['', 'x', 'xx-1', 'english', '123', 'en-USA', 'en--US', 'en-US-extra'])(
    'returns null for %s',
    (input) => {
      expect(normalizeLocale(input)).toBeNull();
    },
  );
});
