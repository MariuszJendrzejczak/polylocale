import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { arbitraryIcuNodes } from '../icu/arbitrary.js';
import { parseICU } from '../icu/parse.js';
import { renderICU } from '../icu/render.js';
import { composeProject } from '../model/compose.js';
import type { ParsedFile } from '../model/compose.js';
import type {
  LocaleCode,
  LocalizationProject,
  TranslationKey,
  TranslationValue,
} from '../model/types.js';

import { CsvParseError, exportProjectToCsv, parseCsvRows } from './csv.js';

function buildKey(
  path: string,
  values: Readonly<Record<LocaleCode, string>>,
  description?: string,
): TranslationKey {
  const now = Date.now();
  const entries: Record<LocaleCode, TranslationValue> = {};
  for (const [locale, raw] of Object.entries(values)) {
    entries[locale] = {
      ir: parseICU(raw),
      raw,
      reviewed: false,
      modifiedAt: now,
      source: 'imported',
    };
  }
  return {
    id: path,
    path,
    values: entries,
    status: 'ok',
    ...(description !== undefined ? { description } : {}),
  };
}

function buildProject(
  locales: readonly LocaleCode[],
  keys: readonly TranslationKey[],
): LocalizationProject {
  const sources: ParsedFile[] = locales.map((locale) => ({
    locale,
    format: 'json-flat' as const,
    path: `${locale}.json`,
    keys: keys
      .filter((k) => k.values[locale] !== undefined)
      .map((k) => ({
        id: k.id,
        path: k.path,
        values: { [locale]: k.values[locale]! },
        status: 'ok' as const,
        ...(k.description !== undefined ? { description: k.description } : {}),
      })),
  }));
  return composeProject({
    id: 'test',
    name: 'test',
    baseLocale: locales[0]!,
    sources,
  });
}

describe('exportProjectToCsv', () => {
  it('emits header and rows in the documented column order', () => {
    const project = buildProject(
      ['en', 'pl-PL'],
      [
        buildKey('appTitle', { en: 'Polylocale', 'pl-PL': 'Polylocale' }, 'app title'),
        buildKey('greeting', { en: 'Hello {name}', 'pl-PL': 'Cześć {name}' }),
      ],
    );
    const csv = exportProjectToCsv(project);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('key,description,en,pl-PL');
    expect(lines[1]).toBe('appTitle,app title,Polylocale,Polylocale');
    expect(lines[2]).toBe('greeting,,Hello {name},Cześć {name}');
    expect(lines[3]).toBe('');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('emits empty cells for missing locale values', () => {
    const project = buildProject(['en', 'pl-PL'], [buildKey('onlyEn', { en: 'English only' })]);
    const csv = exportProjectToCsv(project);
    expect(csv).toBe(['key,description,en,pl-PL', 'onlyEn,,English only,', ''].join('\r\n'));
  });

  it('quotes cells containing commas, quotes, or newlines (RFC 4180)', () => {
    const project = buildProject(
      ['en'],
      [
        buildKey('comma', { en: 'one, two' }),
        buildKey('quote', { en: 'she said "hi"' }),
        buildKey('newline', { en: 'first\nsecond' }),
      ],
    );
    const csv = exportProjectToCsv(project);
    // composeProject sorts keys alphabetically → comma, newline, quote.
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('comma,,"one, two"');
    expect(lines[2]).toBe('newline,,"first\nsecond"');
    expect(lines[3]).toBe('quote,,"she said ""hi"""');
  });

  it('falls back to renderICU when a value has no raw', () => {
    const ir = parseICU('Hello {name}');
    const now = Date.now();
    const key: TranslationKey = {
      id: 'g',
      path: 'g',
      values: {
        en: { ir, reviewed: false, modifiedAt: now, source: 'manual' },
      },
      status: 'ok',
    };
    const project = buildProject(['en'], [key]);
    const csv = exportProjectToCsv(project);
    expect(csv).toBe(['key,description,en', `g,,${renderICU(ir)}`, ''].join('\r\n'));
  });
});

describe('parseCsvRows', () => {
  it('parses a simple CSV into rows', () => {
    const csv = [
      'key,description,en,pl-PL',
      'appTitle,app title,Polylocale,Polylocale',
      'greeting,,Hello {name},Cześć {name}',
    ].join('\r\n');
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      key: 'appTitle',
      description: 'app title',
      values: { en: 'Polylocale', 'pl-PL': 'Polylocale' },
    });
    expect(rows[1]).toEqual({
      key: 'greeting',
      values: { en: 'Hello {name}', 'pl-PL': 'Cześć {name}' },
    });
  });

  it('decodes RFC 4180 quoting: commas, quotes, and embedded newlines', () => {
    const csv = [
      'key,en',
      'comma,"one, two"',
      'quote,"she said ""hi"""',
      'newline,"first\nsecond"',
    ].join('\r\n');
    const rows = parseCsvRows(csv);
    expect(rows[0]!.values).toEqual({ en: 'one, two' });
    expect(rows[1]!.values).toEqual({ en: 'she said "hi"' });
    expect(rows[2]!.values).toEqual({ en: 'first\nsecond' });
  });

  it('accepts both LF and CRLF line endings', () => {
    const lf = ['key,en', 'a,1', 'b,2'].join('\n');
    const crlf = ['key,en', 'a,1', 'b,2'].join('\r\n');
    expect(parseCsvRows(lf)).toEqual(parseCsvRows(crlf));
  });

  it('tolerates a trailing newline', () => {
    const csv = 'key,en\r\na,1\r\n';
    expect(parseCsvRows(csv)).toHaveLength(1);
  });

  it('passes unknown header columns through verbatim', () => {
    const csv = 'key,notes,en\r\nfoo,internal,bar';
    const rows = parseCsvRows(csv);
    expect(rows[0]!.values).toEqual({ notes: 'internal', en: 'bar' });
  });

  it('throws when input is empty', () => {
    expect(() => parseCsvRows('')).toThrow(CsvParseError);
  });

  it('throws when the "key" column is missing', () => {
    expect(() => parseCsvRows('id,en\r\na,1')).toThrow(/missing the required "key" column/);
  });

  it('throws on duplicate header columns', () => {
    expect(() => parseCsvRows('key,en,en\r\na,1,2')).toThrow(/duplicate column "en"/);
  });

  it('throws on empty header column', () => {
    expect(() => parseCsvRows('key,,en\r\na,b,c')).toThrow(/empty column/);
  });

  it('throws on empty key cell in a row', () => {
    expect(() => parseCsvRows('key,en\r\n,1')).toThrow(/empty key column/);
  });

  it('throws on a blank line in the middle of the body', () => {
    expect(() => parseCsvRows('key,en\r\na,1\r\n,\r\nb,2')).toThrow(/blank line inside CSV body/);
  });
});

describe('CSV round-trip', () => {
  it('parses an exported project back into rows whose text matches', () => {
    const project = buildProject(
      ['en', 'pl-PL'],
      [
        buildKey('items', {
          en: '{count, plural, =0 {No items} one {# item} other {# items}}',
          'pl-PL': '{count, plural, =0 {Brak} one {# rzecz} other {# rzeczy}}',
        }),
        buildKey('greeting', { en: 'Hello {name}', 'pl-PL': 'Cześć {name}' }),
      ],
    );
    const csv = exportProjectToCsv(project);
    const rows = parseCsvRows(csv);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const key of project.keys) {
      const row = byKey.get(key.path);
      expect(row).toBeDefined();
      for (const locale of project.locales) {
        const value = key.values[locale]!;
        const cell = row!.values[locale];
        expect(cell).toBe(value.raw ?? renderICU(value.ir));
      }
    }
  });
});

describe('CSV property — exported text survives a parse', () => {
  it('exports → parses to per-(key, locale) cell text identical to raw', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc.string({
              minLength: 1,
              maxLength: 16,
              unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
            }),
            nodes: arbitraryIcuNodes(2),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (rawKeys) => {
          // Dedup paths — collisions skip rather than throw inside composeProject.
          const seenPaths = new Set<string>();
          const keys: TranslationKey[] = [];
          for (const { path, nodes } of rawKeys) {
            if (seenPaths.has(path)) continue;
            seenPaths.add(path);
            const raw = renderICU(nodes);
            keys.push(buildKey(path, { en: raw, 'pl-PL': raw }));
          }
          if (keys.length === 0) return;
          const project = buildProject(['en', 'pl-PL'], keys);
          const csv = exportProjectToCsv(project);
          const rows = parseCsvRows(csv);
          const byKey = new Map(rows.map((r) => [r.key, r]));
          for (const key of project.keys) {
            const row = byKey.get(key.path);
            expect(row).toBeDefined();
            for (const locale of project.locales) {
              const expected = key.values[locale]!.raw!;
              expect(row!.values[locale]).toBe(expected);
            }
          }
        },
      ),
      { numRuns: 80 },
    );
  });
});
