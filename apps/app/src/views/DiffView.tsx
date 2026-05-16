import { useMemo, type ChangeEvent, type ReactElement } from 'react';

import {
  icuStructuralEqual,
  renderICU,
  type ICUNode,
  type LocaleCode,
  type LocalizationProject,
  type TranslationKey,
  type TranslationValue,
} from '@polylocale/core';

import { useEditor } from '../state/editor-context.js';

import styles from './DiffView.module.css';

type DiffReason = 'missing' | 'empty' | 'structural mismatch';

interface DiffRow {
  readonly key: TranslationKey;
  readonly leftText: string;
  readonly rightText: string;
  readonly reason: DiffReason;
}

const REASON_LABEL: Readonly<Record<DiffReason, string>> = {
  missing: 'missing',
  empty: 'empty',
  'structural mismatch': 'structural mismatch',
};

export function DiffView(): ReactElement {
  const { state, dispatch } = useEditor();
  const project = state.project;

  const { left, right } = useMemo(
    () => resolveSelection(project, state.diffSelection),
    [project, state.diffSelection],
  );

  const rows = useMemo<readonly DiffRow[]>(() => {
    if (project === null || left === null || right === null) return [];
    return buildDiffRows(project.keys, left, right);
  }, [project, left, right]);

  if (project === null) {
    return <div className={styles.placeholder}>No project loaded.</div>;
  }

  const locales = project.locales;
  const onLeftChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    if (right === null) return;
    dispatch({
      type: 'setDiffSelection',
      selection: { left: e.currentTarget.value, right },
    });
  };
  const onRightChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    if (left === null) return;
    dispatch({
      type: 'setDiffSelection',
      selection: { left, right: e.currentTarget.value },
    });
  };

  const onRowClick = (keyId: string): void => {
    dispatch({ type: 'setView', view: 'editor' });
    // Wait one frame so the editor view re-renders and the row exists in the DOM.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-row-key="${cssEscape(keyId)}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: 'center' });
      }
    });
  };

  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span className={styles.controlLabel}>Left</span>
          <select
            className={styles.select}
            value={left ?? ''}
            onChange={onLeftChange}
            aria-label="Diff left locale"
            disabled={left === null}
          >
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.control}>
          <span className={styles.controlLabel}>Right</span>
          <select
            className={styles.select}
            value={right ?? ''}
            onChange={onRightChange}
            aria-label="Diff right locale"
            disabled={right === null}
          >
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.summary}>
          {rows.length === 0
            ? 'No divergences between these locales.'
            : `${rows.length} divergent key${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className={styles.list} role="list">
        {rows.map((row) => (
          <button
            key={row.key.id}
            type="button"
            role="listitem"
            className={styles.row}
            onClick={() => onRowClick(row.key.id)}
          >
            <span className={styles.path}>{row.key.path}</span>
            <span className={styles.side} aria-label={`left ${left ?? ''}`}>
              {row.leftText || <em className={styles.emptyMark}>—</em>}
            </span>
            <span className={styles.side} aria-label={`right ${right ?? ''}`}>
              {row.rightText || <em className={styles.emptyMark}>—</em>}
            </span>
            <span className={`${styles.badge} ${badgeClass(row.reason)}`} data-reason={row.reason}>
              {REASON_LABEL[row.reason]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function resolveSelection(
  project: LocalizationProject | null,
  selection: { readonly left: LocaleCode; readonly right: LocaleCode } | null,
): { readonly left: LocaleCode | null; readonly right: LocaleCode | null } {
  if (project === null || project.locales.length === 0) return { left: null, right: null };
  const locales = project.locales;
  const fallbackLeft = project.baseLocale;
  const fallbackRight = locales.find((l) => l !== fallbackLeft) ?? fallbackLeft;
  if (selection === null) return { left: fallbackLeft, right: fallbackRight };
  const left = locales.includes(selection.left) ? selection.left : fallbackLeft;
  const right = locales.includes(selection.right) ? selection.right : fallbackRight;
  return { left, right };
}

function buildDiffRows(
  keys: readonly TranslationKey[],
  left: LocaleCode,
  right: LocaleCode,
): readonly DiffRow[] {
  if (left === right) return [];
  const out: DiffRow[] = [];
  for (const key of keys) {
    const leftValue = key.values[left];
    const rightValue = key.values[right];
    const reason = classify(leftValue, rightValue);
    if (reason === null) continue;
    out.push({
      key,
      leftText: renderValue(leftValue),
      rightText: renderValue(rightValue),
      reason,
    });
  }
  return out;
}

function classify(
  left: TranslationValue | undefined,
  right: TranslationValue | undefined,
): DiffReason | null {
  if (left === undefined || right === undefined) return 'missing';
  if (isEmptyIr(left.ir) || isEmptyIr(right.ir)) return 'empty';
  if (!icuStructuralEqual(left.ir, right.ir)) return 'structural mismatch';
  return null;
}

function renderValue(value: TranslationValue | undefined): string {
  if (value === undefined) return '';
  if (value.raw !== undefined) return value.raw;
  return renderICU(value.ir);
}

function isEmptyIr(ir: readonly ICUNode[]): boolean {
  if (ir.length === 0) return true;
  return ir.every((n) => n.kind === 'text' && n.value.trim() === '');
}

function badgeClass(reason: DiffReason): string {
  switch (reason) {
    case 'missing':
      return styles.badgeMissing ?? '';
    case 'empty':
      return styles.badgeEmpty ?? '';
    case 'structural mismatch':
      return styles.badgeMismatch ?? '';
  }
}

function cssEscape(value: string): string {
  // Both modern browsers and jsdom (the test runner) implement CSS.escape;
  // a manual fallback would only matter on environments older than what
  // the rest of the app requires.
  return globalThis.CSS.escape(value);
}
