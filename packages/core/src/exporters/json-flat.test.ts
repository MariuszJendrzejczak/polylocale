import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composeProject } from '../model/compose.js';
import { parseFlatJson } from '../parsers/json-flat.js';
import { exportFlatJson } from './json-flat.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, '../../fixtures/json-flat/basic');

function readFixture(name: string): string {
  return readFileSync(resolve(fixtureDir, name), 'utf8');
}

function buildProject() {
  const en = parseFlatJson({ fileName: 'en.json', text: readFixture('en.json') });
  const pl = parseFlatJson({ fileName: 'pl-PL.json', text: readFixture('pl-PL.json') });
  return composeProject({
    id: 'demo',
    name: 'demo',
    baseLocale: 'en',
    sources: [en, pl],
  });
}

describe('exportFlatJson', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('reproduces the en.json fixture byte-for-byte', () => {
    const project = buildProject();
    const out = exportFlatJson(project, 'en');
    expect(out).toBe(readFixture('en.json'));
  });

  it('reproduces the pl-PL.json fixture byte-for-byte', () => {
    const project = buildProject();
    const out = exportFlatJson(project, 'pl-PL');
    expect(out).toBe(readFixture('pl-PL.json'));
  });

  it('matches the snapshot for en', async () => {
    const project = buildProject();
    const out = exportFlatJson(project, 'en');
    await expect(out).toMatchFileSnapshot('./__snapshots__/basic.en.json');
  });

  it('matches the snapshot for pl-PL', async () => {
    const project = buildProject();
    const out = exportFlatJson(project, 'pl-PL');
    await expect(out).toMatchFileSnapshot('./__snapshots__/basic.pl-PL.json');
  });

  it('round-trips parse → compose → export → parse → compose', () => {
    const first = buildProject();

    const enText = exportFlatJson(first, 'en');
    const plText = exportFlatJson(first, 'pl-PL');

    const second = composeProject({
      id: 'demo',
      name: 'demo',
      baseLocale: 'en',
      sources: [
        parseFlatJson({ fileName: 'en.json', text: enText }),
        parseFlatJson({ fileName: 'pl-PL.json', text: plText }),
      ],
    });

    expect(second).toEqual(first);
  });

  it('skips keys that have no value for the requested locale', () => {
    const en = parseFlatJson({
      fileName: 'en.json',
      text: '{"a":"A","b":"B"}',
    });
    const pl = parseFlatJson({ fileName: 'pl-PL.json', text: '{"a":"A-pl"}' });
    const project = composeProject({
      id: 'demo',
      name: 'demo',
      baseLocale: 'en',
      sources: [en, pl],
    });

    expect(exportFlatJson(project, 'pl-PL')).toBe('{\n  "a": "A-pl"\n}\n');
  });

  it('always emits a trailing newline', () => {
    const project = buildProject();
    expect(exportFlatJson(project, 'en').endsWith('\n')).toBe(true);
  });
});
