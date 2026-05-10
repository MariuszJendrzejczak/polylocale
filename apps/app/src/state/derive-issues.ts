/**
 * Per-cell issue derivation.
 *
 * `composeProject` only sets `'missing-translation'` or `'ok'` on
 * `KeyStatus`. The full union (`placeholder-mismatch`, `empty`,
 * `needs-review`) is computed at render time here, against the base locale
 * the editor is running with. If this proves load-bearing, we can lift it
 * into `core/model/compose.ts` later — for v1 keeping it next to the view
 * lets us iterate quickly without touching the model package.
 */

import type { ICUNode, LocaleCode, TranslationKey, TranslationValue } from '@polylocale/core';

export interface CellIssues {
  /** No `TranslationValue` at all for this locale. */
  readonly missing: boolean;
  /** Value exists but renders to no text and has no placeholders. */
  readonly empty: boolean;
  /** Set of placeholder names differs from the base locale's. */
  readonly placeholderMismatch: boolean;
  /** Author flagged it for review (TranslationValue.reviewed === false explicit-set). */
  readonly needsReview: boolean;
}

export function deriveCellIssues(
  key: TranslationKey,
  locale: LocaleCode,
  baseLocale: LocaleCode,
): CellIssues {
  const value = key.values[locale];
  if (value === undefined) {
    return {
      missing: true,
      empty: false,
      placeholderMismatch: false,
      needsReview: false,
    };
  }
  const baseValue = key.values[baseLocale];
  return {
    missing: false,
    empty: isEmptyIr(value.ir),
    placeholderMismatch:
      baseValue !== undefined && locale !== baseLocale
        ? !samePlaceholderSet(baseValue, value)
        : false,
    needsReview: value.reviewed === false && value.source !== 'imported',
  };
}

function isEmptyIr(ir: readonly ICUNode[]): boolean {
  if (ir.length === 0) return true;
  return ir.every((node) => node.kind === 'text' && node.value.trim() === '');
}

function samePlaceholderSet(a: TranslationValue, b: TranslationValue): boolean {
  const aSet = collectPlaceholderNames(a.ir);
  const bSet = collectPlaceholderNames(b.ir);
  if (aSet.size !== bSet.size) return false;
  for (const name of aSet) if (!bSet.has(name)) return false;
  return true;
}

function collectPlaceholderNames(ir: readonly ICUNode[]): Set<string> {
  const out = new Set<string>();
  walk(ir, out);
  return out;
}

function walk(ir: readonly ICUNode[], out: Set<string>): void {
  for (const node of ir) {
    switch (node.kind) {
      case 'placeholder':
        out.add(node.name);
        break;
      case 'plural':
      case 'select':
      case 'selectordinal':
        out.add(node.arg);
        for (const body of Object.values(node.cases)) walk(body, out);
        break;
      case 'tag':
        walk(node.children, out);
        break;
      case 'text':
        break;
    }
  }
}
