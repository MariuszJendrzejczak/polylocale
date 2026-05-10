import { useState, type ReactElement } from 'react';

import type { TranslationKey } from '@polylocale/core';

import { RowTranslateMenu } from './RowTranslateMenu.js';
import styles from './KeyCell.module.css';

export interface KeyCellProps {
  readonly row: TranslationKey;
  readonly onTranslateMissing: () => void;
  readonly onDelete: (keyId: string) => void;
}

export function KeyCell({ row, onTranslateMissing, onDelete }: KeyCellProps): ReactElement {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  return (
    <div className={styles.cell}>
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
        onDelete={() => setConfirmingDelete(true)}
      />
    </div>
  );
}
