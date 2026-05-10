import { useState, type FormEvent, type ReactElement } from 'react';

import { parseICU, type ICUNode, type LocalizationProject } from '@polylocale/core';

import { describePathError, validateKeyPath } from './validate-path.js';
import styles from './AddKeyForm.module.css';

export interface AddKeyFormProps {
  readonly project: LocalizationProject;
  readonly onSubmit: (path: string, ir: readonly ICUNode[], raw: string) => void;
  readonly onCancel: () => void;
}

export function AddKeyForm({ project, onSubmit, onCancel }: AddKeyFormProps): ReactElement {
  const [path, setPath] = useState('');
  const [raw, setRaw] = useState('');

  const trimmedPath = path.trim();
  const pathResult = trimmedPath === '' ? null : validateKeyPath(trimmedPath, project);
  const pathError =
    pathResult !== null && !pathResult.ok ? describePathError(pathResult.reason) : null;

  let parsedIr: readonly ICUNode[] | null = null;
  let parseError: string | null = null;
  if (raw !== '') {
    try {
      parsedIr = parseICU(raw);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
  }

  const canSubmit = trimmedPath !== '' && pathError === null && raw !== '' && parsedIr !== null;

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!canSubmit || parsedIr === null) return;
    onSubmit(trimmedPath, parsedIr, raw);
    setPath('');
    setRaw('');
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="add-key-path">
          Key path
        </label>
        <input
          id="add-key-path"
          className={styles.input}
          type="text"
          value={path}
          onChange={(e) => setPath(e.currentTarget.value)}
          placeholder="home.title or homeTitle"
          autoFocus
        />
        {pathError !== null && <span className={styles.error}>{pathError}</span>}
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="add-key-base">
          Base value ({project.baseLocale})
        </label>
        <textarea
          id="add-key-base"
          className={styles.textarea}
          value={raw}
          onChange={(e) => setRaw(e.currentTarget.value)}
          placeholder="Welcome, {name}!"
          rows={2}
        />
        {parseError !== null && <span className={styles.error}>ICU parse error: {parseError}</span>}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={`${styles.button} ${styles.primary}`}
          disabled={!canSubmit}
        >
          Add key
        </button>
      </div>
    </form>
  );
}
