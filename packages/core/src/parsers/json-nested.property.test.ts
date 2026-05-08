import fc from 'fast-check';
import { describe, it } from 'vitest';

import { icuEqual } from '../icu/equal.js';
import { exportNestedJson } from '../exporters/json-nested.js';
import type {
  LocaleCode,
  LocalizationProject,
  TranslationKey,
  TranslationValue,
} from '../model/types.js';
import { parseNestedJson } from './json-nested.js';
import { arbitraryNestedLeaves, type NestedLeaves } from './json-nested-arbitrary.js';

/**
 * End-to-end property: a randomly generated nested-shaped
 * `LocalizationProject` survives `exportNestedJson → parseNestedJson`
 * with its keys and per-locale IR intact. Comparison is on `path` and
 * `icuEqual(ir)` only — `raw`, `modifiedAt`, `source` are pipeline
 * artefacts. Same exclusion rule as the flat-JSON property test.
 *
 * Tree-shaped path generation (`arbitraryNestedLeaves`) guarantees no
 * path is a strict prefix of another, so the exporter's
 * prefix-collision branch isn't exercised here — that's covered by the
 * unit test in `json-nested.test.ts`.
 */

const LOCALE_POOL: readonly LocaleCode[] = ['en', 'pl-PL', 'de', 'fr-FR'];

interface ProjectAndLocale {
  readonly project: LocalizationProject;
  readonly locale: LocaleCode;
}

const arbitraryProject: fc.Arbitrary<ProjectAndLocale> = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom(...LOCALE_POOL), { minLength: 1, maxLength: 2 }),
    arbitraryNestedLeaves,
  )
  .chain(([locales, leaves]) =>
    fc.constantFrom(...locales).map(
      (targetLocale): ProjectAndLocale => ({
        project: buildProject(locales, leaves),
        locale: targetLocale,
      }),
    ),
  );

function buildProject(locales: readonly LocaleCode[], leaves: NestedLeaves): LocalizationProject {
  const keys: TranslationKey[] = leaves.map(([path, ir]) => {
    const values: Record<LocaleCode, TranslationValue | undefined> = {};
    for (const locale of locales) {
      values[locale] = {
        ir,
        reviewed: false,
        modifiedAt: 0,
        source: 'manual',
      };
    }
    return { id: path, path, values, status: 'ok' };
  });

  return {
    id: 'fc',
    name: 'fc',
    locales: [...locales].sort(),
    baseLocale: locales[0]!,
    keys,
    files: [],
    settings: {},
  };
}

describe('parseNestedJson ∘ exportNestedJson — properties (fast-check)', () => {
  it('preserves keys and per-locale IR for randomly generated nested projects', () => {
    fc.assert(
      fc.property(arbitraryProject, ({ project, locale }) => {
        const text = exportNestedJson(project, locale);
        const parsed = parseNestedJson({ fileName: `${locale}.json`, text });

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
