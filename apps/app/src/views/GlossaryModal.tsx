import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';

import type { GlossaryEntry, LocaleCode, LocalizationProject } from '@polylocale/core';

import styles from './GlossaryModal.module.css';

export interface GlossaryModalProps {
  readonly project: LocalizationProject;
  readonly onAdd: (entry: GlossaryEntry) => void;
  readonly onUpdate: (previousTerm: string, entry: GlossaryEntry) => void;
  readonly onRemove: (term: string) => void;
  readonly onClose: () => void;
}

export function GlossaryModal({
  project,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}: GlossaryModalProps): ReactElement {
  const [search, setSearch] = useState('');
  const [confirmingTerm, setConfirmingTerm] = useState<string | null>(null);

  const entries = useMemo(() => project.glossary ?? [], [project.glossary]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && confirmingTerm === null) {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, confirmingTerm]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return entries;
    return entries.filter((e) => e.term.toLowerCase().includes(needle));
  }, [entries, search]);

  const onClickAdd = useCallback((): void => {
    let candidate = 'new term';
    let n = 2;
    while (entries.some((e) => e.term === candidate)) {
      candidate = `new term ${n++}`;
    }
    onAdd({ term: candidate, perLocale: {} });
  }, [entries, onAdd]);

  const onConfirmDelete = useCallback(
    (term: string): void => {
      onRemove(term);
      setConfirmingTerm(null);
    },
    [onRemove],
  );

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && confirmingTerm === null) onClose();
      }}
    >
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="glossary-title">
        <header className={styles.header}>
          <h2 id="glossary-title" className={styles.title}>
            Glossary
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close glossary"
          >
            ×
          </button>
        </header>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.search}
            placeholder="Search terms…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            aria-label="Search glossary terms"
          />
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={onClickAdd}
          >
            + Add term
          </button>
        </div>
        <div className={styles.body}>
          {entries.length === 0 ? (
            <p className={styles.empty}>
              No glossary terms yet — they&apos;ll be passed to OpenAI/Anthropic as hints and to
              DeepL via /v2/glossaries when configured.
            </p>
          ) : filtered.length === 0 ? (
            <p className={styles.empty}>No terms match &quot;{search}&quot;.</p>
          ) : (
            filtered.map((entry) => (
              <EntryEditor
                key={entry.term}
                entry={entry}
                baseLocale={project.baseLocale}
                locales={project.locales}
                confirming={confirmingTerm === entry.term}
                onAskDelete={() => setConfirmingTerm(entry.term)}
                onCancelDelete={() => setConfirmingTerm(null)}
                onConfirmDelete={() => onConfirmDelete(entry.term)}
                onUpdate={(updated) => onUpdate(entry.term, updated)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface EntryEditorProps {
  readonly entry: GlossaryEntry;
  readonly baseLocale: LocaleCode;
  readonly locales: readonly LocaleCode[];
  readonly confirming: boolean;
  readonly onAskDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onUpdate: (entry: GlossaryEntry) => void;
}

function EntryEditor(props: EntryEditorProps): ReactElement {
  const {
    entry,
    baseLocale,
    locales,
    confirming,
    onAskDelete,
    onCancelDelete,
    onConfirmDelete,
    onUpdate,
  } = props;

  const [termBuffer, setTermBuffer] = useState(entry.term);
  const [notesBuffer, setNotesBuffer] = useState(entry.notes ?? '');

  useEffect(() => {
    setTermBuffer(entry.term);
  }, [entry.term]);

  useEffect(() => {
    setNotesBuffer(entry.notes ?? '');
  }, [entry.notes]);

  const commitTerm = useCallback((): void => {
    const trimmed = termBuffer.trim();
    if (trimmed === '' || trimmed === entry.term) {
      setTermBuffer(entry.term);
      return;
    }
    onUpdate({ ...entry, term: trimmed });
  }, [entry, onUpdate, termBuffer]);

  const commitNotes = useCallback((): void => {
    const next = notesBuffer.trim();
    const current = entry.notes ?? '';
    if (next === current) return;
    if (next === '') {
      const { notes: _omit, ...rest } = entry;
      onUpdate(rest);
    } else {
      onUpdate({ ...entry, notes: next });
    }
  }, [entry, notesBuffer, onUpdate]);

  const updatePerLocale = useCallback(
    (locale: LocaleCode, patch: { translation?: string; doNotTranslate?: boolean }): void => {
      const trimmedTranslation = patch.translation?.trim();
      const next: GlossaryEntry['perLocale'][string] = {
        ...(trimmedTranslation !== undefined && trimmedTranslation !== ''
          ? { translation: trimmedTranslation }
          : {}),
        ...(patch.doNotTranslate === true ? { doNotTranslate: true } : {}),
      };
      const nextPerLocale: Record<LocaleCode, GlossaryEntry['perLocale'][string]> = {
        ...entry.perLocale,
      };
      if (Object.keys(next).length === 0) {
        delete nextPerLocale[locale];
      } else {
        nextPerLocale[locale] = next;
      }
      onUpdate({ ...entry, perLocale: nextPerLocale });
    },
    [entry, onUpdate],
  );

  return (
    <div className={styles.entry}>
      <div className={styles.entryHeader}>
        <input
          className={styles.termInput}
          value={termBuffer}
          onChange={(e) => setTermBuffer(e.currentTarget.value)}
          onBlur={commitTerm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setTermBuffer(entry.term);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          aria-label={`Term ${entry.term}`}
        />
        {confirming ? (
          <span className={styles.confirmRow}>
            Delete?
            <button type="button" className={styles.button} onClick={onCancelDelete}>
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.danger}`}
              onClick={onConfirmDelete}
            >
              Delete
            </button>
          </span>
        ) : (
          <div className={styles.rowActions}>
            <button
              type="button"
              className={`${styles.button} ${styles.danger}`}
              onClick={onAskDelete}
              aria-label={`Delete ${entry.term}`}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <div className={styles.localeRows}>
        {locales.map((locale) => {
          const cell = entry.perLocale[locale];
          const dnt = cell?.doNotTranslate === true;
          const translation = cell?.translation ?? '';
          const isBase = locale === baseLocale;
          const showBaseHint =
            isBase && translation.trim() === '' && !dnt;
          return (
            <LocaleRow
              key={locale}
              locale={locale}
              isBase={isBase}
              translation={translation}
              doNotTranslate={dnt}
              showBaseHint={showBaseHint}
              onTranslationCommit={(value) =>
                updatePerLocale(locale, { translation: value, doNotTranslate: dnt })
              }
              onToggleDoNotTranslate={(value) =>
                updatePerLocale(locale, { translation: value ? '' : translation, doNotTranslate: value })
              }
            />
          );
        })}
      </div>
      <label className={styles.notesLabel}>
        Notes
        <textarea
          className={styles.notes}
          value={notesBuffer}
          onChange={(e) => setNotesBuffer(e.currentTarget.value)}
          onBlur={commitNotes}
          rows={1}
          aria-label={`Notes for ${entry.term}`}
        />
      </label>
    </div>
  );
}

interface LocaleRowProps {
  readonly locale: LocaleCode;
  readonly isBase: boolean;
  readonly translation: string;
  readonly doNotTranslate: boolean;
  readonly showBaseHint: boolean;
  readonly onTranslationCommit: (value: string) => void;
  readonly onToggleDoNotTranslate: (value: boolean) => void;
}

function LocaleRow(props: LocaleRowProps): ReactElement {
  const {
    locale,
    isBase,
    translation,
    doNotTranslate,
    showBaseHint,
    onTranslationCommit,
    onToggleDoNotTranslate,
  } = props;
  const [buffer, setBuffer] = useState(translation);

  useEffect(() => {
    setBuffer(translation);
  }, [translation]);

  const commit = useCallback((): void => {
    if (buffer === translation) return;
    onTranslationCommit(buffer);
  }, [buffer, translation, onTranslationCommit]);

  function onChange(e: ChangeEvent<HTMLInputElement>): void {
    setBuffer(e.currentTarget.value);
  }

  return (
    <>
      <span className={`${styles.localeTag} ${isBase ? styles.baseTag : ''}`}>
        {locale}
        {isBase && ' · base'}
      </span>
      <input
        type="text"
        className={styles.translationInput}
        value={buffer}
        onChange={onChange}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        }}
        disabled={doNotTranslate}
        placeholder={doNotTranslate ? '(keep verbatim)' : 'translation'}
        aria-label={`${locale} translation`}
      />
      <label className={styles.toggleLabel}>
        <input
          type="checkbox"
          checked={doNotTranslate}
          onChange={(e) => onToggleDoNotTranslate(e.currentTarget.checked)}
          aria-label={`Don't translate ${locale}`}
        />
        Don&apos;t translate
      </label>
      {showBaseHint && (
        <span className={styles.hint}>(no entry for {locale})</span>
      )}
    </>
  );
}
