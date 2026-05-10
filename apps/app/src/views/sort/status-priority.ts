import type { LocaleCode, TranslationKey } from '@polylocale/core';

import { deriveCellIssues } from '../../state/derive-issues.js';

/**
 * Aggregate row-status priority used by the editor's "Sort by status" toggle.
 * Lower number = higher priority (surfaced first when sorting ascending).
 *
 * Priority order: missing < placeholder-mismatch < empty < ok.
 */
export const STATUS_PRIORITY = {
  missing: 0,
  placeholderMismatch: 1,
  empty: 2,
  ok: 3,
} as const;

export type StatusPriority = (typeof STATUS_PRIORITY)[keyof typeof STATUS_PRIORITY];

export function rowStatusPriority(
  row: TranslationKey,
  locales: readonly LocaleCode[],
  baseLocale: LocaleCode,
): StatusPriority {
  let worst: StatusPriority = STATUS_PRIORITY.ok;
  for (const locale of locales) {
    const issues = deriveCellIssues(row, locale, baseLocale);
    if (issues.missing) return STATUS_PRIORITY.missing;
    if (issues.placeholderMismatch && worst > STATUS_PRIORITY.placeholderMismatch) {
      worst = STATUS_PRIORITY.placeholderMismatch;
    } else if (issues.empty && worst > STATUS_PRIORITY.empty) {
      worst = STATUS_PRIORITY.empty;
    }
  }
  return worst;
}

export function sortByStatus(
  rows: readonly TranslationKey[],
  locales: readonly LocaleCode[],
  baseLocale: LocaleCode,
  direction: 'asc' | 'desc',
): readonly TranslationKey[] {
  const decorated = rows.map((row, index) => ({
    row,
    index,
    priority: rowStatusPriority(row, locales, baseLocale),
  }));
  decorated.sort((a, b) => {
    const delta = a.priority - b.priority;
    if (delta !== 0) return direction === 'asc' ? delta : -delta;
    return a.index - b.index;
  });
  return decorated.map((d) => d.row);
}
