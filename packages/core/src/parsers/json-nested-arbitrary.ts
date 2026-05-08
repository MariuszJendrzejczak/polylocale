/**
 * fast-check generators for nested-JSON shaped projects.
 *
 * The generator builds a small **tree** rather than an array of flat
 * paths — that way no path can be a strict prefix of another by
 * construction, so {@link exportNestedJson} never sees a prefix
 * collision while fuzzing.
 *
 * Segments are drawn from a fixed pool: a leading letter plus 0–4
 * alphanumerics. Pool excludes `.` (which the parser would reject) and
 * is shrink-friendly. Sibling segments are uniqued at every level.
 */

import fc, { type Arbitrary } from 'fast-check';

import { arbitraryIcuNodes } from '../icu/arbitrary.js';
import type { ICUNode } from '../model/icu.js';

const SEGMENT_HEAD = 'abcdefghijklmnopqrstuvwxyz'.split('');
const SEGMENT_TAIL = 'abcdefghijklmnopqrstuvwxyz0123456789_'.split('');

export const arbitrarySegment: Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...SEGMENT_HEAD),
    fc.string({ minLength: 0, maxLength: 4, unit: fc.constantFrom(...SEGMENT_TAIL) }),
  )
  .map(([head, tail]) => `${head}${tail}`);

export type NestedLeaves = ReadonlyArray<readonly [string, readonly ICUNode[]]>;

interface Tree {
  readonly children: ReadonlyArray<readonly [string, Tree | { readonly leaf: readonly ICUNode[] }]>;
}

function isLeaf(
  node: Tree | { readonly leaf: readonly ICUNode[] },
): node is { readonly leaf: readonly ICUNode[] } {
  return 'leaf' in node;
}

/**
 * Generate a tree of unique-segment children. At depth 0 every child is
 * a leaf; otherwise each child is independently a leaf or a sub-tree
 * (50/50). Keeps `numRuns: 200` runs cheap.
 */
export function arbitraryNestedTree(depth: number): Arbitrary<Tree> {
  const childArbitrary: Arbitrary<Tree | { readonly leaf: readonly ICUNode[] }> =
    depth <= 0
      ? arbitraryIcuNodes(2).map((leaf) => ({ leaf }))
      : fc.oneof(
          { weight: 2, arbitrary: arbitraryIcuNodes(2).map((leaf) => ({ leaf })) },
          { weight: 1, arbitrary: arbitraryNestedTree(depth - 1) },
        );

  return fc.uniqueArray(arbitrarySegment, { minLength: 1, maxLength: 4 }).chain((segments) =>
    fc.tuple(...segments.map(() => childArbitrary)).map((nodes) => ({
      children: segments.map((segment, i) => [segment, nodes[i]!] as const),
    })),
  );
}

/** Walk the tree to produce dot-joined paths and their leaf IR. */
export function flattenTree(tree: Tree, stack: readonly string[] = []): NestedLeaves {
  const out: Array<readonly [string, readonly ICUNode[]]> = [];
  for (const [segment, child] of tree.children) {
    const nextStack = [...stack, segment];
    if (isLeaf(child)) {
      out.push([nextStack.join('.'), child.leaf]);
    } else {
      for (const entry of flattenTree(child, nextStack)) out.push(entry);
    }
  }
  return out;
}

export const arbitraryNestedLeaves: Arbitrary<NestedLeaves> = arbitraryNestedTree(3)
  .map(flattenTree)
  .filter((leaves) => leaves.length > 0);
