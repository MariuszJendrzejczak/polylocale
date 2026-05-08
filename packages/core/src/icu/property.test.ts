import fc from 'fast-check';
import { describe, it } from 'vitest';

import { arbitraryIcuNodes } from './arbitrary.js';
import { icuEqual } from './equal.js';
import { parseICU } from './parse.js';
import { renderICU } from './render.js';

/**
 * Property-based companion to `round-trip.test.ts`. The hand-written tests
 * pin known shapes; these random-shape tests assert the same two
 * invariants over `arbitraryIcuNodes` (see ARCHITECTURE.md §2.1).
 *
 * `fc.assert` is preferred over wrapping in `expect` so failure messages
 * include the (shrunken) counterexample as readable JSON.
 */
describe('parseICU / renderICU — properties (fast-check)', () => {
  it('idempotency: parseICU(renderICU(nodes)) ≡ nodes', () => {
    fc.assert(
      fc.property(arbitraryIcuNodes(), (nodes) => {
        const rendered = renderICU(nodes);
        const reparsed = parseICU(rendered);
        return icuEqual(reparsed, nodes);
      }),
      { numRuns: 200 },
    );
  });

  it('render fixed-point: renderICU(parseICU(renderICU(nodes))) === renderICU(nodes)', () => {
    fc.assert(
      fc.property(arbitraryIcuNodes(), (nodes) => {
        const once = renderICU(nodes);
        const twice = renderICU(parseICU(once));
        return twice === once;
      }),
      { numRuns: 200 },
    );
  });
});
