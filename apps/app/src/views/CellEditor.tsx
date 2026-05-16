import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { parseICU, renderICU } from '@polylocale/core';
import type { ICUNode, TranslationValue } from '@polylocale/core';
import { StatusBadge } from '@polylocale/ui';

import type { CellIssues } from '../state/derive-issues.js';
import type { PendingTranslation } from '../state/editor-state.js';

import styles from './CellEditor.module.css';

export interface CellEditorProps {
  readonly value: TranslationValue | undefined;
  readonly issues: CellIssues;
  readonly dirty: boolean;
  readonly onCommit: (ir: readonly ICUNode[], raw: string) => void;
  /** Slot for a per-cell action (e.g. AI translate ✦ button). */
  readonly aiAction?: ReactNode;
  /** AI translation in flight or its last failure. */
  readonly pending?: PendingTranslation;
}

export function CellEditor(props: CellEditorProps): ReactElement {
  const { value, issues, dirty, onCommit, aiAction, pending } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const ta = taRef.current;
    if (ta === null) return;
    ta.focus();
    ta.select();
  }, [editing]);

  function startEdit(): void {
    setDraft(currentText(value));
    setError(null);
    setEditing(true);
  }

  function cancel(): void {
    setEditing(false);
    setDraft('');
    setError(null);
  }

  function commit(): void {
    try {
      const ir = parseICU(draft);
      onCommit(ir, draft);
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (editing) {
    return (
      <div className={`${styles.cell} ${styles.editing} ${error !== null ? styles.errored : ''}`}>
        <textarea
          ref={taRef}
          className={styles.textarea}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error !== null) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          {...(error !== null ? { title: error } : {})}
          spellCheck
        />
      </div>
    );
  }

  const text = currentText(value);
  const isPending = pending === 'pending';
  const pendingError = isPendingError(pending) ? pending.error : null;
  return (
    <div
      className={`${styles.cell} ${isPending ? styles.pending : ''} ${pendingError !== null ? styles.errored : ''}`}
      onClick={startEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault();
          startEdit();
        }
      }}
      role="button"
      tabIndex={0}
      {...(pendingError !== null ? { title: pendingError } : {})}
    >
      <span className={`${styles.text} ${text === '' ? styles.placeholder : ''}`}>
        {text === '' ? '—' : text}
      </span>
      {isPending && <span className={styles.spinner} aria-hidden="true" />}
      <span className={styles.badges}>
        {issues.missing && <StatusBadge variant="missing" />}
        {issues.empty && !issues.missing && <StatusBadge variant="empty" />}
        {issues.placeholderMismatch && <StatusBadge variant="placeholder-mismatch" />}
        {dirty && <StatusBadge variant="modified" />}
      </span>
      {aiAction !== undefined && <span className={styles.aiSlot}>{aiAction}</span>}
    </div>
  );
}

function isPendingError(p: PendingTranslation | undefined): p is { error: string } {
  return p !== undefined && typeof p === 'object' && 'error' in p;
}

function currentText(value: TranslationValue | undefined): string {
  if (value === undefined) return '';
  if (value.raw !== undefined) return value.raw;
  return renderICU(value.ir);
}
