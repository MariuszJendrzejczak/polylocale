import fc from 'fast-check';
import { describe, it } from 'vitest';

import { arbitraryIcuNodes } from '../icu/arbitrary.js';
import { icuEqual } from '../icu/equal.js';
import { exportFlatJson } from '../exporters/json-flat.js';
import type {
  LocaleCode,
  LocalizationProject,
  TranslationKey,
  TranslationValue,
} from '../model/types.js';
import { parseFlatJson } from './json-flat.js';

/**
 * End-to-end property: a randomly generated `LocalizationProject` survives
 * a `exportFlatJson → parseFlatJson` round trip with its keys and per-locale
 * IR intact. We compare on `path` and `icuEqual(ir)` only — `raw`,
 * `modifiedAt`, and `source` are intentional artefacts of the round-trip
 * pipeline and not preserved by parse-export-parse.
 */

const LOCALE_POOL: readonly LocaleCode[] = ['en', 'pl-PL', 'de', 'fr-FR'];

const arbitraryKeyPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.string({
      minLength: 0,
      maxLength: 15,
      unit: fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split(''),
      ),
    }),
  )
  .map(([first, rest]) => `${first}${rest}`);

interface ProjectAndLocale {
  readonly project: LocalizationProject;
  readonly locale: LocaleCode;
}

const arbitraryProject: fc.Arbitrary<ProjectAndLocale> = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom(...LOCALE_POOL), { minLength: 1, maxLength: 2 }),
    fc.uniqueArray(arbitraryKeyPath, { minLength: 3, maxLength: 5 }),
  )
  .chain(([locales, paths]) =>
    fc
      .array(
        fc.array(arbitraryIcuNodes(2), { minLength: locales.length, maxLength: locales.length }),
        {
          minLength: paths.length,
          maxLength: paths.length,
        },
      )
      .chain((irGrid) =>
        fc.constantFrom(...locales).map((targetLocale): ProjectAndLocale => {
          const keys: TranslationKey[] = paths.map((path, keyIdx) => {
            const values: Record<LocaleCode, TranslationValue | undefined> = {};
            for (let localeIdx = 0; localeIdx < locales.length; localeIdx++) {
              values[locales[localeIdx]!] = {
                ir: irGrid[keyIdx]![localeIdx]!,
                reviewed: false,
                modifiedAt: 0,
                source: 'manual',
              };
            }
            return { id: path, path, values, status: 'ok' };
          });

          const project: LocalizationProject = {
            id: 'fc',
            name: 'fc',
            locales: [...locales].sort(),
            baseLocale: locales[0]!,
            keys,
            files: [],
            settings: {},
          };

          return { project, locale: targetLocale };
        }),
      ),
  );

describe('parseFlatJson ∘ exportFlatJson — properties (fast-check)', () => {
  it('preserves keys and per-locale IR for randomly generated projects', () => {
    fc.assert(
      fc.property(arbitraryProject, ({ project, locale }) => {
        const text = exportFlatJson(project, locale);
        const parsed = parseFlatJson({ fileName: `${locale}.json`, text });

        if (parsed.locale !== locale) return false;
        if (parsed.keys.length !== project.keys.length) return false;

        const sortByPath = <T extends { readonly path: string }>(arr: readonly T[]): T[] =>
          [...arr].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

        const expected = sortByPath(project.keys);
        const actual = sortByPath(parsed.keys);

        for (let i = 0; i < expected.length; i++) {
          const expKey = expected[i]!;
          const actKey = actual[i]!;
          if (expKey.path !== actKey.path) return false;
          const expIr = expKey.values[locale]?.ir;
          const actIr = actKey.values[locale]?.ir;
          if (expIr === undefined || actIr === undefined) return false;
          if (!icuEqual(expIr, actIr)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
