import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFlatJson } from './json-flat.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, '../../fixtures/json-flat/basic');

function readFixture(name: string): string {
  return readFileSync(resolve(fixtureDir, name), 'utf8');
}

describe('parseFlatJson', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('parses the basic en.json fixture into single-locale TranslationKeys', () => {
    const text = readFixture('en.json');
    const result = parseFlatJson({ fileName: 'en.json', text });

    expect(result.locale).toBe('en');
    expect(result.format).toBe('json-flat');
    expect(result.path).toBe('en.json');
    expect(result.keys).toHaveLength(7);
    expect(result.keys.every((k) => k.status === 'ok')).toBe(true);

    const greeting = result.keys.find((k) => k.path === 'greeting')!;
    expect(greeting.id).toBe('greeting');
    expect(greeting.values.en).toEqual({
      ir: [
        { kind: 'text', value: 'Hello ' },
        { kind: 'placeholder', name: 'name' },
      ],
      raw: 'Hello {name}',
      reviewed: false,
      modifiedAt: 0,
      source: 'imported',
    });
  });

  it('detects locale from a path-prefixed filename', () => {
    const result = parseFlatJson({
      fileName: 'l10n/pl_PL.json',
      text: '{"hi":"Cześć"}',
    });
    expect(result.locale).toBe('pl-PL');
  });

  it('strips a leading BOM', () => {
    const text = String.fromCharCode(0xfeff) + readFixture('en.json');
    const result = parseFlatJson({ fileName: 'en.json', text });
    expect(result.keys).toHaveLength(7);
  });

  it('throws when the filename does not encode a locale', () => {
    expect(() => parseFlatJson({ fileName: 'translations.json', text: '{}' })).toThrowError(
      /could not detect locale/i,
    );
  });

  it('throws on invalid JSON with the file name in the message', () => {
    expect(() => parseFlatJson({ fileName: 'en.json', text: 'not json' })).toThrowError(
      /invalid JSON in "en\.json"/,
    );
  });

  it('throws when the top level is not an object', () => {
    expect(() => parseFlatJson({ fileName: 'en.json', text: '[]' })).toThrowError(
      /must contain a top-level JSON object/,
    );
  });

  it('throws when a value is not a string, naming the offending key', () => {
    expect(() => parseFlatJson({ fileName: 'en.json', text: '{"count": 3}' })).toThrowError(
      /value for key "count".*must be a string \(got number\)/,
    );
  });

  it('throws on malformed ICU value with the offending key in the message', () => {
    expect(() =>
      parseFlatJson({ fileName: 'en.json', text: '{"broken": "{n, plural, one {x}"}' }),
    ).toThrowError(/value for key "broken".*not valid ICU MessageFormat/);
  });

  it('parses ICU plural / select / tag fixture into structural IR', () => {
    const fixtureRoot = resolve(here, '../../fixtures/json-flat/icu');
    const text = readFileSync(resolve(fixtureRoot, 'en.json'), 'utf8');
    const result = parseFlatJson({ fileName: 'icu/en.json', text });

    const items = result.keys.find((k) => k.path === 'items')!;
    expect(items.values.en?.ir).toEqual([
      {
        kind: 'plural',
        arg: 'count',
        offset: 1,
        cases: {
          '=0': [{ kind: 'text', value: 'No items' }],
          '=1': [{ kind: 'text', value: 'One item' }],
          one: [
            { kind: 'text', value: '#' },
            { kind: 'text', value: ' item' },
          ],
          other: [
            { kind: 'text', value: '#' },
            { kind: 'text', value: ' items' },
          ],
        },
      },
    ]);

    const total = result.keys.find((k) => k.path === 'total')!;
    expect(total.values.en?.ir).toEqual([
      { kind: 'text', value: 'Total: ' },
      { kind: 'placeholder', name: 'amount', type: 'number', format: '::currency/USD' },
    ]);

    const checkout = result.keys.find((k) => k.path === 'checkout')!;
    expect(checkout.values.en?.ir).toEqual([
      { kind: 'text', value: 'Read ' },
      { kind: 'tag', name: 'b', children: [{ kind: 'text', value: 'the docs' }] },
    ]);
  });
});
