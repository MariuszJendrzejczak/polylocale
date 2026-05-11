import { describe, expect, it } from 'vitest';

import {
  composeProject,
  parseICU,
  type LocaleCode,
  type LocalizationProject,
  type ParsedFile,
  type TranslationKey,
  type TranslationValue,
} from '@polylocale/core';

import { exportProjectAsCsv, importCsvAndPlan } from './translator-handoff.js';

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
  name = 'test',
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
    id: 'p',
    name,
    baseLocale: locales[0]!,
    sources,
  });
}

describe('exportProjectAsCsv', () => {
  it('produces a CSV Blob with the project name as filename', async () => {
    const project = buildProject(['en'], [buildKey('hello', { en: 'Hello' })], 'My Project!!');
    const artifact = exportProjectAsCsv(project);
    expect(artifact.filename).toBe('My_Project-handoff.csv');
    expect(artifact.blob.type).toBe('text/csv;charset=utf-8');
    const text = await artifact.blob.text();
    expect(text.startsWith('key,description,en\r\n')).toBe(true);
  });

  it('falls back to "project" when the name normalizes to empty', async () => {
    const project = buildProject(['en'], [buildKey('k', { en: 'v' })], '___');
    expect(exportProjectAsCsv(project).filename).toBe('project-handoff.csv');
  });
});

describe('importCsvAndPlan — clean applies', () => {
  it('treats every missing-locale row as a clean apply', () => {
    const project = buildProject(
      ['en', 'pl-PL'],
      [buildKey('hello', { en: 'Hello' }), buildKey('bye', { en: 'Bye' })],
    );
    const csv = ['key,en,pl-PL', 'bye,Bye,Pa', 'hello,Hello,Cześć'].join('\r\n');
    const plan = importCsvAndPlan(csv, project);
    expect(plan.parseErrors).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.applies).toHaveLength(2);
    expect(plan.applies.map((a) => a.locale)).toEqual(['pl-PL', 'pl-PL']);
    expect(plan.applies.every((a) => a.source === 'imported')).toBe(true);
  });

  it('emits no-op for rows that already match (raw)', () => {
    const project = buildProject(['en'], [buildKey('hello', { en: 'Hello' })]);
    const csv = ['key,en', 'hello,Hello'].join('\r\n');
    const plan = importCsvAndPlan(csv, project);
    expect(plan).toEqual({ applies: [], conflicts: [], parseErrors: [] });
  });

  it('emits no-op when icuEqual matches even if surface whitespace differs', () => {
    const project = buildProject(
      ['en'],
      [
        buildKey('items', {
          en: '{count, plural, one {# item} other {# items}}',
        }),
      ],
    );
    // Whitespace differs between case bodies — surface differs, IR equal.
    const csv = ['key,en', '"items","{count, plural,  one {# item}  other {# items} }"'].join(
      '\r\n',
    );
    const plan = importCsvAndPlan(csv, project);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.applies).toHaveLength(0);
    expect(plan.parseErrors).toHaveLength(0);
  });
});

describe('importCsvAndPlan — conflicts', () => {
  it('flags a value-set cell whose text differs', () => {
    const project = buildProject(
      ['en', 'pl-PL'],
      [buildKey('hello', { en: 'Hello', 'pl-PL': 'Cześć' })],
    );
    const csv = ['key,en,pl-PL', 'hello,Hello,Witaj'].join('\r\n');
    const plan = importCsvAndPlan(csv, project);
    expect(plan.applies).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
    const c = plan.conflicts[0]!;
    expect(c.keyPath).toBe('hello');
    expect(c.locale).toBe('pl-PL');
    expect(c.currentText).toBe('Cześć');
    expect(c.incomingText).toBe('Witaj');
    expect(c.incomingIr).not.toBeNull();
  });

  it('flags a cleared cell as conflict with incomingIr === null', () => {
    const project = buildProject(
      ['en', 'pl-PL'],
      [buildKey('hello', { en: 'Hello', 'pl-PL': 'Cześć' })],
    );
    const csv = ['key,en,pl-PL', 'hello,Hello,'].join('\r\n');
    const plan = importCsvAndPlan(csv, project);
    expect(plan.conflicts).toHaveLength(1);
    const c = plan.conflicts[0]!;
    expect(c.incomingText).toBe('');
    expect(c.incomingIr).toBeNull();
    expect(c.currentText).toBe('Cześć');
  });
});

describe('importCsvAndPlan — parse errors', () => {
  it('reports a malformed ICU cell as parse error and skips that cell', () => {
    const project = buildProject(['en', 'pl-PL'], [buildKey('greeting', { en: 'Hello {name}' })]);
    const csv = ['key,en,pl-PL', 'greeting,Hello {name},"Cześć {name, plural"'].join('\r\n');
    const plan = importCsvAndPlan(csv, project);
    expect(plan.parseErrors).toHaveLength(1);
    expect(plan.parseErrors[0]!.keyPath).toBe('greeting');
    expect(plan.parseErrors[0]!.locale).toBe('pl-PL');
    expect(plan.parseErrors[0]!.kind).toBe('parse-error');
    // pl-PL was missing → would normally be a clean apply if parse had succeeded,
    // but it errored. en is a no-op match.
    expect(plan.applies).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });
});

describe('importCsvAndPlan — unknown rows', () => {
  it('reports unknown keys and skips the row', () => {
    const project = buildProject(['en'], [buildKey('hello', { en: 'Hello' })]);
    const csv = ['key,en', 'hello,Hello', 'mystery,Mystery'].join('\r\n');
    const plan = importCsvAndPlan(csv, project);
    expect(plan.parseErrors).toHaveLength(1);
    expect(plan.parseErrors[0]!.kind).toBe('unknown-key');
    expect(plan.parseErrors[0]!.keyPath).toBe('mystery');
    expect(plan.applies).toHaveLength(0);
  });

  it('reports unknown columns once per file', () => {
    const project = buildProject(['en'], [buildKey('hello', { en: 'Hello' })]);
    const csv = ['key,en,comments', 'hello,Hello,note here'].join('\r\n');
    const plan = importCsvAndPlan(csv, project);
    expect(plan.parseErrors).toHaveLength(1);
    expect(plan.parseErrors[0]!.kind).toBe('unknown-column');
    expect(plan.parseErrors[0]!.column).toBe('comments');
    // The known en column still no-ops cleanly.
    expect(plan.applies).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });
});
