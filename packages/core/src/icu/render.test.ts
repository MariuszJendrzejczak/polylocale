import { describe, expect, it } from 'vitest';
import type { ICUNode } from '../model/icu.js';
import { renderICU } from './render.js';

describe('renderICU', () => {
  const cases: ReadonlyArray<readonly [string, ICUNode[], string]> = [
    ['plain literal', [{ kind: 'text', value: 'Hello' }], 'Hello'],
    [
      'literal + placeholder',
      [
        { kind: 'text', value: 'Hello ' },
        { kind: 'placeholder', name: 'name' },
      ],
      'Hello {name}',
    ],
    [
      'number placeholder w/o style',
      [{ kind: 'placeholder', name: 'count', type: 'number' }],
      '{count, number}',
    ],
    [
      'number placeholder w/ skeleton',
      [{ kind: 'placeholder', name: 'amount', type: 'number', format: '::currency/USD' }],
      '{amount, number, ::currency/USD}',
    ],
    [
      'plural — numeric cases first, then CLDR keyword order',
      [
        {
          kind: 'plural',
          arg: 'n',
          cases: {
            other: [{ kind: 'text', value: 'b' }],
            one: [{ kind: 'text', value: 'a' }],
            '=0': [{ kind: 'text', value: 'z' }],
          },
        },
      ],
      '{n, plural, =0 {z} one {a} other {b}}',
    ],
    [
      'plural with offset',
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
      '{n, plural, offset:1 one {# item} other {# items}}',
    ],
    [
      'selectordinal',
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
      '{p, selectordinal, =1 {1st} other {#th}}',
    ],
    [
      'select — other rendered last, others in insertion order',
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
      '{g, select, male {He} female {She} other {They}}',
    ],
    [
      'tag',
      [
        { kind: 'text', value: 'Read ' },
        { kind: 'tag', name: 'b', children: [{ kind: 'text', value: 'the docs' }] },
      ],
      'Read <b>the docs</b>',
    ],
    ['literal containing { and }', [{ kind: 'text', value: 'use {x} here' }], "use '{'x'}' here"],
    [
      'literal containing apostrophe (always doubled)',
      [{ kind: 'text', value: "it's bad" }],
      "it''s bad",
    ],
    [
      'multi-char literal that is just `#` outside plural — emitted bare',
      [{ kind: 'text', value: '#' }],
      '#',
    ],
  ];

  for (const [label, ir, expected] of cases) {
    it(label, () => {
      expect(renderICU(ir)).toBe(expected);
    });
  }
});
