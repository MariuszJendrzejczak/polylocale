import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';

import type { LocaleCode, TranslationKey } from '@polylocale/core';
import { Table, type TableColumn } from '@polylocale/ui';

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

import { AiCellAction } from './AiCellAction.js';
import { ApiKeyPrompt } from './ApiKeyPrompt.js';
import { CellEditor } from './CellEditor.js';
import { PassphrasePrompt } from './PassphrasePrompt.js';
import styles from './EditorView.module.css';

const DEEPL_KEY_SLOT = 'deepl-api-key';

interface ReopenPrompt {
  readonly handle: FileSystemDirectoryHandle;
  readonly meta: EditorMeta | undefined;
}

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

  const columns = useMemo<readonly TableColumn<TranslationKey>[]>(() => {
    if (project === null) return [];
    const baseLocale = project.baseLocale;
    const localeColumns: TableColumn<TranslationKey>[] = project.locales.map((locale) => ({
      id: locale,
      header: <LocaleHeader locale={locale} isBase={locale === baseLocale} />,
      minWidth: 240,
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
            onCommit={(ir, raw) => dispatch({ type: 'setValue', keyPath: row.path, locale, ir, raw })}
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
        cell: (row: TranslationKey) => <KeyCell row={row} />,
      },
      ...localeColumns,
    ];
  }, [project, dirty, dispatch, pendingTranslations, aiHost]);

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
          <Table<TranslationKey> rows={project.keys} columns={columns} rowKey={(row) => row.id} />
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
    </div>
  );
}

function KeyCell({ row }: { readonly row: TranslationKey }): ReactElement {
  return (
    <div className={styles.keyCell}>
      <span className={styles.keyPath} title={row.path}>
        {row.path}
      </span>
      {row.description !== undefined && (
        <span className={styles.keyDesc} title={row.description}>
          {row.description}
        </span>
      )}
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
