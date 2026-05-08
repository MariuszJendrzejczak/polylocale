/**
 * Structural equality for {@link ICUNode} trees. Used by the flat-JSON
 * exporter to decide whether a value's `raw` string is still a faithful
 * encoding of its IR — if so, we emit `raw` byte-for-byte; otherwise we
 * fall back to {@link renderICU}. Custom (instead of a deep-equal lib) so
 * we stay zero-dependency at runtime and the discriminated union is
 * checked exhaustively at compile time.
 */

import type { ICUNode } from '../model/icu.js';

export function icuEqual(a: readonly ICUNode[], b: readonly ICUNode[]): boolean {
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
      return a.value === (b as typeof a).value;
    case 'placeholder': {
      const other = b as typeof a;
      return a.name === other.name && a.type === other.type && a.format === other.format;
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
      return a.name === other.name && icuEqual(a.children, other.children);
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
    if (!icuEqual(a[k]!, b[k]!)) return false;
  }
  return true;
}
