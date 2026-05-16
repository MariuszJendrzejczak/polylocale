import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import { InvalidPassphraseError, type SecretStore } from '../services/secret-store.js';

import styles from './PromptModal.module.css';

export interface PassphrasePromptProps {
  readonly secretStore: SecretStore;
  readonly onResolved: (success: boolean) => void;
}

export function PassphrasePrompt(props: PassphrasePromptProps): ReactElement {
  const { secretStore, onResolved } = props;
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || value.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await secretStore.unlock(value);
      onResolved(true);
    } catch (err) {
      if (err instanceof InvalidPassphraseError) {
        setError('Wrong passphrase. Try again.');
        setBusy(false);
        inputRef.current?.select();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onResolved(false);
        }
      }}
    >
      <form
        className={styles.card}
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="passphrase-title"
      >
        <h2 id="passphrase-title" className={styles.title}>
          Unlock secret store
        </h2>
        <p className={styles.body}>
          Enter the passphrase that protects your stored API keys. The first time you use this
          machine you choose the passphrase here; thereafter it must match.
        </p>
        <label className={styles.label}>
          Passphrase
          <input
            ref={inputRef}
            type="password"
            className={styles.input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
          />
        </label>
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={() => onResolved(false)}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`${styles.button} ${styles.primary}`}
            disabled={busy || value.length === 0}
          >
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  );
}
