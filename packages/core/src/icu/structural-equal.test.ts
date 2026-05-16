import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ICUNode } from '../model/icu.js';
import { arbitraryIcuNodes, arbitraryText } from './arbitrary.js';
import { icuStructuralEqual } from './structural-equal.js';

const text = (v: string): ICUNode => ({ kind: 'text', value: v });

describe('icuStructuralEqual', () => {
  it('returns true for identical structure with different text', () => {
    expect(
      icuStructuralEqual(
        [text('Hello '), { kind: 'placeholder', name: 'name' }, text('!')],
        [text('Cześć '), { kind: 'placeholder', name: 'name' }, text('!')],
      ),
    ).toBe(true);
  });

  it('returns false when a placeholder is renamed', () => {
    expect(
      icuStructuralEqual(
        [{ kind: 'placeholder', name: 'count' }],
        [{ kind: 'placeholder', name: 'n' }],
      ),
    ).toBe(false);
  });

  it('returns false when a plural case is dropped', () => {
    expect(
      icuStructuralEqual(
        [{ kind: 'plural', arg: 'n', cases: { one: [text('one')], other: [text('many')] } }],
        [{ kind: 'plural', arg: 'n', cases: { other: [text('many')] } }],
      ),
    ).toBe(false);
  });

  it('returns false when a select case is dropped', () => {
    expect(
      icuStructuralEqual(
        [
          {
            kind: 'select',
            arg: 'gender',
            cases: { female: [text('she')], male: [text('he')], other: [text('they')] },
          },
        ],
        [
          {
            kind: 'select',
            arg: 'gender',
            cases: { male: [text('he')], other: [text('they')] },
          },
        ],
      ),
    ).toBe(false);
  });

  it('returns false when a nested tag name changes', () => {
    expect(
      icuStructuralEqual(
        [{ kind: 'tag', name: 'b', children: [text('hi')] }],
        [{ kind: 'tag', name: 'i', children: [text('hi')] }],
      ),
    ).toBe(false);
  });

  it('returns false when plural offset differs', () => {
    expect(
      icuStructuralEqual(
        [{ kind: 'plural', arg: 'n', offset: 1, cases: { other: [text('x')] } }],
        [{ kind: 'plural', arg: 'n', offset: 2, cases: { other: [text('x')] } }],
      ),
    ).toBe(false);
  });

  it('returns false when plural offset is undefined vs 0', () => {
    expect(
      icuStructuralEqual(
        [{ kind: 'plural', arg: 'n', cases: { other: [text('x')] } }],
        [{ kind: 'plural', arg: 'n', offset: 0, cases: { other: [text('x')] } }],
      ),
    ).toBe(false);
  });

  it('returns false when the plural arg differs', () => {
    expect(
      icuStructuralEqual(
        [{ kind: 'plural', arg: 'count', cases: { other: [text('x')] } }],
        [{ kind: 'plural', arg: 'n', cases: { other: [text('x')] } }],
      ),
    ).toBe(false);
  });

  it('returns false when case bodies diverge structurally', () => {
    expect(
      icuStructuralEqual(
        [
          {
            kind: 'plural',
            arg: 'n',
            cases: { other: [text('You have '), { kind: 'placeholder', name: 'count' }] },
          },
        ],
        [{ kind: 'plural', arg: 'n', cases: { other: [text('You have many')] } }],
      ),
    ).toBe(false);
  });

  it('returns true when case bodies are structurally equal but text differs', () => {
    expect(
      icuStructuralEqual(
        [
          {
            kind: 'plural',
            arg: 'n',
            cases: {
              one: [text('one apple')],
              other: [{ kind: 'placeholder', name: 'n' }, text(' apples')],
            },
          },
        ],
        [
          {
            kind: 'plural',
            arg: 'n',
            cases: {
              one: [text('jedno jabłko')],
              other: [{ kind: 'placeholder', name: 'n' }, text(' jabłek')],
            },
          },
        ],
      ),
    ).toBe(true);
  });

  it('treats plural cases as an unordered set (insertion order ignored)', () => {
    expect(
      icuStructuralEqual(
        [{ kind: 'plural', arg: 'n', cases: { one: [text('a')], other: [text('b')] } }],
        [{ kind: 'plural', arg: 'n', cases: { other: [text('y')], one: [text('x')] } }],
      ),
    ).toBe(true);
  });

  it('returns false on length mismatch', () => {
    expect(icuStructuralEqual([text('a')], [text('a'), text('b')])).toBe(false);
  });

  it('returns false on kind mismatch', () => {
    expect(icuStructuralEqual([text('a')], [{ kind: 'placeholder', name: 'a' }])).toBe(false);
  });

  it('ignores text content inside tag children', () => {
    expect(
      icuStructuralEqual(
        [{ kind: 'tag', name: 'b', children: [text('left')] }],
        [{ kind: 'tag', name: 'b', children: [text('right')] }],
      ),
    ).toBe(true);
  });

  it('ignores text content inside plural case bodies at depth', () => {
    expect(
      icuStructuralEqual(
        [
          {
            kind: 'plural',
            arg: 'n',
            cases: {
              other: [{ kind: 'tag', name: 'b', children: [text('inside-A')] }],
            },
          },
        ],
        [
          {
            kind: 'plural',
            arg: 'n',
            cases: {
              other: [{ kind: 'tag', name: 'b', children: [text('inside-B')] }],
            },
          },
        ],
      ),
    ).toBe(true);
  });

  it('ignores placeholder type/format (per the diff-view contract)', () => {
    // Skeleton check is name-based; the diff view treats a type/format-only
    // change as not-a-structural-mismatch. If we ever need stricter checks
    // they'd live in a separate helper to avoid changing this contract.
    expect(
      icuStructuralEqual(
        [{ kind: 'placeholder', name: 'n', type: 'number' }],
        [{ kind: 'placeholder', name: 'n', type: 'date' }],
      ),
    ).toBe(true);
  });
});

describe('icuStructuralEqual — properties (fast-check)', () => {
  it('reflexivity: every generated tree equals itself', () => {
    fc.assert(
      fc.property(arbitraryIcuNodes(), (nodes) => icuStructuralEqual(nodes, nodes)),
      { numRuns: 200 },
    );
  });

  it('text-blind: swapping every text node value preserves equality', () => {
    fc.assert(
      fc.property(arbitraryIcuNodes(), arbitraryText, (nodes, replacement) => {
        const swapped = mutateTextValues(nodes, replacement);
        return icuStructuralEqual(nodes, swapped);
      }),
      { numRuns: 200 },
    );
  });

  it('renaming any placeholder breaks structural equality', () => {
    fc.assert(
      fc.property(arbitraryIcuNodes(), fc.integer({ min: 0, max: 1_000_000 }), (nodes, seed) => {
        const placeholders = collectPlaceholderPaths(nodes);
        fc.pre(placeholders.length > 0);
        const target = placeholders[seed % placeholders.length]!;
        const mutated = renamePlaceholderAt(nodes, target, '__renamed__');
        return !icuStructuralEqual(nodes, mutated);
      }),
      { numRuns: 200 },
    );
  });

  it('dropping any plural/select case breaks structural equality', () => {
    fc.assert(
      fc.property(arbitraryIcuNodes(), fc.integer({ min: 0, max: 1_000_000 }), (nodes, seed) => {
        const dropTargets = collectDroppableCases(nodes);
        fc.pre(dropTargets.length > 0);
        const target = dropTargets[seed % dropTargets.length]!;
        const mutated = dropCaseAt(nodes, target.path, target.caseKey);
        return !icuStructuralEqual(nodes, mutated);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------- test-only IR mutation helpers ----------

type Path = readonly (number | string)[];

function mutateTextValues(nodes: readonly ICUNode[], replacement: string): readonly ICUNode[] {
  return nodes.map((n): ICUNode => {
    switch (n.kind) {
      case 'text':
        return { kind: 'text', value: replacement };
      case 'placeholder':
        return n;
      case 'tag':
        return { kind: 'tag', name: n.name, children: mutateTextValues(n.children, replacement) };
      case 'plural':
      case 'selectordinal': {
        const cases = mapCases(n.cases, (body) => mutateTextValues(body, replacement));
        return n.offset === undefined
          ? { kind: n.kind, arg: n.arg, cases }
          : { kind: n.kind, arg: n.arg, cases, offset: n.offset };
      }
      case 'select': {
        const cases = mapCases(n.cases, (body) => mutateTextValues(body, replacement));
        return { kind: 'select', arg: n.arg, cases };
      }
    }
  });
}

function mapCases(
  cases: Readonly<Record<string, readonly ICUNode[]>>,
  fn: (body: readonly ICUNode[]) => readonly ICUNode[],
): Record<string, readonly ICUNode[]> {
  const out: Record<string, readonly ICUNode[]> = {};
  for (const k of Object.keys(cases)) out[k] = fn(cases[k]!);
  return out;
}

function collectPlaceholderPaths(nodes: readonly ICUNode[], prefix: Path = []): Path[] {
  const out: Path[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const here: Path = [...prefix, i];
    const n = nodes[i]!;
    if (n.kind === 'placeholder') out.push(here);
    else if (n.kind === 'tag') out.push(...collectPlaceholderPaths(n.children, [...here, 'tag']));
    else if (n.kind === 'plural' || n.kind === 'select' || n.kind === 'selectordinal') {
      for (const key of Object.keys(n.cases)) {
        out.push(...collectPlaceholderPaths(n.cases[key]!, [...here, 'case', key]));
      }
    }
  }
  return out;
}

function renamePlaceholderAt(
  nodes: readonly ICUNode[],
  path: Path,
  newName: string,
): readonly ICUNode[] {
  if (path.length === 0) return nodes;
  const [head, ...rest] = path;
  const idx = head as number;
  return nodes.map((n, i): ICUNode => {
    if (i !== idx) return n;
    if (rest.length === 0) {
      if (n.kind !== 'placeholder') throw new Error('renamePlaceholderAt: not a placeholder');
      return { ...n, name: newName };
    }
    const [step, ...tail] = rest;
    if (step === 'tag') {
      if (n.kind !== 'tag') throw new Error('renamePlaceholderAt: not a tag');
      return {
        kind: 'tag',
        name: n.name,
        children: renamePlaceholderAt(n.children, tail, newName),
      };
    }
    if (step === 'case') {
      if (n.kind !== 'plural' && n.kind !== 'select' && n.kind !== 'selectordinal') {
        throw new Error('renamePlaceholderAt: not a case-bearing node');
      }
      const [caseKey, ...inner] = tail;
      const ck = caseKey as string;
      const cases: Record<string, readonly ICUNode[]> = { ...n.cases };
      cases[ck] = renamePlaceholderAt(n.cases[ck]!, inner, newName);
      if (n.kind === 'select') return { kind: 'select', arg: n.arg, cases };
      return n.offset === undefined
        ? { kind: n.kind, arg: n.arg, cases }
        : { kind: n.kind, arg: n.arg, cases, offset: n.offset };
    }
    throw new Error(`renamePlaceholderAt: unknown step ${String(step)}`);
  });
}

interface DropTarget {
  readonly path: Path;
  readonly caseKey: string;
}

function collectDroppableCases(nodes: readonly ICUNode[], prefix: Path = []): DropTarget[] {
  const out: DropTarget[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const here: Path = [...prefix, i];
    const n = nodes[i]!;
    if (n.kind === 'plural' || n.kind === 'select' || n.kind === 'selectordinal') {
      const keys = Object.keys(n.cases);
      // A node with only `other` cannot have any case dropped without
      // becoming malformed; structural-equality is still allowed to fail,
      // but the property is most interesting when there's a non-`other`
      // case to remove. Skip the trivial case.
      for (const k of keys) if (k !== 'other') out.push({ path: here, caseKey: k });
      for (const k of keys) {
        out.push(...collectDroppableCases(n.cases[k]!, [...here, 'case', k]));
      }
    } else if (n.kind === 'tag') {
      out.push(...collectDroppableCases(n.children, [...here, 'tag']));
    }
  }
  return out;
}

function dropCaseAt(nodes: readonly ICUNode[], path: Path, caseKey: string): readonly ICUNode[] {
  if (path.length === 0) return nodes;
  const [head, ...rest] = path;
  const idx = head as number;
  return nodes.map((n, i): ICUNode => {
    if (i !== idx) return n;
    if (rest.length === 0) {
      if (n.kind !== 'plural' && n.kind !== 'select' && n.kind !== 'selectordinal') {
        throw new Error('dropCaseAt: not a case-bearing node');
      }
      const cases: Record<string, readonly ICUNode[]> = {};
      for (const k of Object.keys(n.cases)) if (k !== caseKey) cases[k] = n.cases[k]!;
      if (n.kind === 'select') return { kind: 'select', arg: n.arg, cases };
      return n.offset === undefined
        ? { kind: n.kind, arg: n.arg, cases }
        : { kind: n.kind, arg: n.arg, cases, offset: n.offset };
    }
    const [step, ...tail] = rest;
    if (step === 'tag') {
      if (n.kind !== 'tag') throw new Error('dropCaseAt: not a tag');
      return { kind: 'tag', name: n.name, children: dropCaseAt(n.children, tail, caseKey) };
    }
    if (step === 'case') {
      if (n.kind !== 'plural' && n.kind !== 'select' && n.kind !== 'selectordinal') {
        throw new Error('dropCaseAt: not a case-bearing node');
      }
      const [ck, ...inner] = tail;
      const ckStr = ck as string;
      const cases: Record<string, readonly ICUNode[]> = { ...n.cases };
      cases[ckStr] = dropCaseAt(n.cases[ckStr]!, inner, caseKey);
      if (n.kind === 'select') return { kind: 'select', arg: n.arg, cases };
      return n.offset === undefined
        ? { kind: n.kind, arg: n.arg, cases }
        : { kind: n.kind, arg: n.arg, cases, offset: n.offset };
    }
    throw new Error(`dropCaseAt: unknown step ${String(step)}`);
  });
}
