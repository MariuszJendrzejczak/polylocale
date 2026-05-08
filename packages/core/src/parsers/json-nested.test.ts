import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseNestedJson } from './json-nested.js';

const here = dirname(fileURLToPath(import.meta.url));
const basicDir = resolve(here, '../../fixtures/json-nested/basic');
const icuDir = resolve(here, '../../fixtures/json-nested/mixed-icu');

function readFixture(dir: string, name: string): string {
  return readFileSync(resolve(dir, name), 'utf8');
}

describe('parseNestedJson', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('flattens the basic en.json fixture into dot-segmented paths', () => {
    const text = readFixture(basicDir, 'en.json');
    const result = parseNestedJson({ fileName: 'en.json', text });

    expect(result.locale).toBe('en');
    expect(result.format).toBe('json-nested');
    expect(result.path).toBe('en.json');
    expect(result.formatMetadata).toBeUndefined();

    const paths = result.keys.map((k) => k.path).sort();
    expect(paths).toEqual([
      'actions.cancel',
      'actions.ok',
      'actions.save',
      'app.title',
      'home.greeting',
      'home.welcome',
      'settings.section.appearance',
      'settings.section.language',
      'settings.title',
    ]);

    const greeting = result.keys.find((k) => k.path === 'home.greeting')!;
    expect(greeting.id).toBe('home.greeting');
    expect(greeting.values.en).toEqual({
      ir: [{ kind: 'text', value: 'Hello' }],
      raw: 'Hello',
      reviewed: false,
      modifiedAt: 0,
      source: 'imported',
    });
  });

  it('parses ICU values inside nested leaves into structural IR', () => {
    const text = readFixture(icuDir, 'en.json');
    const result = parseNestedJson({ fileName: 'en.json', text });

    const items = result.keys.find((k) => k.path === 'cart.items')!;
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

    const checkout = result.keys.find((k) => k.path === 'home.marketing.checkout')!;
    expect(checkout.values.en?.ir).toEqual([
      { kind: 'text', value: 'Read ' },
      { kind: 'tag', name: 'b', children: [{ kind: 'text', value: 'the docs' }] },
    ]);

    const total = result.keys.find((k) => k.path === 'cart.total')!;
    expect(total.values.en?.ir).toEqual([
      { kind: 'text', value: 'Total: ' },
      { kind: 'placeholder', name: 'amount', type: 'number', format: '::currency/USD' },
    ]);
  });

  it('detects locale from a path-prefixed filename', () => {
    const result = parseNestedJson({
      fileName: 'l10n/pl_PL.json',
      text: '{"hi":"Cześć"}',
    });
    expect(result.locale).toBe('pl-PL');
  });

  it('strips a leading BOM', () => {
    const text = String.fromCharCode(0xfeff) + readFixture(basicDir, 'en.json');
    const result = parseNestedJson({ fileName: 'en.json', text });
    expect(result.keys.length).toBeGreaterThan(0);
  });

  it('throws when the filename does not encode a locale', () => {
    expect(() => parseNestedJson({ fileName: 'translations.json', text: '{}' })).toThrowError(
      /could not detect locale/i,
    );
  });

  it('throws on invalid JSON with the file name in the message', () => {
    expect(() => parseNestedJson({ fileName: 'en.json', text: 'not json' })).toThrowError(
      /invalid JSON in "en\.json"/,
    );
  });

  it('throws when the top level is not an object', () => {
    expect(() => parseNestedJson({ fileName: 'en.json', text: '[]' })).toThrowError(
      /must contain a top-level JSON object/,
    );
  });

  it('rejects an object key that contains a literal dot', () => {
    expect(() =>
      parseNestedJson({
        fileName: 'en.json',
        text: '{"home": {"app.v1.title": "x"}}',
      }),
    ).toThrowError(/key segment "app\.v1\.title" at "home\.app\.v1\.title".*literal '\.'/);
  });

  it('rejects a top-level key that contains a literal dot', () => {
    expect(() => parseNestedJson({ fileName: 'en.json', text: '{"a.b": "x"}' })).toThrowError(
      /key segment "a\.b" at "a\.b".*literal '\.'/,
    );
  });

  it('rejects an array as a value', () => {
    expect(() =>
      parseNestedJson({ fileName: 'en.json', text: '{"home": {"items": ["a", "b"]}}' }),
    ).toThrowError(/value at "home\.items".*must not be an array/);
  });

  it('rejects a number as a leaf value', () => {
    expect(() => parseNestedJson({ fileName: 'en.json', text: '{"count": 3}' })).toThrowError(
      /value at "count".*must be a string or object \(got number\)/,
    );
  });

  it('rejects a boolean as a leaf value', () => {
    expect(() => parseNestedJson({ fileName: 'en.json', text: '{"active": true}' })).toThrowError(
      /value at "active".*must be a string or object \(got boolean\)/,
    );
  });

  it('rejects null as a leaf value', () => {
    expect(() => parseNestedJson({ fileName: 'en.json', text: '{"x": null}' })).toThrowError(
      /value at "x".*must be a string or object \(got null\)/,
    );
  });

  it('throws on malformed ICU value with the offending path in the message', () => {
    expect(() =>
      parseNestedJson({
        fileName: 'en.json',
        text: '{"home": {"broken": "{n, plural, one {x}"}}',
      }),
    ).toThrowError(/value at "home\.broken".*not valid ICU MessageFormat/);
  });

  it('allows mixed object/string siblings at the same level', () => {
    const result = parseNestedJson({
      fileName: 'en.json',
      text: '{"hi":"Hello","section":{"title":"Section"}}',
    });
    expect(result.keys.map((k) => k.path).sort()).toEqual(['hi', 'section.title']);
  });
});
