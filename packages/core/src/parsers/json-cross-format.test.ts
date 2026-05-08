import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composeProject } from '../model/compose.js';
import { parseFlatJson } from './json-flat.js';
import { parseNestedJson } from './json-nested.js';

/**
 * Cross-format equivalence: the same logical project parsed as flat
 * for one locale and as nested for another must merge into a model
 * indistinguishable from the all-flat baseline (modulo `SourceFile`
 * format/path, which intentionally records what each file was).
 *
 * This is the test that earns nested JSON's "interchangeable view"
 * claim documented in ARCHITECTURE.md §2.3.
 */

const FLAT_EN = JSON.stringify(
  {
    'home.greeting': 'Hello {name}',
    'home.welcome': 'Welcome',
    'settings.title': 'Settings',
    'settings.section.language': 'Language',
  },
  null,
  2,
);

const FLAT_PL = JSON.stringify(
  {
    'home.greeting': 'Witaj {name}',
    'home.welcome': 'Witaj',
    'settings.title': 'Ustawienia',
    'settings.section.language': 'Język',
  },
  null,
  2,
);

const NESTED_PL = JSON.stringify(
  {
    home: {
      greeting: 'Witaj {name}',
      welcome: 'Witaj',
    },
    settings: {
      section: {
        language: 'Język',
      },
      title: 'Ustawienia',
    },
  },
  null,
  2,
);

describe('flat / nested JSON cross-format equivalence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('compose(flat-en + nested-pl) === compose(flat-en + flat-pl) up to file metadata', () => {
    const flatEn = parseFlatJson({ fileName: 'en.json', text: FLAT_EN });
    const flatPl = parseFlatJson({ fileName: 'pl-PL.json', text: FLAT_PL });
    const nestedPl = parseNestedJson({ fileName: 'pl-PL.json', text: NESTED_PL });

    const baseline = composeProject({
      id: 'demo',
      name: 'demo',
      baseLocale: 'en',
      sources: [flatEn, flatPl],
    });
    const mixed = composeProject({
      id: 'demo',
      name: 'demo',
      baseLocale: 'en',
      sources: [flatEn, nestedPl],
    });

    expect(mixed.keys).toEqual(baseline.keys);
    expect(mixed.locales).toEqual(baseline.locales);
    expect(mixed.baseLocale).toBe(baseline.baseLocale);

    const baselinePlFile = baseline.files.find((f) => f.locale === 'pl-PL')!;
    const mixedPlFile = mixed.files.find((f) => f.locale === 'pl-PL')!;
    expect(baselinePlFile.format).toBe('json-flat');
    expect(mixedPlFile.format).toBe('json-nested');
    expect(mixedPlFile.path).toBe(baselinePlFile.path);
  });

  it('produces identical key paths regardless of which file was nested', () => {
    const flatEn = parseFlatJson({ fileName: 'en.json', text: FLAT_EN });
    const nestedPl = parseNestedJson({ fileName: 'pl-PL.json', text: NESTED_PL });

    const project = composeProject({
      id: 'demo',
      name: 'demo',
      baseLocale: 'en',
      sources: [flatEn, nestedPl],
    });

    expect(project.keys.map((k) => k.path)).toEqual([
      'home.greeting',
      'home.welcome',
      'settings.section.language',
      'settings.title',
    ]);
    for (const key of project.keys) {
      expect(key.status).toBe('ok');
      expect(key.values.en).toBeDefined();
      expect(key.values['pl-PL']).toBeDefined();
    }
  });
});
