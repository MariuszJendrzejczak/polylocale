/**
 * Translator handoff — CSV export of the current project and triaged
 * import of a returned spreadsheet.
 *
 * CSV is a *transport*, not a `SupportedFormat`: the import path produces
 * `BatchValueEntry`s that funnel through the existing `setValuesBatch`
 * reducer action, never a `SourceFile` and never a parser/exporter pair.
 *
 * Triage policy (`importCsvAndPlan`):
 *   - was-empty → cell empty     → no-op
 *   - was-empty → cell has text  → clean apply (parse error if malformed ICU)
 *   - was-set   → cell same      → no-op (compared on parsed IR via `icuEqual`)
 *   - was-set   → cell different → conflict (includes translator-cleared cells)
 *   - row key not in project     → unknown-key error, row skipped
 *   - header column not project locale and not key/description
 *                                → unknown-column error (one per file)
 *
 * Nothing dispatches from here — the modal renders the plan and decides
 * what to apply.
 */

import {
  exportProjectToCsv,
  icuEqual,
  parseCsvRows,
  parseICU,
  renderICU,
  type ICUNode,
  type LocaleCode,
  type LocalizationProject,
  type TranslationKey,
  type TranslationValue,
} from '@polylocale/core';

import type { BatchValueEntry } from '../state/editor-state.js';

export interface ExportArtifact {
  readonly filename: string;
  readonly blob: Blob;
}

export interface ConflictReport {
  readonly keyId: string;
  readonly keyPath: string;
  readonly locale: LocaleCode;
  readonly currentText: string;
  readonly incomingText: string;
  /** null when the translator cleared the cell (no IR to apply). */
  readonly incomingIr: readonly ICUNode[] | null;
}

export type ImportErrorKind = 'parse-error' | 'unknown-key' | 'unknown-column';

export interface ImportError {
  readonly kind: ImportErrorKind;
  readonly keyPath?: string;
  readonly locale?: LocaleCode;
  readonly column?: string;
  readonly message: string;
}

export interface ImportPlan {
  readonly applies: readonly BatchValueEntry[];
  readonly conflicts: readonly ConflictReport[];
  readonly parseErrors: readonly ImportError[];
}

export function exportProjectAsCsv(project: LocalizationProject): ExportArtifact {
  const text = exportProjectToCsv(project);
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const safeName = project.name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'project';
  return { filename: `${safeName}-handoff.csv`, blob };
}

export function importCsvAndPlan(text: string, project: LocalizationProject): ImportPlan {
  const rows = parseCsvRows(text);

  const applies: BatchValueEntry[] = [];
  const conflicts: ConflictReport[] = [];
  const parseErrors: ImportError[] = [];

  const keyByPath = new Map<string, TranslationKey>();
  for (const k of project.keys) keyByPath.set(k.path, k);

  const knownLocales = new Set<LocaleCode>(project.locales);
  const reservedHeaders = new Set<string>(['key', 'description']);

  // Surface unknown columns once per file. Headers live on row 0, but
  // `parseCsvRows` doesn't expose them; reconstruct the set from the
  // union of every row's `values` keys (verbatim header names).
  const seenColumns = new Set<string>();
  for (const row of rows) {
    for (const col of Object.keys(row.values)) seenColumns.add(col);
  }
  for (const col of seenColumns) {
    if (reservedHeaders.has(col)) continue;
    if (knownLocales.has(col)) continue;
    parseErrors.push({
      kind: 'unknown-column',
      column: col,
      message: `column "${col}" is not a project locale — values for it were ignored`,
    });
  }

  for (const row of rows) {
    const key = keyByPath.get(row.key);
    if (key === undefined) {
      parseErrors.push({
        kind: 'unknown-key',
        keyPath: row.key,
        message: `key "${row.key}" is not in the project — row skipped`,
      });
      continue;
    }
    for (const locale of project.locales) {
      const cellText = row.values[locale];
      if (cellText === undefined) continue;
      classify(key, locale, cellText, applies, conflicts, parseErrors);
    }
  }

  return { applies, conflicts, parseErrors };
}

function classify(
  key: TranslationKey,
  locale: LocaleCode,
  cellText: string,
  applies: BatchValueEntry[],
  conflicts: ConflictReport[],
  parseErrors: ImportError[],
): void {
  const current = key.values[locale];
  const wasEmpty = current === undefined || isEmptyIr(current.ir);
  const nowEmpty = cellText === '';

  if (wasEmpty && nowEmpty) return;

  if (wasEmpty) {
    let ir: readonly ICUNode[];
    try {
      ir = parseICU(cellText);
    } catch (err) {
      parseErrors.push({
        kind: 'parse-error',
        keyPath: key.path,
        locale,
        message: `parse error in ${key.path} / ${locale}: ${errorMessage(err)}`,
      });
      return;
    }
    applies.push({
      keyPath: key.path,
      locale,
      ir,
      raw: cellText,
      source: 'imported',
    });
    return;
  }

  // current !== undefined past this point (wasEmpty fall-through covered above)
  const currentValue = current as TranslationValue;
  if (nowEmpty) {
    conflicts.push({
      keyId: key.id,
      keyPath: key.path,
      locale,
      currentText: currentText(currentValue),
      incomingText: '',
      incomingIr: null,
    });
    return;
  }

  let incomingIr: readonly ICUNode[];
  try {
    incomingIr = parseICU(cellText);
  } catch (err) {
    parseErrors.push({
      kind: 'parse-error',
      keyPath: key.path,
      locale,
      message: `parse error in ${key.path} / ${locale}: ${errorMessage(err)}`,
    });
    return;
  }

  if (icuEqual(incomingIr, currentValue.ir)) return;

  conflicts.push({
    keyId: key.id,
    keyPath: key.path,
    locale,
    currentText: currentText(currentValue),
    incomingText: cellText,
    incomingIr,
  });
}

function isEmptyIr(ir: readonly ICUNode[]): boolean {
  if (ir.length === 0) return true;
  return ir.every((node) => node.kind === 'text' && node.value === '');
}

function currentText(value: TranslationValue): string {
  return value.raw ?? renderICU(value.ir);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
