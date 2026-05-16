/**
 * Translator handoff modal.
 *
 * Two top-level actions: **Download CSV** (export the current project) and
 * **Upload CSV…** (re-import a returned spreadsheet). Upload computes a
 * triaged `ImportPlan` and renders three sections — clean applies (default
 * checked), conflicts (default unchecked), parse errors (read-only). The
 * single Apply button funnels accepted rows through the caller-provided
 * `onApply`, which dispatches `setValuesBatch`. Cleared-cell conflicts
 * (`incomingIr === null`) are non-applyable today — the reducer has no
 * `unsetValue` path; the row renders inert with an explanation.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type { LocalizationProject } from '@polylocale/core';

import type { BatchValueEntry } from '../state/editor-state.js';
import {
  exportProjectAsCsv,
  importCsvAndPlan,
  type ConflictReport,
  type ImportError,
  type ImportPlan,
} from '../services/translator-handoff.js';

import styles from './HandoffModal.module.css';

export interface HandoffModalProps {
  readonly project: LocalizationProject;
  readonly onApply: (entries: readonly BatchValueEntry[]) => void;
  readonly onClose: () => void;
  /** Test seam: when provided, bypasses File reading and skips parseCsvRows. */
  readonly initialPlan?: ImportPlan;
}

export function HandoffModal(props: HandoffModalProps): ReactElement {
  const { project, onApply, onClose, initialPlan } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(initialPlan ?? null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyKeys = useMemo(() => {
    if (plan === null) return new Set<string>();
    return new Set(plan.applies.map(applyRowKey));
  }, [plan]);

  const [selectedApplies, setSelectedApplies] = useState<ReadonlySet<string>>(new Set());
  const [selectedConflicts, setSelectedConflicts] = useState<ReadonlySet<string>>(new Set());

  // Reset selections whenever a new plan lands: applies default to all
  // checked, conflicts default to none checked.
  useEffect(() => {
    setSelectedApplies(applyKeys);
  }, [applyKeys]);
  useEffect(() => {
    setSelectedConflicts(new Set());
  }, [plan]);

  const onDownload = useCallback((): void => {
    const artifact = exportProjectAsCsv(project);
    const url = URL.createObjectURL(artifact.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [project]);

  const onPickUpload = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  const onUploadChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file === undefined) return;
      try {
        const text = await file.text();
        const next = importCsvAndPlan(text, project);
        setPlan(next);
        setUploadError(null);
      } catch (err) {
        setUploadError(errorMessage(err));
      }
    },
    [project],
  );

  function toggleApply(k: string): void {
    setSelectedApplies((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function toggleConflict(k: string): void {
    setSelectedConflicts((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function onClickApply(): void {
    if (plan === null) return;
    const entries: BatchValueEntry[] = [];
    for (const a of plan.applies) {
      if (selectedApplies.has(applyRowKey(a))) entries.push(a);
    }
    for (const c of plan.conflicts) {
      if (c.incomingIr === null) continue;
      if (!selectedConflicts.has(conflictRowKey(c))) continue;
      entries.push({
        keyPath: c.keyPath,
        locale: c.locale,
        ir: c.incomingIr,
        raw: c.incomingText,
        source: 'imported',
      });
    }
    onApply(entries);
  }

  const totalSelected = selectedApplies.size + selectedConflicts.size;

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="handoff-title">
        <header className={styles.header}>
          <h2 id="handoff-title" className={styles.title}>
            Translator handoff
          </h2>
          {plan !== null && (
            <span className={styles.subtle}>
              {plan.applies.length} clean · {plan.conflicts.length} conflicts ·{' '}
              {plan.parseErrors.length} errors
            </span>
          )}
        </header>
        <div className={styles.toolbar}>
          <div className={styles.toolbarRow}>
            <button type="button" className={styles.button} onClick={onDownload}>
              Download CSV
            </button>
            <button type="button" className={styles.button} onClick={onPickUpload}>
              Upload CSV…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className={styles.hiddenInput}
              onChange={(e) => void onUploadChange(e)}
              aria-label="Upload translator CSV"
            />
          </div>
          {uploadError !== null && (
            <div className={styles.toolbarHint} role="alert">
              Upload failed: {uploadError}
            </div>
          )}
          {plan === null && uploadError === null && (
            <div className={styles.toolbarHint}>
              Download the project as CSV, hand it to a translator, then upload their edits to
              triage the changes.
            </div>
          )}
        </div>
        {plan !== null && (
          <div className={styles.body}>
            <Section
              title="Clean applies"
              count={plan.applies.length}
              emptyLabel="No new translations to apply."
            >
              {plan.applies.map((entry) => {
                const k = applyRowKey(entry);
                const checked = selectedApplies.has(k);
                return (
                  <div key={k} data-testid="handoff-row-clean" className={styles.row}>
                    <input
                      type="checkbox"
                      className={styles.check}
                      checked={checked}
                      onChange={() => toggleApply(k)}
                      aria-label={`Apply ${entry.keyPath} ${entry.locale}`}
                    />
                    <div className={styles.meta}>
                      <div className={styles.keyPath}>
                        <span className={styles.locale}>{entry.locale}</span>
                        <span>{entry.keyPath}</span>
                      </div>
                    </div>
                    <div className={styles.before}>—</div>
                    <div className={styles.after}>{entry.raw}</div>
                  </div>
                );
              })}
            </Section>
            <Section
              title="Conflicts"
              count={plan.conflicts.length}
              emptyLabel="No conflicts — every set cell already matched."
            >
              {plan.conflicts.map((conflict) => {
                const k = conflictRowKey(conflict);
                const cleared = conflict.incomingIr === null;
                const checked = selectedConflicts.has(k);
                return (
                  <div key={k} data-testid="handoff-row-conflict" className={styles.row}>
                    {cleared ? (
                      <span aria-hidden="true" />
                    ) : (
                      <input
                        type="checkbox"
                        className={styles.check}
                        checked={checked}
                        onChange={() => toggleConflict(k)}
                        aria-label={`Force apply ${conflict.keyPath} ${conflict.locale}`}
                      />
                    )}
                    <div className={styles.meta}>
                      <div className={styles.keyPath}>
                        <span className={styles.locale}>{conflict.locale}</span>
                        <span>{conflict.keyPath}</span>
                      </div>
                      {cleared && (
                        <div className={styles.subtle}>
                          translator cleared this cell — not applyable in this release
                        </div>
                      )}
                    </div>
                    <div className={styles.before}>{conflict.currentText}</div>
                    <div className={`${styles.after} ${cleared ? styles.cleared : ''}`}>
                      {cleared ? '(empty)' : conflict.incomingText}
                    </div>
                  </div>
                );
              })}
            </Section>
            <Section
              title="Parse errors"
              count={plan.parseErrors.length}
              emptyLabel="No parse errors."
            >
              {plan.parseErrors.map((err, i) => (
                <ErrorRow
                  key={`${err.kind}:${err.keyPath ?? err.column ?? ''}:${err.locale ?? ''}:${i}`}
                  err={err}
                />
              ))}
            </Section>
          </div>
        )}
        <footer className={styles.footer}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={onClickApply}
            disabled={plan === null || totalSelected === 0}
          >
            Apply {totalSelected > 0 ? `${totalSelected} ` : ''}selected
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  emptyLabel,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly emptyLabel: string;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <span>{title}</span>
        <span>{count}</span>
      </header>
      {count === 0 ? <div className={styles.sectionEmpty}>{emptyLabel}</div> : children}
    </section>
  );
}

function ErrorRow({ err }: { readonly err: ImportError }): ReactElement {
  return (
    <div data-testid="handoff-row-parseError" className={styles.errorRow}>
      <span className={styles.errorKind}>{err.kind}</span>
      {err.message}
    </div>
  );
}

function applyRowKey(entry: BatchValueEntry): string {
  return `apply:${entry.keyPath}:${entry.locale}`;
}
function conflictRowKey(c: ConflictReport): string {
  return `conflict:${c.keyPath}:${c.locale}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
