import { describe, expect, it } from 'vitest';
import { detectLocaleFromFileName } from './detect.js';

describe('detectLocaleFromFileName', () => {
  it.each([
    ['en.json', 'en'],
    ['pl-PL.json', 'pl-PL'],
    ['pl_PL.json', 'pl-PL'],
    ['EN-us.json', 'en-US'],
    ['zh-Hant.json', 'zh-Hant'],
    ['l10n/pl_PL.json', 'pl-PL'],
    ['some\\nested\\dir\\en-GB.json', 'en-GB'],
    ['fil.json', 'fil'],
  ])('detects %s → %s', (input, expected) => {
    expect(detectLocaleFromFileName(input)).toBe(expected);
  });

  it.each(['random.json', 'translations.json', 'a.b.c.json', '.hidden', 'messages.json'])(
    'returns null for %s',
    (input) => {
      expect(detectLocaleFromFileName(input)).toBeNull();
    },
  );
});
