import { describe, expect, it } from 'vitest';
import type { ICUNode } from '@polylocale/core';
import { collectTextNodes } from './icu-walk.js';

describe('collectTextNodes', () => {
  it('returns no texts for a placeholder-only IR', () => {
    const ir: readonly ICUNode[] = [{ kind: 'placeholder', name: 'name' }];
    const collected = collectTextNodes(ir);
    expect(collected.texts).toEqual([]);
    expect(collected.reassemble([])).toEqual(ir);
  });

  it('preserves placeholders and only translates surrounding text', () => {
    const ir: readonly ICUNode[] = [
      { kind: 'text', value: 'Hello ' },
      { kind: 'placeholder', name: 'name' },
      { kind: 'text', value: '!' },
    ];
    const collected = collectTextNodes(ir);
    expect(collected.texts).toEqual(['Hello ', '!']);
    const out = collected.reassemble(['Witaj ', '!']);
    expect(out).toEqual([
      { kind: 'text', value: 'Witaj ' },
      { kind: 'placeholder', name: 'name' },
      { kind: 'text', value: '!' },
    ]);
  });

  it('walks plural cases in declaration order, preserving offset and case keys', () => {
    const ir: readonly ICUNode[] = [
      {
        kind: 'plural',
        arg: 'count',
        offset: 1,
        cases: {
          '=0': [{ kind: 'text', value: 'No items' }],
          one: [{ kind: 'text', value: '# item' }],
          other: [{ kind: 'text', value: '# items' }],
        },
      },
    ];
    const collected = collectTextNodes(ir);
    expect(collected.texts).toEqual(['No items', '# item', '# items']);

    const out = collected.reassemble(['Brak elementów', '# element', '# elementów']);
    expect(out).toEqual([
      {
        kind: 'plural',
        arg: 'count',
        offset: 1,
        cases: {
          '=0': [{ kind: 'text', value: 'Brak elementów' }],
          one: [{ kind: 'text', value: '# element' }],
          other: [{ kind: 'text', value: '# elementów' }],
        },
      },
    ]);
  });

  it('walks nested select-inside-plural without losing structure', () => {
    const ir: readonly ICUNode[] = [
      {
        kind: 'plural',
        arg: 'count',
        cases: {
          one: [
            { kind: 'text', value: 'a ' },
            {
              kind: 'select',
              arg: 'gender',
              cases: {
                female: [{ kind: 'text', value: 'cat' }],
                other: [{ kind: 'text', value: 'pet' }],
              },
            },
          ],
          other: [{ kind: 'text', value: 'pets' }],
        },
      },
    ];
    const collected = collectTextNodes(ir);
    expect(collected.texts).toEqual(['a ', 'cat', 'pet', 'pets']);

    const out = collected.reassemble(['', 'kotka', 'zwierzątko', 'zwierzątka']);
    const plural = out[0];
    expect(plural?.kind).toBe('plural');
    if (plural?.kind !== 'plural') throw new Error('unreachable');
    const oneCase = plural.cases.one;
    expect(oneCase?.[0]).toEqual({ kind: 'text', value: '' });
    const select = oneCase?.[1];
    expect(select?.kind).toBe('select');
    if (select?.kind !== 'select') throw new Error('unreachable');
    expect(select.arg).toBe('gender');
    expect(select.cases.female).toEqual([{ kind: 'text', value: 'kotka' }]);
  });

  it('walks tag children', () => {
    const ir: readonly ICUNode[] = [
      {
        kind: 'tag',
        name: 'b',
        children: [{ kind: 'text', value: 'bold' }],
      },
    ];
    const collected = collectTextNodes(ir);
    expect(collected.texts).toEqual(['bold']);
    expect(collected.reassemble(['pogrubione'])).toEqual([
      {
        kind: 'tag',
        name: 'b',
        children: [{ kind: 'text', value: 'pogrubione' }],
      },
    ]);
  });

  it('throws when the translated array length does not match', () => {
    const ir: readonly ICUNode[] = [{ kind: 'text', value: 'a' }];
    const collected = collectTextNodes(ir);
    expect(() => collected.reassemble([])).toThrowError(/expected 1 translated strings, got 0/);
    expect(() => collected.reassemble(['a', 'b'])).toThrowError(
      /expected 1 translated strings, got 2/,
    );
  });

  it('reassemble does not mutate the original IR', () => {
    const ir: readonly ICUNode[] = [{ kind: 'text', value: 'a' }];
    const out = collectTextNodes(ir).reassemble(['b']);
    expect(out).not.toBe(ir);
    expect(ir[0]).toEqual({ kind: 'text', value: 'a' });
  });
});
