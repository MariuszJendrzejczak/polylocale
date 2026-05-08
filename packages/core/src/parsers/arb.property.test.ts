import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { arbitraryIcuNodes } from '../icu/arbitrary.js';
import { icuEqual } from '../icu/equal.js';
import { exportArb } from '../exporters/arb.js';
import type {
  LocaleCode,
  LocalizationProject,
  Placeholder,
  TranslationKey,
  TranslationValue,
} from '../model/types.js';
import { parseArb } from './arb.js';
import {
  arbitraryArbDescription,
  arbitraryArbKeyMetadata,
  arbitraryArbPlaceholders,
} from './arb-arbitrary.js';

/**
 * End-to-end property: a randomly generated `LocalizationProject` with
 * ARB-shaped per-key metadata survives an `exportArb → parseArb` round
 * trip with its keys, descriptions, placeholders, and keyMetadata intact.
 *
 * Comparison is on `path`, `icuEqual(ir)` for the target locale, and
 * deepEqual on description / placeholders / keyMetadata. We deliberately
 * skip TranslationValue.raw / modifiedAt / source — those are pipeline
 * artefacts, same exclusion as the flat-JSON property test.
 */

const LOCALE_POOL: readonly LocaleCode[] = ['en', 'pl', 'de', 'fr'];

const arbitraryKeyPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.string({
      minLength: 0,
      maxLength: 10,
      unit: fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
      ),
    }),
  )
  .map(([first, rest]) => `${first}${rest}`);

interface ProjectAndLocale {
  readonly project: LocalizationProject;
  readonly locale: LocaleCode;
}

interface KeyExtras {
  readonly description: string | undefined;
  readonly placeholders: readonly Placeholder[] | undefined;
  readonly keyMetadata: Readonly<Record<string, unknown>> | undefined;
}

const arbitraryKeyExtras: fc.Arbitrary<KeyExtras> = fc
  .tuple(arbitraryArbDescription, arbitraryArbPlaceholders, arbitraryArbKeyMetadata)
  .map(([description, placeholders, keyMetadata]) => ({ description, placeholders, keyMetadata }));

const arbitraryProject: fc.Arbitrary<ProjectAndLocale> = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom(...LOCALE_POOL), { minLength: 1, maxLength: 2 }),
    fc.uniqueArray(arbitraryKeyPath, { minLength: 3, maxLength: 5 }),
  )
  .chain(([locales, paths]) =>
    fc
      .tuple(
        fc.array(
          fc.array(arbitraryIcuNodes(2), { minLength: locales.length, maxLength: locales.length }),
          { minLength: paths.length, maxLength: paths.length },
        ),
        fc.array(arbitraryKeyExtras, { minLength: paths.length, maxLength: paths.length }),
        fc.constantFrom(...locales),
      )
      .map(([irGrid, extras, targetLocale]): ProjectAndLocale => {
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
          const ext = extras[keyIdx]!;
          return {
            id: path,
            path,
            values,
            status: 'ok',
            ...(ext.description !== undefined ? { description: ext.description } : {}),
            ...(ext.placeholders !== undefined ? { placeholders: ext.placeholders } : {}),
            ...(ext.keyMetadata !== undefined ? { keyMetadata: ext.keyMetadata } : {}),
          };
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
  );

describe('parseArb ∘ exportArb — properties (fast-check)', () => {
  it('preserves keys, IR, descriptions, placeholders, and keyMetadata for the target locale', () => {
    fc.assert(
      fc.property(arbitraryProject, ({ project, locale }) => {
        const text = exportArb(project, locale);
        const parsed = parseArb({ fileName: `${locale}.arb`, text });

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

          if (expKey.description !== actKey.description) return false;

          try {
            expect(actKey.placeholders).toEqual(expKey.placeholders);
            expect(actKey.keyMetadata).toEqual(expKey.keyMetadata);
          } catch {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
