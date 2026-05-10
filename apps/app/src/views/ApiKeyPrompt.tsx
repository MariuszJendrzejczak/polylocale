import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import type { SecretStore } from '../services/secret-store.js';

import styles from './PromptModal.module.css';

export interface ApiKeyPromptProps {
  readonly secretStore: SecretStore;
  /** Slot in the secret store to write the key into. */
  readonly slot: string;
  /** Display name of the provider (`'DeepL'`, `'OpenAI'`…). */
  readonly providerLabel: string;
  readonly onResolved: (success: boolean) => void;
}

export function ApiKeyPrompt(props: ApiKeyPromptProps): ReactElement {
  const { secretStore, slot, providerLabel, onResolved } = props;
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || value.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await secretStore.set(slot, value.trim());
      onResolved(true);
    } catch (err) {
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
        aria-labelledby="apikey-title"
      >
        <h2 id="apikey-title" className={styles.title}>
          {providerLabel} API key
        </h2>
        <p className={styles.body}>
          Paste your {providerLabel} API key. It is stored encrypted on this machine only — the
          project file never carries it. Free-tier DeepL keys end with <code>:fx</code>; the adapter
          routes them automatically to the free endpoint.
        </p>
        <label className={styles.label}>
          API key
          <input
            ref={inputRef}
            type="password"
            className={styles.input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
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
            disabled={busy || value.trim().length === 0}
          >
            {busy ? 'Saving…' : 'Save key'}
          </button>
        </div>
      </form>
    </div>
  );
}
