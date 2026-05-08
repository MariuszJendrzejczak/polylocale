import { describe, expect, it } from 'vitest';
import { icuEqual } from './equal.js';
import { parseICU } from './parse.js';
import { renderICU } from './render.js';

/**
 * Idempotency under double round-trip: byte-equal `renderICU(parseICU(s)) === s`
 * is *not* an invariant we hold (whitespace is normalized, case order is
 * canonicalized — see ARCHITECTURE.md §2.1). What we do hold is that the IR
 * is a fixed point of the (parse ∘ render) operation: re-parsing the
 * renderer's output yields the same tree.
 */
const samples: ReadonlyArray<readonly [string, string]> = [
  ['plain literal', 'Hello'],
  ['literal + placeholder', 'Hello {name}'],
  ['typed placeholder w/o format', '{count, number}'],
  ['typed placeholder w/ skeleton', '{amount, number, ::currency/USD}'],
  ['date placeholder', '{today, date, short}'],
  ['plural w/o offset', '{n, plural, =0 {none} other {many}}'],
  ['plural w/ offset and pound', '{n, plural, offset:1 one {# item} other {# items}}'],
  ['selectordinal', '{p, selectordinal, =1 {1st} =2 {2nd} other {#th}}'],
  ['select', '{g, select, male {He} female {She} other {They}}'],
  ['tag', 'Read <b>the docs</b>'],
  ['nested placeholder inside plural case', '{n, plural, =0 {none} other {hi {name}}}'],
  ['literal with { and }', "config: '{'foo'}'"],
];

describe('round-trip parseICU ∘ renderICU', () => {
  for (const [label, raw] of samples) {
    it(`${label}: parseICU(renderICU(parseICU(s))) ≡ parseICU(s)`, () => {
      const ir = parseICU(raw);
      const rendered = renderICU(ir);
      const ir2 = parseICU(rendered);
      expect(icuEqual(ir2, ir)).toBe(true);
    });
  }

  it('renderer output is a fixed point (renderICU(parseICU(renderICU(ir))) === renderICU(ir))', () => {
    for (const [, raw] of samples) {
      const ir = parseICU(raw);
      const once = renderICU(ir);
      const twice = renderICU(parseICU(once));
      expect(twice).toBe(once);
    }
  });
});
