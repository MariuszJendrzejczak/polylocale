import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import type { LocalizationProject, TranslationKey } from '@polylocale/core';

import { RowTranslateMenu } from './RowTranslateMenu.js';
import { describePathError, validateKeyPath } from './validate-path.js';
import styles from './KeyCell.module.css';

export interface KeyCellProps {
  readonly row: TranslationKey;
  readonly project: LocalizationProject;
  readonly onTranslateMissing: () => void;
  readonly onDelete: (keyId: string) => void;
  readonly onRename: (keyId: string, newPath: string) => void;
}

export function KeyCell({
  row,
  project,
  onTranslateMissing,
  onDelete,
  onRename,
}: KeyCellProps): ReactElement {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftPath, setDraftPath] = useState(row.path);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    function onDocClick(e: MouseEvent): void {
      if (!(e.target instanceof Node)) return;
      if (cellRef.current?.contains(e.target) === true) return;
      setRenaming(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [renaming]);

  function startRename(): void {
    setDraftPath(row.path);
    setRenaming(true);
  }

  const draftTrimmed = draftPath.trim();
  const renameResult =
    !renaming || draftTrimmed === row.path
      ? null
      : validateKeyPath(draftTrimmed, project, { excludeKeyId: row.id });
  const renameError =
    renameResult !== null && !renameResult.ok ? describePathError(renameResult.reason) : null;
  const canCommitRename =
    renaming && draftTrimmed !== '' && draftTrimmed !== row.path && renameError === null;

  function commitRename(): void {
    if (!canCommitRename) return;
    setRenaming(false);
    onRename(row.id, draftTrimmed);
  }

  function cancelRename(): void {
    setRenaming(false);
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  if (confirmingDelete) {
    return (
      <div className={styles.cell}>
        <span className={styles.confirmText}>
          Delete <code className={styles.confirmPath}>{row.path}</code>?
        </span>
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.confirmButton} ${styles.confirmDanger}`}
            onClick={() => {
              setConfirmingDelete(false);
              onDelete(row.id);
            }}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  if (renaming) {
    return (
      <div className={styles.cell} ref={cellRef}>
        <div className={styles.text}>
          <input
            ref={inputRef}
            type="text"
            className={styles.renameInput}
            value={draftPath}
            onChange={(e) => setDraftPath(e.currentTarget.value)}
            onKeyDown={onInputKey}
            onBlur={commitRename}
            aria-label="Rename key"
          />
          {renameError !== null && <span className={styles.renameError}>{renameError}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.cell} ref={cellRef}>
      <div className={styles.text}>
        <span className={styles.path} title={row.path}>
          {row.path}
        </span>
        {row.description !== undefined && (
          <span className={styles.desc} title={row.description}>
            {row.description}
          </span>
        )}
      </div>
      <RowTranslateMenu
        onTranslateMissing={onTranslateMissing}
        onRename={startRename}
        onDelete={() => setConfirmingDelete(true)}
      />
    </div>
  );
}
