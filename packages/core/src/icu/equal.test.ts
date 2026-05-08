import { describe, expect, it } from 'vitest';
import type { ICUNode } from '../model/icu.js';
import { icuEqual } from './equal.js';

const text = (v: string): ICUNode => ({ kind: 'text', value: v });

describe('icuEqual', () => {
  it('returns true for structurally identical trees', () => {
    const a: ICUNode[] = [text('hi '), { kind: 'placeholder', name: 'n' }];
    const b: ICUNode[] = [text('hi '), { kind: 'placeholder', name: 'n' }];
    expect(icuEqual(a, b)).toBe(true);
  });

  it('returns false on length mismatch', () => {
    expect(icuEqual([text('a')], [text('a'), text('b')])).toBe(false);
  });

  it('returns false on text value mismatch', () => {
    expect(icuEqual([text('a')], [text('b')])).toBe(false);
  });

  it('returns false on placeholder type mismatch', () => {
    expect(
      icuEqual(
        [{ kind: 'placeholder', name: 'n', type: 'number' }],
        [{ kind: 'placeholder', name: 'n', type: 'date' }],
      ),
    ).toBe(false);
  });

  it('returns false on plural offset mismatch', () => {
    expect(
      icuEqual(
        [{ kind: 'plural', arg: 'n', offset: 1, cases: { other: [text('x')] } }],
        [{ kind: 'plural', arg: 'n', offset: 2, cases: { other: [text('x')] } }],
      ),
    ).toBe(false);
  });

  it('returns false when plural case keys differ', () => {
    expect(
      icuEqual(
        [{ kind: 'plural', arg: 'n', cases: { one: [text('x')], other: [text('y')] } }],
        [{ kind: 'plural', arg: 'n', cases: { few: [text('x')], other: [text('y')] } }],
      ),
    ).toBe(false);
  });

  it('treats plural cases as an unordered set (insertion order ignored)', () => {
    const a: ICUNode[] = [
      { kind: 'plural', arg: 'n', cases: { one: [text('a')], other: [text('b')] } },
    ];
    const b: ICUNode[] = [
      { kind: 'plural', arg: 'n', cases: { other: [text('b')], one: [text('a')] } },
    ];
    expect(icuEqual(a, b)).toBe(true);
  });

  it('recurses into tag children', () => {
    expect(
      icuEqual(
        [{ kind: 'tag', name: 'b', children: [text('hi')] }],
        [{ kind: 'tag', name: 'b', children: [text('bye')] }],
      ),
    ).toBe(false);
  });

  it('discriminator mismatch fails fast', () => {
    expect(icuEqual([text('a')], [{ kind: 'placeholder', name: 'a' }])).toBe(false);
  });
});
