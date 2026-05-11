/**
 * Structural equality for {@link ICUNode} trees — text content ignored.
 *
 * Where {@link icuEqual} answers "is this IR a byte-identical encoding of
 * that IR" (used by the flat-JSON exporter's `raw` shortcut), this one
 * answers "do these two messages have the same skeleton". Placeholder
 * names, plural/select selector args, case-key sets, plural offsets, and
 * tag names must match exactly; text content is opaque.
 *
 * Used by the diff view to surface keys whose meaning has diverged between
 * two locales (placeholder renamed, plural case dropped, tag swapped). A
 * positive result is the precondition for "an AI translation of A is a
 * legal translation of B" — diverging skeletons mean the underlying
 * message changed, not just its surface text.
 */

import type { ICUNode } from '../model/icu.js';

export function icuStructuralEqual(a: readonly ICUNode[], b: readonly ICUNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!nodeEqual(a[i]!, b[i]!)) return false;
  }
  return true;
}

function nodeEqual(a: ICUNode, b: ICUNode): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'text':
      // Text content is deliberately ignored — same kind is enough.
      return true;
    case 'placeholder': {
      const other = b as typeof a;
      return a.name === other.name;
    }
    case 'plural':
    case 'selectordinal': {
      const other = b as typeof a;
      return a.arg === other.arg && a.offset === other.offset && casesEqual(a.cases, other.cases);
    }
    case 'select': {
      const other = b as typeof a;
      return a.arg === other.arg && casesEqual(a.cases, other.cases);
    }
    case 'tag': {
      const other = b as typeof a;
      return a.name === other.name && icuStructuralEqual(a.children, other.children);
    }
  }
}

function casesEqual(
  a: Readonly<Record<string, readonly ICUNode[]>>,
  b: Readonly<Record<string, readonly ICUNode[]>>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in b)) return false;
    if (!icuStructuralEqual(a[k]!, b[k]!)) return false;
  }
  return true;
}
