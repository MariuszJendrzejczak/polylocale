import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalizationProject } from '../model/types.js';
import { composeProject } from '../model/compose.js';
import { parseArb } from '../parsers/arb.js';
import { exportArb } from './arb.js';

const here = dirname(fileURLToPath(import.meta.url));
const basicDir = resolve(here, '../../fixtures/arb/basic');
const metadataDir = resolve(here, '../../fixtures/arb/metadata-rich');
const realworldDir = resolve(here, '../../fixtures/arb/realworld');

function readFixture(dir: string, name: string): string {
  return readFileSync(resolve(dir, name), 'utf8');
}

function buildBasicProject(): LocalizationProject {
  const en = parseArb({ fileName: 'en.arb', text: readFixture(basicDir, 'en.arb') });
  const pl = parseArb({ fileName: 'pl.arb', text: readFixture(basicDir, 'pl.arb') });
  return composeProject({
    id: 'demo',
    name: 'demo',
    baseLocale: 'en',
    sources: [en, pl],
  });
}

function buildMetadataProject(): LocalizationProject {
  const en = parseArb({ fileName: 'en.arb', text: readFixture(metadataDir, 'en.arb') });
  const pl = parseArb({ fileName: 'pl.arb', text: readFixture(metadataDir, 'pl.arb') });
  return composeProject({
    id: 'meta',
    name: 'meta',
    baseLocale: 'en',
    sources: [en, pl],
  });
}

function buildRealworldProject(): LocalizationProject {
  const en = parseArb({ fileName: 'en.arb', text: readFixture(realworldDir, 'en.arb') });
  const pl = parseArb({ fileName: 'pl.arb', text: readFixture(realworldDir, 'pl.arb') });
  return composeProject({
    id: 'rw',
    name: 'rw',
    baseLocale: 'en',
    sources: [en, pl],
  });
}

describe('exportArb', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  describe('basic fixture', () => {
    it('reproduces basic/en.arb byte-for-byte', () => {
      const project = buildBasicProject();
      expect(exportArb(project, 'en')).toBe(readFixture(basicDir, 'en.arb'));
    });

    it('reproduces basic/pl.arb byte-for-byte', () => {
      const project = buildBasicProject();
      expect(exportArb(project, 'pl')).toBe(readFixture(basicDir, 'pl.arb'));
    });

    it('matches snapshot for en', async () => {
      const project = buildBasicProject();
      await expect(exportArb(project, 'en')).toMatchFileSnapshot('./__snapshots__/basic.en.arb');
    });

    it('matches snapshot for pl', async () => {
      const project = buildBasicProject();
      await expect(exportArb(project, 'pl')).toMatchFileSnapshot('./__snapshots__/basic.pl.arb');
    });
  });

  describe('metadata-rich fixture', () => {
    it('reproduces metadata-rich/en.arb byte-for-byte', () => {
      const project = buildMetadataProject();
      expect(exportArb(project, 'en')).toBe(readFixture(metadataDir, 'en.arb'));
    });

    it('reproduces metadata-rich/pl.arb byte-for-byte', () => {
      const project = buildMetadataProject();
      expect(exportArb(project, 'pl')).toBe(readFixture(metadataDir, 'pl.arb'));
    });

    it('matches snapshot for en', async () => {
      const project = buildMetadataProject();
      await expect(exportArb(project, 'en')).toMatchFileSnapshot(
        './__snapshots__/metadata-rich.en.arb',
      );
    });

    it('matches snapshot for pl', async () => {
      const project = buildMetadataProject();
      await expect(exportArb(project, 'pl')).toMatchFileSnapshot(
        './__snapshots__/metadata-rich.pl.arb',
      );
    });
  });

  describe('realworld fixture', () => {
    it('round-trips translation keys deepEqual (file-level @@locale gained, by design)', () => {
      const first = buildRealworldProject();
      const enText = exportArb(first, 'en');
      const plText = exportArb(first, 'pl');
      const second = composeProject({
        id: 'rw',
        name: 'rw',
        baseLocale: 'en',
        sources: [
          parseArb({ fileName: 'en.arb', text: enText }),
          parseArb({ fileName: 'pl.arb', text: plText }),
        ],
      });
      // Translation keys must round-trip exactly. SourceFile.formatMetadata
      // legitimately gains a synthesized @@locale on the second pass — the
      // realworld fixture omits it on input, the exporter adds it (per spec),
      // and the second parse captures it. That's a documented asymmetry.
      expect(second.keys).toEqual(first.keys);
    });

    it('snapshots the rendered en + pl', async () => {
      const project = buildRealworldProject();
      await expect(exportArb(project, 'en')).toMatchFileSnapshot(
        './__snapshots__/realworld.en.arb',
      );
      await expect(exportArb(project, 'pl')).toMatchFileSnapshot(
        './__snapshots__/realworld.pl.arb',
      );
    });

    it('synthesizes @@locale when the source had none', () => {
      const project = buildRealworldProject();
      expect(exportArb(project, 'en').startsWith('{\n  "@@locale": "en",\n')).toBe(true);
    });

    it('emits @key blocks on the pl export even though the source pl.arb had none', () => {
      const project = buildRealworldProject();
      const out = exportArb(project, 'pl');
      expect(out).toContain('"@deselect": {');
      expect(out).toContain('"description": "Deselect a (selectable) item"');
    });
  });

  describe('full round-trip across all fixtures', () => {
    it('basic: parse → export → parse → compose deepEqual', () => {
      const first = buildBasicProject();
      const second = composeProject({
        id: 'demo',
        name: 'demo',
        baseLocale: 'en',
        sources: [
          parseArb({ fileName: 'en.arb', text: exportArb(first, 'en') }),
          parseArb({ fileName: 'pl.arb', text: exportArb(first, 'pl') }),
        ],
      });
      expect(second).toEqual(first);
    });

    it('metadata-rich: parse → export → parse → compose deepEqual', () => {
      const first = buildMetadataProject();
      const second = composeProject({
        id: 'meta',
        name: 'meta',
        baseLocale: 'en',
        sources: [
          parseArb({ fileName: 'en.arb', text: exportArb(first, 'en') }),
          parseArb({ fileName: 'pl.arb', text: exportArb(first, 'pl') }),
        ],
      });
      expect(second).toEqual(first);
    });
  });

  describe('determinism and structural rules', () => {
    it('always emits a trailing newline', () => {
      const project = buildBasicProject();
      expect(exportArb(project, 'en').endsWith('\n')).toBe(true);
    });

    it('skips keys that have no value for the requested locale', () => {
      const en = parseArb({
        fileName: 'en.arb',
        text: JSON.stringify({ '@@locale': 'en', a: 'A', b: 'B' }),
      });
      const pl = parseArb({
        fileName: 'pl.arb',
        text: JSON.stringify({ '@@locale': 'pl', a: 'A-pl' }),
      });
      const project = composeProject({
        id: 'demo',
        name: 'demo',
        baseLocale: 'en',
        sources: [en, pl],
      });
      const out = exportArb(project, 'pl');
      expect(out).toContain('"a": "A-pl"');
      expect(out).not.toContain('"b":');
    });

    it('emits @key blocks immediately after their translation key', () => {
      const project = buildBasicProject();
      const out = exportArb(project, 'en');
      const greetingIdx = out.indexOf('"greeting":');
      const atGreetingIdx = out.indexOf('"@greeting":');
      const itemsIdx = out.indexOf('"items":');
      expect(greetingIdx).toBeGreaterThan(-1);
      expect(atGreetingIdx).toBeGreaterThan(greetingIdx);
      expect(atGreetingIdx).toBeLessThan(itemsIdx);
    });

    it('puts @@locale first when it was missing on input', () => {
      const en = parseArb({ fileName: 'en.arb', text: JSON.stringify({ foo: 'x' }) });
      const project = composeProject({
        id: 'demo',
        name: 'demo',
        baseLocale: 'en',
        sources: [en],
      });
      const out = exportArb(project, 'en');
      const localeIdx = out.indexOf('"@@locale"');
      const fooIdx = out.indexOf('"foo"');
      expect(localeIdx).toBeGreaterThan(-1);
      expect(localeIdx).toBeLessThan(fooIdx);
    });

    it('preserves @@-key insertion order from the source', () => {
      const en = parseArb({
        fileName: 'en.arb',
        text: JSON.stringify({
          '@@last_modified': 'now',
          '@@locale': 'en',
          '@@x-author': 'me',
          foo: 'x',
        }),
      });
      const project = composeProject({
        id: 'demo',
        name: 'demo',
        baseLocale: 'en',
        sources: [en],
      });
      const out = exportArb(project, 'en');
      const lmIdx = out.indexOf('"@@last_modified"');
      const locIdx = out.indexOf('"@@locale"');
      const authorIdx = out.indexOf('"@@x-author"');
      expect(lmIdx).toBeLessThan(locIdx);
      expect(locIdx).toBeLessThan(authorIdx);
    });

    it('omits @key block entirely when description, placeholders, and keyMetadata are all empty', () => {
      const project = buildBasicProject();
      const out = exportArb(project, 'en');
      expect(out).toContain('"save": "Save"');
      expect(out).not.toContain('"@save":');
    });

    it('falls back to renderICU when the IR has been edited away from raw', () => {
      const project = buildBasicProject();
      const greeting = project.keys.find((k) => k.path === 'greeting')!;
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
          k.path === 'greeting' ? { ...k, values: { ...k.values, en: dirty } } : k,
        ),
      };
      const out = exportArb(dirtyProject, 'en');
      expect(out).toContain('"greeting": "Hello {who}"');
      expect(out).not.toContain('"greeting": "Hello {name}"');
    });
  });
});
