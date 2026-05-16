import { describe, expect, it } from 'vitest';

import type { ICUNode, TranslationKey, TranslationValue } from '@polylocale/core';

import { STATUS_PRIORITY, rowStatusPriority, sortByStatus } from './status-priority.js';

const v = (text: string, placeholders: readonly string[] = []): TranslationValue => {
  const ir: ICUNode[] = [{ kind: 'text', value: text }];
  for (const name of placeholders) ir.push({ kind: 'placeholder', name });
  return { ir, raw: text, reviewed: true, modifiedAt: 0 };
};

const empty = (): TranslationValue => ({
  ir: [{ kind: 'text', value: '   ' }],
  raw: '   ',
  reviewed: true,
  modifiedAt: 0,
});

function key(id: string, values: TranslationKey['values']): TranslationKey {
  return { id, path: id, values, status: 'ok' };
}

describe('rowStatusPriority', () => {
  it('returns "missing" when any locale has no value', () => {
    const k = key('a', { en: v('Hello'), pl: undefined });
    expect(rowStatusPriority(k, ['en', 'pl'], 'en')).toBe(STATUS_PRIORITY.missing);
  });

  it('returns "placeholder-mismatch" when placeholder sets differ', () => {
    const k = key('a', { en: v('Hi {name}', ['name']), pl: v('Cześć', []) });
    expect(rowStatusPriority(k, ['en', 'pl'], 'en')).toBe(STATUS_PRIORITY.placeholderMismatch);
  });

  it('returns "empty" when a non-base locale renders empty and placeholders match', () => {
    const k = key('a', { en: v('Hello'), pl: empty() });
    expect(rowStatusPriority(k, ['en', 'pl'], 'en')).toBe(STATUS_PRIORITY.empty);
  });

  it('returns "ok" when every locale has a non-empty matching value', () => {
    const k = key('a', { en: v('Hello'), pl: v('Cześć') });
    expect(rowStatusPriority(k, ['en', 'pl'], 'en')).toBe(STATUS_PRIORITY.ok);
  });

  it('prefers worse status when multiple issues exist (placeholder beats empty)', () => {
    const k = key('a', {
      en: v('Hi {name}', ['name']),
      pl: empty(),
      de: v('Hallo', []),
    });
    expect(rowStatusPriority(k, ['en', 'pl', 'de'], 'en')).toBe(
      STATUS_PRIORITY.placeholderMismatch,
    );
  });
});

describe('sortByStatus', () => {
  it('puts missing rows first when ascending', () => {
    const a = key('a', { en: v('A'), pl: v('A') });
    const b = key('b', { en: v('B'), pl: undefined });
    const c = key('c', { en: v('C'), pl: empty() });
    const sorted = sortByStatus([a, b, c], ['en', 'pl'], 'en', 'asc');
    expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('reverses order when descending', () => {
    const a = key('a', { en: v('A'), pl: v('A') });
    const b = key('b', { en: v('B'), pl: undefined });
    const sorted = sortByStatus([a, b], ['en', 'pl'], 'en', 'desc');
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('keeps original order between rows with equal priority (stable)', () => {
    const a = key('a', { en: v('A'), pl: v('A') });
    const b = key('b', { en: v('B'), pl: v('B') });
    const sorted = sortByStatus([a, b], ['en', 'pl'], 'en', 'asc');
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
