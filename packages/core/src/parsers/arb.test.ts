import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArb } from './arb.js';

const here = dirname(fileURLToPath(import.meta.url));
const basicDir = resolve(here, '../../fixtures/arb/basic');
const metadataDir = resolve(here, '../../fixtures/arb/metadata-rich');
const realworldDir = resolve(here, '../../fixtures/arb/realworld');

function readFixture(dir: string, name: string): string {
  return readFileSync(resolve(dir, name), 'utf8');
}

describe('parseArb', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('parses basic/en.arb into translation keys plus fileMeta', () => {
    const text = readFixture(basicDir, 'en.arb');
    const result = parseArb({ fileName: 'en.arb', text });

    expect(result.locale).toBe('en');
    expect(result.format).toBe('arb');
    expect(result.path).toBe('en.arb');
    expect(result.keys).toHaveLength(4);
    expect(result.keys.map((k) => k.path).sort()).toEqual([
      'appTitle',
      'greeting',
      'items',
      'save',
    ]);

    expect(result.formatMetadata).toEqual({
      fileMeta: { '@@locale': 'en' },
      fileMetaOrder: ['@@locale'],
    });

    const greeting = result.keys.find((k) => k.path === 'greeting')!;
    expect(greeting.description).toBe('Friendly greeting on the home screen');
    expect(greeting.placeholders).toEqual([
      { name: 'name', type: 'String', example: 'Jane' },
    ]);
    expect(greeting.values.en?.ir).toEqual([
      { kind: 'text', value: 'Hello ' },
      { kind: 'placeholder', name: 'name' },
    ]);
    expect(greeting.values.en?.raw).toBe('Hello {name}');
  });

  it('parses metadata-rich fixture preserving fileMetaOrder, vendor extensions, and keyMetadata', () => {
    const text = readFixture(metadataDir, 'en.arb');
    const result = parseArb({ fileName: 'en.arb', text });

    expect(result.formatMetadata?.fileMetaOrder).toEqual([
      '@@locale',
      '@@last_modified',
      '@@x-author',
      '@@x-vendor-extension',
    ]);
    const fileMeta = result.formatMetadata?.fileMeta as Record<string, unknown>;
    expect(fileMeta['@@last_modified']).toBe('2026-05-08T14:30:00.000+02:00');
    expect(fileMeta['@@x-vendor-extension']).toEqual({
      trackingId: 'POL-42',
      category: 'marketing',
    });

    const complex = result.keys.find((k) => k.path === 'complex')!;
    expect(complex.description).toBe("Greeting that includes the user's first name");
    expect(complex.placeholders).toEqual([
      {
        name: 'firstName',
        type: 'String',
        example: 'Mariusz',
        description: "End-user's display name as captured during signup",
      },
    ]);
    expect(complex.keyMetadata).toEqual({ context: 'HomeScreen' });

    const userCount = result.keys.find((k) => k.path === 'userCount')!;
    expect(userCount.description).toBeUndefined();
    expect(userCount.placeholders).toEqual([
      { name: 'n', type: 'int', example: '42' },
    ]);
    expect(userCount.keyMetadata).toBeUndefined();

    const welcome = result.keys.find((k) => k.path === 'welcome')!;
    expect(welcome.description).toBeUndefined();
    expect(welcome.placeholders).toBeUndefined();
    expect(welcome.keyMetadata).toBeUndefined();

    const escapes = result.keys.find((k) => k.path === 'escapes')!;
    expect(escapes.description).toBe('Demonstrates ICU escape sequences');
    expect(escapes.values.en?.raw).toBe("Use ''quotes'' and a literal '{' brace");

    const nested = result.keys.find((k) => k.path === 'nested')!;
    expect(nested.values.en?.ir[0]?.kind).toBe('select');
  });

  it('treats an empty placeholders block as missing (round-trips to undefined)', () => {
    const text = JSON.stringify({
      '@@locale': 'en',
      foo: 'Hello',
      '@foo': { description: 'd', placeholders: {} },
    });
    const result = parseArb({ fileName: 'en.arb', text });
    const foo = result.keys.find((k) => k.path === 'foo')!;
    expect(foo.description).toBe('d');
    expect(foo.placeholders).toBeUndefined();
  });

  it('does not include formatMetadata when there are no @@ keys', () => {
    const text = JSON.stringify({ foo: 'Hello' });
    const result = parseArb({ fileName: 'en.arb', text });
    expect(result.formatMetadata).toBeUndefined();
  });

  it('builds TranslationValue with imported source and current modifiedAt', () => {
    const text = JSON.stringify({ '@@locale': 'en', foo: 'Hello' });
    const result = parseArb({ fileName: 'en.arb', text });
    expect(result.keys[0]?.values.en).toEqual({
      ir: [{ kind: 'text', value: 'Hello' }],
      raw: 'Hello',
      reviewed: false,
      modifiedAt: 0,
      source: 'imported',
    });
  });

  it('strips a leading BOM', () => {
    const text = String.fromCharCode(0xfeff) + readFixture(basicDir, 'en.arb');
    const result = parseArb({ fileName: 'en.arb', text });
    expect(result.keys).toHaveLength(4);
  });

  describe('locale resolution', () => {
    it('prefers @@locale over the filename hint', () => {
      const text = JSON.stringify({ '@@locale': 'pl_PL', foo: 'x' });
      const result = parseArb({ fileName: 'en.arb', text });
      expect(result.locale).toBe('pl-PL');
    });

    it('falls back to the filename when @@locale is absent', () => {
      const text = JSON.stringify({ foo: 'x' });
      const result = parseArb({ fileName: 'pl_PL.arb', text });
      expect(result.locale).toBe('pl-PL');
    });

    it('throws when @@locale value is unrecognisable', () => {
      const text = JSON.stringify({ '@@locale': 'not a locale', foo: 'x' });
      expect(() => parseArb({ fileName: 'app.arb', text })).toThrowError(
        /"@@locale" value "not a locale".*not a recognisable locale/,
      );
    });

    it('throws when neither @@locale nor filename yields a locale', () => {
      expect(() =>
        parseArb({ fileName: 'translations.arb', text: '{"foo":"x"}' }),
      ).toThrowError(/could not resolve locale/);
    });
  });

  describe('error reporting', () => {
    it('throws on invalid JSON, naming the file', () => {
      expect(() => parseArb({ fileName: 'en.arb', text: 'not json' })).toThrowError(
        /invalid JSON in "en\.arb"/,
      );
    });

    it('throws when the top level is not an object', () => {
      expect(() => parseArb({ fileName: 'en.arb', text: '[]' })).toThrowError(
        /must contain a top-level JSON object/,
      );
    });

    it('throws when a translation value is not a string, naming the key', () => {
      const text = JSON.stringify({ '@@locale': 'en', count: 3 });
      expect(() => parseArb({ fileName: 'en.arb', text })).toThrowError(
        /value for key "count" must be a string \(got number\)/,
      );
    });

    it('throws when a @key block is not an object', () => {
      const text = JSON.stringify({ '@@locale': 'en', foo: 'x', '@foo': 'oops' });
      expect(() => parseArb({ fileName: 'en.arb', text })).toThrowError(
        /metadata block "@foo" must be a JSON object/,
      );
    });

    it('throws on malformed ICU value, naming the key', () => {
      const text = JSON.stringify({
        '@@locale': 'en',
        broken: '{n, plural, one {x}',
      });
      expect(() => parseArb({ fileName: 'en.arb', text })).toThrowError(
        /value for key "broken".*not valid ICU MessageFormat/,
      );
    });

    it('throws when a placeholder definition is not an object', () => {
      const text = JSON.stringify({
        '@@locale': 'en',
        foo: '{x}',
        '@foo': { placeholders: { x: 'oops' } },
      });
      expect(() => parseArb({ fileName: 'en.arb', text })).toThrowError(
        /placeholder "x" in "@foo" of "en\.arb" must be a JSON object/,
      );
    });

    it('throws when description is not a string', () => {
      const text = JSON.stringify({
        '@@locale': 'en',
        foo: 'x',
        '@foo': { description: 42 },
      });
      expect(() => parseArb({ fileName: 'en.arb', text })).toThrowError(
        /"@foo\.description" in "en\.arb" must be a string/,
      );
    });
  });

  it('parses realworld pl.arb with no @key blocks (target-locale file pattern)', () => {
    const text = readFixture(realworldDir, 'pl.arb');
    const result = parseArb({ fileName: 'pl.arb', text });

    expect(result.locale).toBe('pl');
    expect(result.formatMetadata).toBeUndefined();
    expect(result.keys.every((k) => k.description === undefined)).toBe(true);
    expect(result.keys.every((k) => k.placeholders === undefined)).toBe(true);
    expect(result.keys.every((k) => k.keyMetadata === undefined)).toBe(true);
  });
});
