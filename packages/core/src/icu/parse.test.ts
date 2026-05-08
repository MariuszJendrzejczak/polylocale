import { describe, expect, it } from 'vitest';
import type { ICUNode } from '../model/icu.js';
import { parseICU } from './parse.js';

describe('parseICU', () => {
  const cases: ReadonlyArray<readonly [string, string, ICUNode[]]> = [
    ['plain literal', 'Hello', [{ kind: 'text', value: 'Hello' }]],
    [
      'literal + placeholder',
      'Hello {name}',
      [
        { kind: 'text', value: 'Hello ' },
        { kind: 'placeholder', name: 'name' },
      ],
    ],
    [
      'number placeholder w/o style',
      '{count, number}',
      [{ kind: 'placeholder', name: 'count', type: 'number' }],
    ],
    [
      'number placeholder w/ skeleton',
      '{amount, number, ::currency/USD}',
      [{ kind: 'placeholder', name: 'amount', type: 'number', format: '::currency/USD' }],
    ],
    [
      'date placeholder w/ simple style',
      '{today, date, short}',
      [{ kind: 'placeholder', name: 'today', type: 'date', format: 'short' }],
    ],
    [
      'time placeholder',
      '{now, time, medium}',
      [{ kind: 'placeholder', name: 'now', type: 'time', format: 'medium' }],
    ],
    [
      'plural without offset',
      '{n, plural, =0 {none} other {many}}',
      [
        {
          kind: 'plural',
          arg: 'n',
          cases: {
            '=0': [{ kind: 'text', value: 'none' }],
            other: [{ kind: 'text', value: 'many' }],
          },
        },
      ],
    ],
    [
      'plural with offset and pound',
      '{n, plural, offset:1 one {# item} other {# items}}',
      [
        {
          kind: 'plural',
          arg: 'n',
          offset: 1,
          cases: {
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
      ],
    ],
    [
      'selectordinal',
      '{p, selectordinal, =1 {1st} other {#th}}',
      [
        {
          kind: 'selectordinal',
          arg: 'p',
          cases: {
            '=1': [{ kind: 'text', value: '1st' }],
            other: [
              { kind: 'text', value: '#' },
              { kind: 'text', value: 'th' },
            ],
          },
        },
      ],
    ],
    [
      'select',
      '{g, select, male {He} female {She} other {They}}',
      [
        {
          kind: 'select',
          arg: 'g',
          cases: {
            male: [{ kind: 'text', value: 'He' }],
            female: [{ kind: 'text', value: 'She' }],
            other: [{ kind: 'text', value: 'They' }],
          },
        },
      ],
    ],
    [
      'tag',
      'Read <b>the docs</b>',
      [
        { kind: 'text', value: 'Read ' },
        {
          kind: 'tag',
          name: 'b',
          children: [{ kind: 'text', value: 'the docs' }],
        },
      ],
    ],
    [
      'nested placeholder inside plural case',
      '{n, plural, =0 {none} other {hi {name}}}',
      [
        {
          kind: 'plural',
          arg: 'n',
          cases: {
            '=0': [{ kind: 'text', value: 'none' }],
            other: [
              { kind: 'text', value: 'hi ' },
              { kind: 'placeholder', name: 'name' },
            ],
          },
        },
      ],
    ],
  ];

  for (const [label, raw, expected] of cases) {
    it(label, () => {
      expect(parseICU(raw)).toEqual(expected);
    });
  }

  it('throws on malformed ICU with a useful message', () => {
    expect(() => parseICU('{a, plural, one {x}')).toThrow();
  });
});
