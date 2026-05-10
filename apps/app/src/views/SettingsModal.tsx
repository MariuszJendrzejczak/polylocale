import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import {
  getProviderRegistry,
  type ProviderId,
  type ProviderRegistryEntry,
} from '../services/ai-provider-host.js';
import { InvalidPassphraseError, type SecretStore } from '../services/secret-store.js';

import { ApiKeyPrompt } from './ApiKeyPrompt.js';
import styles from './SettingsModal.module.css';

export interface SettingsModalProps {
  readonly secretStore: SecretStore;
  readonly onClose: () => void;
  readonly onSlotMutated: (id: ProviderId) => void;
}

interface SlotInfo {
  readonly configured: boolean;
  readonly mask: string | null;
}

type SlotState = Readonly<Record<ProviderId, SlotInfo>>;

interface ApiKeyPromptState {
  readonly providerId: ProviderId;
  readonly slot: string;
  readonly label: string;
}

const NOTICE_TIMEOUT_MS = 3000;

export function SettingsModal({
  secretStore,
  onClose,
  onSlotMutated,
}: SettingsModalProps): ReactElement {
  const registry = getProviderRegistry();
  const [slots, setSlots] = useState<SlotState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<ProviderId | null>(null);
  const [apiKeyPrompt, setApiKeyPrompt] = useState<ApiKeyPromptState | null>(null);
  const [passphraseOpen, setPassphraseOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const names = new Set(await secretStore.list());
    const next: Record<ProviderId, SlotInfo> = {} as Record<ProviderId, SlotInfo>;
    for (const entry of registry) {
      if (!names.has(entry.slot)) {
        next[entry.id] = { configured: false, mask: null };
        continue;
      }
      const value = await secretStore.get(entry.slot);
      next[entry.id] = { configured: true, mask: maskKey(value ?? '') };
    }
    setSlots(next);
  }, [registry, secretStore]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && apiKeyPrompt === null) {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, apiKeyPrompt]);

  useEffect(() => {
    if (notice === null) return;
    const handle = window.setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(handle);
  }, [notice]);

  const onApiKeyResolved = useCallback(
    async (success: boolean): Promise<void> => {
      const target = apiKeyPrompt;
      setApiKeyPrompt(null);
      if (target === null || !success) return;
      onSlotMutated(target.providerId);
      await refresh();
    },
    [apiKeyPrompt, onSlotMutated, refresh],
  );

  const onConfirmDelete = useCallback(
    async (entry: ProviderRegistryEntry): Promise<void> => {
      setBusy(true);
      try {
        await secretStore.delete(entry.slot);
        setConfirmDeleteId(null);
        onSlotMutated(entry.id);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [secretStore, onSlotMutated, refresh],
  );

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && apiKeyPrompt === null) onClose();
      }}
    >
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className={styles.header}>
          <h2 id="settings-title" className={styles.title}>
            Settings
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </header>
        <div className={styles.body}>
          <section className={styles.section} aria-labelledby="settings-keys-heading">
            <h3 id="settings-keys-heading" className={styles.sectionHeading}>
              AI provider keys
            </h3>
            {slots === null ? (
              <p className={styles.empty}>Loading…</p>
            ) : everyUnconfigured(slots) ? (
              <p className={styles.empty}>
                No keys configured yet — translation flows will prompt as needed.
              </p>
            ) : null}
            {slots !== null &&
              registry.map((entry) => (
                <ProviderRow
                  key={entry.id}
                  entry={entry}
                  info={slots[entry.id]}
                  confirming={confirmDeleteId === entry.id}
                  busy={busy}
                  onAddOrReplace={() =>
                    setApiKeyPrompt({
                      providerId: entry.id,
                      slot: entry.slot,
                      label: entry.label,
                    })
                  }
                  onAskDelete={() => setConfirmDeleteId(entry.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                  onConfirmDelete={() => void onConfirmDelete(entry)}
                />
              ))}
          </section>
          <section className={styles.section} aria-labelledby="settings-passphrase-heading">
            <h3 id="settings-passphrase-heading" className={styles.sectionHeading}>
              Passphrase
            </h3>
            {!passphraseOpen && (
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setPassphraseOpen(true)}
                >
                  Change passphrase…
                </button>
              </div>
            )}
            {passphraseOpen && (
              <PassphraseForm
                secretStore={secretStore}
                onCancel={() => setPassphraseOpen(false)}
                onSuccess={() => {
                  setPassphraseOpen(false);
                  setNotice('Passphrase updated.');
                }}
              />
            )}
            {notice !== null && (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            )}
          </section>
        </div>
      </div>
      {apiKeyPrompt !== null && (
        <ApiKeyPrompt
          secretStore={secretStore}
          slot={apiKeyPrompt.slot}
          providerLabel={apiKeyPrompt.label}
          onResolved={(success) => void onApiKeyResolved(success)}
        />
      )}
    </div>
  );
}

function ProviderRow({
  entry,
  info,
  confirming,
  busy,
  onAddOrReplace,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  readonly entry: ProviderRegistryEntry;
  readonly info: SlotInfo;
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly onAddOrReplace: () => void;
  readonly onAskDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}): ReactElement {
  return (
    <div className={styles.row}>
      <span className={styles.providerLabel}>{entry.label}</span>
      <span
        className={`${styles.status} ${info.configured ? styles.statusConfigured : ''}`}
        aria-label={
          info.configured ? `${entry.label}: configured` : `${entry.label}: not configured`
        }
      >
        {info.configured ? (
          <>
            Configured · <span className={styles.mask}>{info.mask}</span>
          </>
        ) : (
          'Not configured'
        )}
      </span>
      {confirming ? (
        <span className={styles.confirmRow}>
          Are you sure?
          <button type="button" className={styles.button} onClick={onCancelDelete} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            onClick={onConfirmDelete}
            disabled={busy}
          >
            Delete
          </button>
        </span>
      ) : (
        <span className={styles.rowActions}>
          <button type="button" className={styles.button} onClick={onAddOrReplace} disabled={busy}>
            {info.configured ? 'Replace' : 'Add key'}
          </button>
          {info.configured && (
            <button
              type="button"
              className={`${styles.button} ${styles.danger}`}
              onClick={onAskDelete}
              disabled={busy}
            >
              Delete
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function PassphraseForm({
  secretStore,
  onCancel,
  onSuccess,
}: {
  readonly secretStore: SecretStore;
  readonly onCancel: () => void;
  readonly onSuccess: () => void;
}): ReactElement {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const mismatch = confirm !== '' && confirm !== next;
  const canSubmit =
    !busy && current.length > 0 && next.length > 0 && confirm === next && current !== next;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await secretStore.changePassphrase(current, next);
      onSuccess();
    } catch (err) {
      if (err instanceof InvalidPassphraseError) {
        setError('Current passphrase did not match.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setBusy(false);
    }
  }

  return (
    <form className={styles.passphraseForm} onSubmit={onSubmit}>
      <label className={styles.field}>
        Current passphrase
        <input
          ref={inputRef}
          type="password"
          className={styles.input}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          disabled={busy}
        />
      </label>
      <label className={styles.field}>
        New passphrase
        <input
          type="password"
          className={styles.input}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          disabled={busy}
        />
      </label>
      <label className={styles.field}>
        Confirm new passphrase
        <input
          type="password"
          className={styles.input}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          disabled={busy}
          aria-invalid={mismatch}
        />
      </label>
      {mismatch && (
        <p className={styles.error} role="alert">
          New passphrase and confirmation do not match.
        </p>
      )}
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <button type="button" className={styles.button} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="submit"
          className={`${styles.button} ${styles.primary}`}
          disabled={!canSubmit}
        >
          {busy ? 'Changing…' : 'Change passphrase'}
        </button>
      </div>
    </form>
  );
}

function maskKey(plaintext: string): string {
  const bullets = '••••••••';
  if (plaintext.length < 4) return bullets;
  return `${bullets}${plaintext.slice(-4)}`;
}

function everyUnconfigured(slots: SlotState): boolean {
  return Object.values(slots).every((s) => !s.configured);
}
