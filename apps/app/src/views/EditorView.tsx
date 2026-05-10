import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';

import { renderICU, type LocaleCode, type TranslationKey } from '@polylocale/core';
import { Table, type TableColumn } from '@polylocale/ui';
import type { OnChangeFn, SortingState } from '@tanstack/react-table';

import { createAIProviderHost } from '../services/ai-provider-host.js';
import {
  composeFromLoaded,
  downloadFiles,
  isDirectoryPickerSupported,
  loadFromInputFiles,
  openDirectory,
  readDirectory,
  saveToDirectory,
  type LoadedFile,
} from '../services/file-system.js';
import {
  runTranslations,
  type TranslationJob,
  type TranslationOutcome,
} from '../services/translate-orchestrator.js';
import {
  clearDirectoryHandle,
  loadDirectoryHandle,
  loadEditorMeta,
  saveDirectoryHandle,
  saveEditorMeta,
  type EditorMeta,
} from '../services/persistence.js';
import { createSecretStore } from '../services/secret-store.js';
import { deriveCellIssues } from '../state/derive-issues.js';
import { useEditor } from '../state/editor-context.js';
import { pendingKey } from '../state/editor-state.js';

import { AddKeyForm } from './AddKeyForm.js';
import { AiCellAction } from './AiCellAction.js';
import { ApiKeyPrompt } from './ApiKeyPrompt.js';
import { BatchTranslateModal, type AcceptedTranslation } from './BatchTranslateModal.js';
import { CellEditor } from './CellEditor.js';
import { FillMissingButton } from './FillMissingButton.js';
import { PassphrasePrompt } from './PassphrasePrompt.js';
import { RowTranslateMenu } from './RowTranslateMenu.js';
import { sortByStatus } from './sort/status-priority.js';
import { useDebouncedValue } from './use-debounced-value.js';
import styles from './EditorView.module.css';

const DEEPL_KEY_SLOT = 'deepl-api-key';

interface ReopenPrompt {
  readonly handle: FileSystemDirectoryHandle;
  readonly meta: EditorMeta | undefined;
}

type BatchState =
  | {
      readonly phase: 'running';
      readonly title: string;
      readonly total: number;
      readonly completed: number;
      readonly controller: AbortController;
    }
  | {
      readonly phase: 'review';
      readonly title: string;
      readonly outcomes: readonly TranslationOutcome[];
    };

export function EditorView(): ReactElement {
  const { state, dispatch } = useEditor();
  const inputRef = useRef<HTMLInputElement>(null);
  const initRef = useRef(false);
  const [reopen, setReopen] = useState<ReopenPrompt | null>(null);
  const [unlockGate, setUnlockGate] = useState<((success: boolean) => void) | null>(null);
  const [apiKeyGate, setApiKeyGate] = useState<((success: boolean) => void) | null>(null);

  const secretStore = useMemo(() => createSecretStore({ idb: globalThis.indexedDB }), []);

  const requestUnlock = useCallback(
    (): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setUnlockGate(() => (success: boolean) => {
          setUnlockGate(null);
          resolve(success);
        });
      }),
    [],
  );

  const requestApiKey = useCallback(
    (): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setApiKeyGate(() => (success: boolean) => {
          setApiKeyGate(null);
          resolve(success);
        });
      }),
    [],
  );

  const aiHost = useMemo(
    () => createAIProviderHost({ secretStore, requestUnlock, requestApiKey }),
    [secretStore, requestUnlock, requestApiKey],
  );

  const [batch, setBatch] = useState<BatchState | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 150);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [statusSortDir, setStatusSortDir] = useState<'asc' | 'desc' | null>(null);
  const [addFormOpen, setAddFormOpen] = useState(false);

  const onSortingChange = useCallback<OnChangeFn<SortingState>>((updater) => {
    setStatusSortDir(null);
    setSorting((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);

  const cycleStatusSort = useCallback(() => {
    setSorting([]);
    setStatusSortDir((prev) => (prev === null ? 'asc' : prev === 'asc' ? 'desc' : null));
  }, []);

  const runBatch = useCallback(
    async (jobs: readonly TranslationJob[], title: string): Promise<void> => {
      if (jobs.length === 0 || state.project === null) return;
      const provider = await aiHost.getProvider();
      if (provider === null) return;
      dispatch({
        type: 'translationStart',
        entries: jobs.map((j) => ({ keyId: j.keyId, locale: j.locale })),
      });
      const controller = new AbortController();
      setBatch({ phase: 'running', total: jobs.length, completed: 0, controller, title });
      try {
        const outcomes = await runTranslations(jobs, provider, {
          signal: controller.signal,
          onProgress: (_, completed, total) => {
            setBatch((prev) =>
              prev !== null && prev.phase === 'running' ? { ...prev, completed, total } : prev,
            );
          },
        });
        if (controller.signal.aborted) {
          dispatch({
            type: 'translationClear',
            entries: jobs.map((j) => ({ keyId: j.keyId, locale: j.locale })),
          });
          setBatch(null);
          return;
        }
        for (const o of outcomes) {
          if (o.status.kind === 'error') {
            dispatch({
              type: 'translationFail',
              keyId: o.job.keyId,
              locale: o.job.locale,
              message: o.status.message,
            });
          } else if (o.status.kind !== 'ready') {
            dispatch({
              type: 'translationClear',
              entries: [{ keyId: o.job.keyId, locale: o.job.locale }],
            });
          }
        }
        setBatch({ phase: 'review', outcomes, title });
      } catch (err) {
        dispatch({
          type: 'translationClear',
          entries: jobs.map((j) => ({ keyId: j.keyId, locale: j.locale })),
        });
        dispatch({ type: 'banner', banner: { kind: 'error', message: errorMessage(err) } });
        setBatch(null);
      }
    },
    [aiHost, dispatch, state.project],
  );

  const onTranslateRowMissing = useCallback(
    (key: TranslationKey): void => {
      if (state.project === null) return;
      const jobs = jobsForRow(
        key,
        state.project.baseLocale,
        state.project.locales,
        state.pendingTranslations,
      );
      if (jobs.length === 0) return;
      void runBatch(jobs, `Translate missing for ${key.path}`);
    },
    [runBatch, state.pendingTranslations, state.project],
  );

  const onFillMissingForLocale = useCallback(
    (locale: LocaleCode): void => {
      if (state.project === null) return;
      const jobs = jobsForLocale(
        state.project.keys,
        locale,
        state.project.baseLocale,
        state.pendingTranslations,
      );
      if (jobs.length === 0) {
        dispatch({
          type: 'banner',
          banner: { kind: 'info', message: `No missing translations for ${locale}.` },
        });
        return;
      }
      void runBatch(jobs, `Fill missing for ${locale}`);
    },
    [runBatch, dispatch, state.pendingTranslations, state.project],
  );

  const onApplyBatch = useCallback(
    (accepted: readonly AcceptedTranslation[]): void => {
      if (accepted.length > 0) {
        dispatch({
          type: 'setValuesBatch',
          entries: accepted.map((a) => ({
            keyPath: a.keyPath,
            locale: a.locale,
            ir: a.ir,
            raw: a.raw,
            source: 'ai',
            aiProvider: 'deepl',
          })),
        });
      }
      // Clear any pending entries for outcomes the user dismissed (unchecked).
      if (batch?.phase === 'review') {
        const acceptedKeys = new Set(accepted.map((a) => `${a.keyId}:${a.locale}`));
        const toClear = batch.outcomes
          .filter(
            (o) => o.status.kind === 'ready' && !acceptedKeys.has(`${o.job.keyId}:${o.job.locale}`),
          )
          .map((o) => ({ keyId: o.job.keyId, locale: o.job.locale }));
        if (toClear.length > 0) dispatch({ type: 'translationClear', entries: toClear });
      }
      setBatch(null);
    },
    [batch, dispatch],
  );

  const onCloseBatchReview = useCallback((): void => {
    if (batch?.phase === 'review') {
      const toClear = batch.outcomes
        .filter((o) => o.status.kind === 'ready')
        .map((o) => ({ keyId: o.job.keyId, locale: o.job.locale }));
      if (toClear.length > 0) dispatch({ type: 'translationClear', entries: toClear });
    }
    setBatch(null);
  }, [batch, dispatch]);

  const onCancelBatchRunning = useCallback((): void => {
    if (batch?.phase === 'running') batch.controller.abort();
  }, [batch]);

  const reopenFromHandle = useCallback(
    async (handle: FileSystemDirectoryHandle, meta: EditorMeta | undefined): Promise<void> => {
      const { loaded, skipped } = await readDirectory(handle);
      if (loaded.length === 0) {
        dispatch({
          type: 'banner',
          banner: { kind: 'error', message: `no .arb / .json files in "${handle.name}"` },
        });
        return;
      }
      const project = composeFromLoaded({
        loaded,
        projectName: meta?.projectName ?? handle.name,
        ...(meta?.baseLocale !== undefined ? { baseLocale: meta.baseLocale } : {}),
      });
      dispatch({
        type: 'loaded',
        project,
        fsMode: 'fs-access',
        directoryHandle: handle,
        directoryName: handle.name,
        fileHandles: handlesFromLoaded(loaded),
        skipped,
      });
      setReopen(null);
      await saveEditorMeta({
        projectName: handle.name,
        baseLocale: project.baseLocale,
        lastOpenedAt: Date.now(),
      });
    },
    [dispatch],
  );

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void (async () => {
      try {
        const handle = await loadDirectoryHandle();
        if (handle === undefined) return;
        const meta = await loadEditorMeta();
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          await reopenFromHandle(handle, meta);
        } else {
          setReopen({ handle, meta });
        }
      } catch (err) {
        console.warn('persistence: failed to restore handle', err);
      }
    })();
  }, [reopenFromHandle]);

  const onOpenFolder = useCallback(async () => {
    try {
      const result = await openDirectory();
      if (result === null) {
        inputRef.current?.click();
        return;
      }
      if (result.loaded.length === 0) {
        dispatch({
          type: 'banner',
          banner: { kind: 'error', message: 'no .arb / .json files found in this folder' },
        });
        return;
      }
      const project = composeFromLoaded({
        loaded: result.loaded,
        projectName: result.directoryName,
      });
      dispatch({
        type: 'loaded',
        project,
        fsMode: 'fs-access',
        directoryHandle: result.directoryHandle,
        directoryName: result.directoryName,
        fileHandles: handlesFromLoaded(result.loaded),
        skipped: result.skipped,
      });
      setReopen(null);
      await saveDirectoryHandle(result.directoryHandle);
      await saveEditorMeta({
        projectName: result.directoryName,
        baseLocale: project.baseLocale,
        lastOpenedAt: Date.now(),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      dispatch({ type: 'banner', banner: { kind: 'error', message: errorMessage(err) } });
    }
  }, [dispatch]);

  const onOpenFiles = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const files = e.target.files;
      e.target.value = '';
      if (files === null || files.length === 0) return;
      try {
        const { loaded, skipped } = await loadFromInputFiles(files);
        if (loaded.length === 0) {
          dispatch({
            type: 'banner',
            banner: { kind: 'error', message: 'no parseable files in selection' },
          });
          return;
        }
        const project = composeFromLoaded({ loaded, projectName: 'Untitled project' });
        dispatch({
          type: 'loaded',
          project,
          fsMode: 'fallback',
          directoryHandle: null,
          directoryName: null,
          fileHandles: new Map(),
          skipped,
        });
        await clearDirectoryHandle();
      } catch (err) {
        dispatch({ type: 'banner', banner: { kind: 'error', message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const onSave = useCallback(async () => {
    if (state.project === null) return;
    try {
      if (state.fsMode === 'fs-access') {
        const result = await saveToDirectory({
          project: state.project,
          handlesByPath: state.fileHandles,
        });
        if (result.errors.length > 0) {
          dispatch({
            type: 'banner',
            banner: {
              kind: 'error',
              message: result.errors.map((e) => `${e.path}: ${e.reason}`).join('; '),
            },
          });
          return;
        }
      } else {
        downloadFiles(state.project);
      }
      dispatch({ type: 'markSaved', at: Date.now() });
    } catch (err) {
      dispatch({ type: 'banner', banner: { kind: 'error', message: errorMessage(err) } });
    }
  }, [dispatch, state.fsMode, state.fileHandles, state.project]);

  const onReopen = useCallback(async () => {
    if (reopen === null) return;
    try {
      const perm = await reopen.handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        dispatch({
          type: 'banner',
          banner: { kind: 'error', message: 'permission denied — try opening the folder again' },
        });
        return;
      }
      await reopenFromHandle(reopen.handle, reopen.meta);
    } catch (err) {
      dispatch({ type: 'banner', banner: { kind: 'error', message: errorMessage(err) } });
    }
  }, [reopen, dispatch, reopenFromHandle]);

  const project = state.project;
  const dirty = state.dirty;
  const pendingTranslations = state.pendingTranslations;

  const filterRow = useCallback((row: TranslationKey, query: string): boolean => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return true;
    if (row.path.toLowerCase().includes(needle)) return true;
    for (const value of Object.values(row.values)) {
      if (value === undefined) continue;
      const haystack = (value.raw ?? renderICU(value.ir)).toLowerCase();
      if (haystack.includes(needle)) return true;
    }
    return false;
  }, []);

  const columns = useMemo<readonly TableColumn<TranslationKey>[]>(() => {
    if (project === null) return [];
    const baseLocale = project.baseLocale;
    const localeColumns: TableColumn<TranslationKey>[] = project.locales.map((locale) => ({
      id: locale,
      header: <LocaleHeader locale={locale} isBase={locale === baseLocale} />,
      minWidth: 240,
      sortBy: (row: TranslationKey) => {
        const value = row.values[locale];
        if (value === undefined) return '';
        return value.raw ?? renderICU(value.ir);
      },
      cell: (row: TranslationKey) => {
        const issues = deriveCellIssues(row, locale, baseLocale);
        const pending = pendingTranslations.get(pendingKey(row.id, locale));
        const showAi = locale !== baseLocale && (issues.missing || issues.empty);
        const aiAction = showAi ? (
          <AiCellAction
            host={aiHost}
            keyId={row.id}
            keyPath={row.path}
            locale={locale}
            baseLocale={baseLocale}
            baseValue={row.values[baseLocale]}
            {...(row.description !== undefined ? { description: row.description } : {})}
            isPending={pending === 'pending'}
            onStart={() =>
              dispatch({
                type: 'translationStart',
                entries: [{ keyId: row.id, locale }],
              })
            }
            onClear={() =>
              dispatch({
                type: 'translationClear',
                entries: [{ keyId: row.id, locale }],
              })
            }
            onFail={(message) =>
              dispatch({ type: 'translationFail', keyId: row.id, locale, message })
            }
            onAccept={(ir, raw) =>
              dispatch({
                type: 'setValue',
                keyPath: row.path,
                locale,
                ir,
                raw,
                source: 'ai',
                aiProvider: 'deepl',
              })
            }
          />
        ) : undefined;
        return (
          <CellEditor
            value={row.values[locale]}
            issues={issues}
            dirty={dirty.has(row.id)}
            onCommit={(ir, raw) =>
              dispatch({ type: 'setValue', keyPath: row.path, locale, ir, raw })
            }
            {...(aiAction !== undefined ? { aiAction } : {})}
            {...(pending !== undefined ? { pending } : {})}
          />
        );
      },
    }));
    return [
      {
        id: '__key',
        header: 'Key',
        width: 280,
        sortBy: (row: TranslationKey) => row.path,
        cell: (row: TranslationKey) => (
          <KeyCell row={row} onTranslateMissing={() => onTranslateRowMissing(row)} />
        ),
      },
      ...localeColumns,
    ];
  }, [project, dirty, dispatch, pendingTranslations, aiHost, onTranslateRowMissing]);

  const tableRows = useMemo<readonly TranslationKey[]>(() => {
    if (project === null) return [];
    if (statusSortDir === null) return project.keys;
    return sortByStatus(project.keys, project.locales, project.baseLocale, statusSortDir);
  }, [project, statusSortDir]);

  const supportsPicker = isDirectoryPickerSupported();

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <div className={styles.title}>
          <span className={styles.brand}>polylocale</span>
          {project !== null && (
            <>
              <span className={styles.divider}>/</span>
              <span className={styles.projectName}>{project.name}</span>
              <span className={styles.subtle}>
                · base {project.baseLocale} · {project.keys.length} keys
              </span>
              {state.fsMode === 'fallback' && (
                <span className={styles.fsTag} title="Browser does not support directory writeback">
                  fallback
                </span>
              )}
            </>
          )}
        </div>
        <div className={styles.actions}>
          {project !== null && (
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search keys or values…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.currentTarget.value)}
              aria-label="Search keys or values"
            />
          )}
          {project !== null && (
            <button
              type="button"
              className={`${styles.button} ${statusSortDir !== null ? styles.toggleActive : ''}`}
              onClick={cycleStatusSort}
              title="Sort rows by aggregate status (missing → placeholder mismatch → empty → ok)"
              aria-pressed={statusSortDir !== null}
            >
              Status {statusSortDir === 'asc' ? '▲' : statusSortDir === 'desc' ? '▼' : '↕'}
            </button>
          )}
          {project !== null && (
            <button
              type="button"
              className={styles.button}
              onClick={() => setAddFormOpen((open) => !open)}
              aria-pressed={addFormOpen}
            >
              + Add key
            </button>
          )}
          {project === null && reopen !== null && (
            <button type="button" className={styles.button} onClick={onReopen}>
              Reopen &ldquo;{reopen.handle.name}&rdquo;
            </button>
          )}
          <button type="button" className={styles.button} onClick={onOpenFolder}>
            {supportsPicker ? 'Open folder…' : 'Open files…'}
          </button>
          {supportsPicker && (
            <button
              type="button"
              className={styles.button}
              onClick={onOpenFiles}
              title="Use a regular file picker (no save-back)"
            >
              Open files…
            </button>
          )}
          {project !== null && (
            <FillMissingButton
              locales={project.locales.filter((l) => l !== project.baseLocale)}
              disabled={batch !== null}
              onFill={onFillMissingForLocale}
            />
          )}
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={onSave}
            disabled={project === null || state.dirty.size === 0}
          >
            {state.fsMode === 'fallback' ? 'Download' : 'Save'}
            {state.dirty.size > 0 && <span className={styles.count}>{state.dirty.size}</span>}
          </button>
        </div>
      </header>
      {addFormOpen && project !== null && (
        <AddKeyForm
          project={project}
          onSubmit={(path, ir, raw) => {
            dispatch({ type: 'addKey', path, baseValue: { ir, raw } });
            setAddFormOpen(false);
          }}
          onCancel={() => setAddFormOpen(false)}
        />
      )}
      {state.banner !== null && (
        <div
          className={`${styles.banner} ${state.banner.kind === 'error' ? styles.bannerError : styles.bannerInfo}`}
          role="status"
        >
          <span>{state.banner.message}</span>
          <button
            type="button"
            className={styles.bannerClose}
            onClick={() => dispatch({ type: 'banner', banner: null })}
            aria-label="dismiss"
          >
            ×
          </button>
        </div>
      )}
      <main className={styles.body}>
        {project === null ? (
          <EmptyState onOpenFolder={onOpenFolder} supportsPicker={supportsPicker} />
        ) : (
          <Table<TranslationKey>
            rows={tableRows}
            columns={columns}
            rowKey={(row) => row.id}
            globalFilter={debouncedSearch}
            globalFilterFn={filterRow}
            sorting={sorting}
            onSortingChange={onSortingChange}
          />
        )}
      </main>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".arb,.json,application/json"
        className={styles.hiddenInput}
        onChange={onInputChange}
      />
      {unlockGate !== null && (
        <PassphrasePrompt secretStore={secretStore} onResolved={unlockGate} />
      )}
      {apiKeyGate !== null && (
        <ApiKeyPrompt
          secretStore={secretStore}
          slot={DEEPL_KEY_SLOT}
          providerLabel="DeepL"
          onResolved={apiKeyGate}
        />
      )}
      {batch?.phase === 'running' && (
        <BatchProgressModal
          title={batch.title}
          completed={batch.completed}
          total={batch.total}
          onCancel={onCancelBatchRunning}
        />
      )}
      {batch?.phase === 'review' && project !== null && (
        <BatchTranslateModal
          title={batch.title}
          outcomes={batch.outcomes}
          baseTextFor={(keyId) => baseTextFor(project.keys, project.baseLocale, keyId)}
          onApply={onApplyBatch}
          onClose={onCloseBatchReview}
        />
      )}
    </div>
  );
}

function BatchProgressModal({
  title,
  completed,
  total,
  onCancel,
}: {
  readonly title: string;
  readonly completed: number;
  readonly total: number;
  readonly onCancel: () => void;
}): ReactElement {
  return (
    <div className={styles.batchOverlay} role="presentation">
      <div className={styles.batchProgress} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.batchTitle}>{title}</div>
        <div className={styles.batchCount}>
          {completed} / {total} translations done
        </div>
        <div className={styles.batchBar}>
          <span style={{ width: `${total === 0 ? 0 : (completed / total) * 100}%` }} />
        </div>
        <div className={styles.batchActions}>
          <button type="button" className={styles.button} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyCell({
  row,
  onTranslateMissing,
}: {
  readonly row: TranslationKey;
  readonly onTranslateMissing: () => void;
}): ReactElement {
  return (
    <div className={styles.keyCell}>
      <div className={styles.keyText}>
        <span className={styles.keyPath} title={row.path}>
          {row.path}
        </span>
        {row.description !== undefined && (
          <span className={styles.keyDesc} title={row.description}>
            {row.description}
          </span>
        )}
      </div>
      <RowTranslateMenu onTranslateMissing={onTranslateMissing} />
    </div>
  );
}

function LocaleHeader({
  locale,
  isBase,
}: {
  readonly locale: LocaleCode;
  readonly isBase: boolean;
}): ReactElement {
  return (
    <span className={styles.localeHeader}>
      <span>{locale}</span>
      {isBase && <span className={styles.baseTag}>base</span>}
    </span>
  );
}

function EmptyState({
  onOpenFolder,
  supportsPicker,
}: {
  readonly onOpenFolder: () => void;
  readonly supportsPicker: boolean;
}): ReactElement {
  return (
    <div className={styles.empty}>
      <h2 className={styles.emptyHeading}>No project loaded</h2>
      <p className={styles.emptyBody}>
        {supportsPicker
          ? 'Open a folder of .arb or .json locale files to start editing.'
          : 'Pick one or more .arb / .json files to start editing. Save will download the result.'}
      </p>
      <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onOpenFolder}>
        {supportsPicker ? 'Open folder…' : 'Open files…'}
      </button>
    </div>
  );
}

function handlesFromLoaded(
  loaded: readonly LoadedFile[],
): ReadonlyMap<string, FileSystemFileHandle> {
  const map = new Map<string, FileSystemFileHandle>();
  for (const l of loaded) {
    if (l.fileHandle !== undefined) map.set(l.parsed.path, l.fileHandle);
  }
  return map;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function jobsForRow(
  key: TranslationKey,
  baseLocale: LocaleCode,
  locales: readonly LocaleCode[],
  pending: ReadonlyMap<string, unknown>,
): readonly TranslationJob[] {
  const baseValue = key.values[baseLocale];
  if (baseValue === undefined) return [];
  const out: TranslationJob[] = [];
  for (const locale of locales) {
    if (locale === baseLocale) continue;
    if (!isMissingOrEmpty(key, locale)) continue;
    if (pending.has(`${key.id}:${locale}`)) continue;
    out.push({
      keyId: key.id,
      keyPath: key.path,
      locale,
      baseLocale,
      baseIr: baseValue.ir,
      ...(key.description !== undefined ? { description: key.description } : {}),
    });
  }
  return out;
}

function jobsForLocale(
  keys: readonly TranslationKey[],
  locale: LocaleCode,
  baseLocale: LocaleCode,
  pending: ReadonlyMap<string, unknown>,
): readonly TranslationJob[] {
  const out: TranslationJob[] = [];
  for (const key of keys) {
    if (!isMissingOrEmpty(key, locale)) continue;
    const baseValue = key.values[baseLocale];
    if (baseValue === undefined) continue;
    if (pending.has(`${key.id}:${locale}`)) continue;
    out.push({
      keyId: key.id,
      keyPath: key.path,
      locale,
      baseLocale,
      baseIr: baseValue.ir,
      ...(key.description !== undefined ? { description: key.description } : {}),
    });
  }
  return out;
}

function isMissingOrEmpty(key: TranslationKey, locale: LocaleCode): boolean {
  const value = key.values[locale];
  if (value === undefined) return true;
  if (value.ir.length === 0) return true;
  return value.ir.every((node) => node.kind === 'text' && node.value.trim() === '');
}

function baseTextFor(
  keys: readonly TranslationKey[],
  baseLocale: LocaleCode,
  keyId: string,
): string {
  const key = keys.find((k) => k.id === keyId);
  const value = key?.values[baseLocale];
  if (value === undefined) return '';
  if (value.raw !== undefined) return value.raw;
  return renderICU(value.ir);
}
