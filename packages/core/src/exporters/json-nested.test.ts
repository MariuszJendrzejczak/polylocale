import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalizationProject, TranslationKey } from '../model/types.js';
import { composeProject } from '../model/compose.js';
import { parseNestedJson } from '../parsers/json-nested.js';
import { exportNestedJson } from './json-nested.js';

const here = dirname(fileURLToPath(import.meta.url));
const basicDir = resolve(here, '../../fixtures/json-nested/basic');
const icuDir = resolve(here, '../../fixtures/json-nested/mixed-icu');
const realworldDir = resolve(here, '../../fixtures/json-nested/realworld');

function readFixture(dir: string, name: string): string {
  return readFileSync(resolve(dir, name), 'utf8');
}

function buildProject(dir: string) {
  const en = parseNestedJson({ fileName: 'en.json', text: readFixture(dir, 'en.json') });
  const pl = parseNestedJson({
    fileName: 'pl-PL.json',
    text: readFixture(dir, 'pl-PL.json'),
  });
  return composeProject({
    id: 'demo',
    name: 'demo',
    baseLocale: 'en',
    sources: [en, pl],
  });
}

describe('exportNestedJson', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('reproduces the basic en.json fixture byte-for-byte', () => {
    const project = buildProject(basicDir);
    expect(exportNestedJson(project, 'en')).toBe(readFixture(basicDir, 'en.json'));
  });

  it('reproduces the basic pl-PL.json fixture byte-for-byte', () => {
    const project = buildProject(basicDir);
    expect(exportNestedJson(project, 'pl-PL')).toBe(readFixture(basicDir, 'pl-PL.json'));
  });

  it('matches the snapshot for basic en', async () => {
    const project = buildProject(basicDir);
    const out = exportNestedJson(project, 'en');
    await expect(out).toMatchFileSnapshot('./__snapshots__/nested.basic.en.json');
  });

  it('matches the snapshot for basic pl-PL', async () => {
    const project = buildProject(basicDir);
    const out = exportNestedJson(project, 'pl-PL');
    await expect(out).toMatchFileSnapshot('./__snapshots__/nested.basic.pl-PL.json');
  });

  it('round-trips parse → compose → export → parse → compose for the basic fixture', () => {
    const first = buildProject(basicDir);

    const enText = exportNestedJson(first, 'en');
    const plText = exportNestedJson(first, 'pl-PL');

    const second = composeProject({
      id: 'demo',
      name: 'demo',
      baseLocale: 'en',
      sources: [
        parseNestedJson({ fileName: 'en.json', text: enText }),
        parseNestedJson({ fileName: 'pl-PL.json', text: plText }),
      ],
    });

    expect(second).toEqual(first);
  });

  describe('with ICU fixture (raw shortcut path)', () => {
    it('round-trips mixed-icu/en.json byte-for-byte', () => {
      const project = buildProject(icuDir);
      expect(exportNestedJson(project, 'en')).toBe(readFixture(icuDir, 'en.json'));
    });

    it('round-trips mixed-icu/pl-PL.json byte-for-byte', () => {
      const project = buildProject(icuDir);
      expect(exportNestedJson(project, 'pl-PL')).toBe(readFixture(icuDir, 'pl-PL.json'));
    });
  });

  it('skips keys without a value for the requested locale', () => {
    const en = parseNestedJson({
      fileName: 'en.json',
      text: '{"home":{"a":"A","b":"B"}}',
    });
    const pl = parseNestedJson({
      fileName: 'pl-PL.json',
      text: '{"home":{"a":"A-pl"}}',
    });
    const project = composeProject({
      id: 'demo',
      name: 'demo',
      baseLocale: 'en',
      sources: [en, pl],
    });

    expect(exportNestedJson(project, 'pl-PL')).toBe('{\n  "home": {\n    "a": "A-pl"\n  }\n}\n');
  });

  it('always emits a trailing newline', () => {
    const project = buildProject(basicDir);
    expect(exportNestedJson(project, 'en').endsWith('\n')).toBe(true);
  });

  it('falls back to renderICU when the IR has been edited away from raw', () => {
    const project = buildProject(icuDir);

    const greeting = project.keys.find((k) => k.path === 'home.greeting')!;
    const original = greeting.values.en!;
    const dirty: typeof original = {
      ...original,
      ir: [
        { kind: 'text', value: 'Hello ' },
        { kind: 'placeholder', name: 'who' },
      ],
    };
    const dirtyProject: LocalizationProject = {
      ...project,
      keys: project.keys.map((k) =>
        k.path === 'home.greeting' ? { ...k, values: { ...k.values, en: dirty } } : k,
      ),
    };

    const out = exportNestedJson(dirtyProject, 'en');
    expect(out).toContain('"greeting": "Hello {who}"');
    expect(out).not.toContain('"greeting": "Hello {name}"');
  });

  describe('realworld fixture (Excalidraw slice)', () => {
    function buildRealworldProject() {
      const en = parseNestedJson({
        fileName: 'en.json',
        text: readFixture(realworldDir, 'en.json'),
      });
      const de = parseNestedJson({
        fileName: 'de.json',
        text: readFixture(realworldDir, 'de.json'),
      });
      return composeProject({
        id: 'rw',
        name: 'rw',
        baseLocale: 'en',
        sources: [en, de],
      });
    }

    it('round-trips en byte-for-byte', () => {
      const project = buildRealworldProject();
      expect(exportNestedJson(project, 'en')).toBe(readFixture(realworldDir, 'en.json'));
    });

    it('round-trips de byte-for-byte', () => {
      const project = buildRealworldProject();
      expect(exportNestedJson(project, 'de')).toBe(readFixture(realworldDir, 'de.json'));
    });
  });

  it('throws when a leaf path is also a parent of another path', () => {
    const project = buildCollidingProject('home', 'home.title');
    expect(() => exportNestedJson(project, 'en')).toThrowError(
      /path "home" is a leaf and also a parent of "home\.title"/,
    );
  });

  it('throws when a parent path appears after the leaf path with prefix conflict', () => {
    const project = buildCollidingProject('a.b.c', 'a.b');
    expect(() => exportNestedJson(project, 'en')).toThrowError(
      /path "a\.b" is a leaf and also a parent of "a\.b\.c"/,
    );
  });
});

function buildCollidingProject(pathA: string, pathB: string): LocalizationProject {
  const make = (path: string): TranslationKey => ({
    id: path,
    path,
    values: {
      en: {
        ir: [{ kind: 'text', value: path }],
        reviewed: false,
        modifiedAt: 0,
        source: 'manual',
      },
    },
    status: 'ok',
  });
  return {
    id: 'collide',
    name: 'collide',
    locales: ['en'],
    baseLocale: 'en',
    keys: [make(pathA), make(pathB)],
    files: [],
    settings: {},
  };
}
