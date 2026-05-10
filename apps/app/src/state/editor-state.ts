/**
 * Editor reducer + state types.
 *
 * Pure — no JSX, no async work, no service calls. Async flows live in the
 * view layer (`EditorView.tsx`) which dispatches results back through the
 * reducer once they resolve.
 */

import type {
  ICUNode,
  KeyStatus,
  LocaleCode,
  LocalizationProject,
  ProjectSettings,
  TranslationKey,
  TranslationValue,
} from '@polylocale/core';

import type { SkippedFile } from '../services/file-system.js';

export type FsMode = 'fs-access' | 'fallback' | 'none';

export interface EditorBanner {
  readonly kind: 'error' | 'info';
  readonly message: string;
}

export type ValueSource = 'manual' | 'ai' | 'imported';

export type PendingTranslation = 'pending' | { readonly error: string };

export interface BatchValueEntry {
  readonly keyPath: string;
  readonly locale: LocaleCode;
  readonly ir: readonly ICUNode[];
  readonly raw: string;
  readonly source: ValueSource;
  readonly aiProvider?: string;
}

export interface PendingKey {
  readonly keyId: string;
  readonly locale: LocaleCode;
}

export interface EditorState {
  readonly project: LocalizationProject | null;
  readonly fsMode: FsMode;
  readonly directoryHandle: FileSystemDirectoryHandle | null;
  readonly directoryName: string | null;
  readonly fileHandles: ReadonlyMap<string, FileSystemFileHandle>;
  readonly dirty: ReadonlySet<string>;
  readonly skipped: readonly SkippedFile[];
  readonly lastSavedAt: number | null;
  readonly banner: EditorBanner | null;
  /** keyId+':'+locale → 'pending' or {error} while AI translation is in flight or has failed. */
  readonly pendingTranslations: ReadonlyMap<string, PendingTranslation>;
}

export const initialEditorState: EditorState = {
  project: null,
  fsMode: 'none',
  directoryHandle: null,
  directoryName: null,
  fileHandles: new Map(),
  dirty: new Set(),
  skipped: [],
  lastSavedAt: null,
  banner: null,
  pendingTranslations: new Map(),
};

export type EditorAction =
  | {
      readonly type: 'loaded';
      readonly project: LocalizationProject;
      readonly fsMode: FsMode;
      readonly directoryHandle: FileSystemDirectoryHandle | null;
      readonly directoryName: string | null;
      readonly fileHandles: ReadonlyMap<string, FileSystemFileHandle>;
      readonly skipped: readonly SkippedFile[];
    }
  | {
      readonly type: 'setValue';
      readonly keyPath: string;
      readonly locale: LocaleCode;
      readonly ir: readonly ICUNode[];
      readonly raw: string;
      readonly source?: ValueSource;
      readonly aiProvider?: string;
    }
  | { readonly type: 'setValuesBatch'; readonly entries: readonly BatchValueEntry[] }
  | { readonly type: 'translationStart'; readonly entries: readonly PendingKey[] }
  | {
      readonly type: 'translationFail';
      readonly keyId: string;
      readonly locale: LocaleCode;
      readonly message: string;
    }
  | { readonly type: 'translationClear'; readonly entries: readonly PendingKey[] }
  | {
      readonly type: 'addKey';
      readonly path: string;
      readonly baseValue: { readonly ir: readonly ICUNode[]; readonly raw: string };
    }
  | { readonly type: 'removeKey'; readonly keyId: string }
  | { readonly type: 'renameKey'; readonly keyId: string; readonly newPath: string }
  | { readonly type: 'setBaseLocale'; readonly locale: LocaleCode }
  | {
      readonly type: 'setAiProviderPref';
      readonly default?: string;
      readonly perLocale?: { readonly locale: LocaleCode; readonly provider: string };
    }
  | { readonly type: 'markSaved'; readonly at: number }
  | { readonly type: 'banner'; readonly banner: EditorBanner | null }
  | { readonly type: 'reset' };

export function pendingKey(keyId: string, locale: LocaleCode): string {
  return `${keyId}:${locale}`;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'loaded': {
      return {
        ...state,
        project: action.project,
        fsMode: action.fsMode,
        directoryHandle: action.directoryHandle,
        directoryName: action.directoryName,
        fileHandles: action.fileHandles,
        skipped: action.skipped,
        dirty: new Set(),
        lastSavedAt: null,
        pendingTranslations: new Map(),
        banner:
          action.skipped.length > 0
            ? {
                kind: 'info',
                message: `${action.skipped.length} file(s) skipped — see console for details`,
              }
            : null,
      };
    }
    case 'setValue': {
      const project = state.project;
      if (project === null) return state;
      const source = action.source ?? 'manual';
      const updated = updateKeyValue(project, {
        keyPath: action.keyPath,
        locale: action.locale,
        ir: action.ir,
        raw: action.raw,
        source,
        ...(action.aiProvider !== undefined ? { aiProvider: action.aiProvider } : {}),
      });
      if (updated === project) return state;
      const dirty = new Set(state.dirty);
      const key = updated.keys.find((k) => k.path === action.keyPath);
      if (key !== undefined) dirty.add(key.id);
      const pendingTranslations =
        key !== undefined
          ? withoutPending(state.pendingTranslations, [{ keyId: key.id, locale: action.locale }])
          : state.pendingTranslations;
      return { ...state, project: updated, dirty, pendingTranslations };
    }
    case 'setValuesBatch': {
      const project = state.project;
      if (project === null || action.entries.length === 0) return state;
      let working = project;
      const dirty = new Set(state.dirty);
      const cleared: PendingKey[] = [];
      for (const entry of action.entries) {
        const next = updateKeyValue(working, entry);
        if (next === working) continue;
        working = next;
        const key = working.keys.find((k) => k.path === entry.keyPath);
        if (key !== undefined) {
          dirty.add(key.id);
          cleared.push({ keyId: key.id, locale: entry.locale });
        }
      }
      if (working === project) return state;
      return {
        ...state,
        project: working,
        dirty,
        pendingTranslations: withoutPending(state.pendingTranslations, cleared),
      };
    }
    case 'translationStart': {
      if (action.entries.length === 0) return state;
      const next = new Map(state.pendingTranslations);
      for (const entry of action.entries) {
        next.set(pendingKey(entry.keyId, entry.locale), 'pending');
      }
      return { ...state, pendingTranslations: next };
    }
    case 'translationFail': {
      const next = new Map(state.pendingTranslations);
      next.set(pendingKey(action.keyId, action.locale), { error: action.message });
      return { ...state, pendingTranslations: next };
    }
    case 'translationClear': {
      if (action.entries.length === 0) return state;
      return {
        ...state,
        pendingTranslations: withoutPending(state.pendingTranslations, action.entries),
      };
    }
    case 'addKey': {
      const project = state.project;
      if (project === null) return state;
      if (project.keys.some((k) => k.path === action.path)) return state;
      const newValue: TranslationValue = {
        ir: action.baseValue.ir,
        raw: action.baseValue.raw,
        reviewed: true,
        modifiedAt: Date.now(),
        source: 'manual',
      };
      const values = { [project.baseLocale]: newValue };
      const newKey: TranslationKey = {
        id: action.path,
        path: action.path,
        values,
        status: computeStatus(values, project.locales),
      };
      const dirty = new Set(state.dirty);
      dirty.add(newKey.id);
      return {
        ...state,
        project: { ...project, keys: [...project.keys, newKey] },
        dirty,
      };
    }
    case 'removeKey': {
      const project = state.project;
      if (project === null) return state;
      const target = project.keys.find((k) => k.id === action.keyId);
      if (target === undefined) return state;
      const keys = project.keys.filter((k) => k.id !== action.keyId);
      const dirty = new Set(state.dirty);
      dirty.add(action.keyId);
      const pendingTranslations = pruneByKeyId(state.pendingTranslations, action.keyId);
      return {
        ...state,
        project: { ...project, keys },
        dirty,
        pendingTranslations,
      };
    }
    case 'renameKey': {
      const project = state.project;
      if (project === null) return state;
      const target = project.keys.find((k) => k.id === action.keyId);
      if (target === undefined) return state;
      if (action.newPath === target.path) return state;
      if (project.keys.some((k) => k.id !== action.keyId && k.path === action.newPath)) {
        return state;
      }
      const newId = action.newPath;
      const keys = project.keys.map((k) =>
        k.id === action.keyId ? { ...k, id: newId, path: action.newPath } : k,
      );
      const dirty = new Set(state.dirty);
      dirty.delete(action.keyId);
      dirty.add(newId);
      const pendingTranslations = renameKeyIdInPending(
        state.pendingTranslations,
        action.keyId,
        newId,
      );
      return {
        ...state,
        project: { ...project, keys },
        dirty,
        pendingTranslations,
      };
    }
    case 'setBaseLocale': {
      const project = state.project;
      if (project === null) return state;
      if (action.locale === project.baseLocale) return state;
      if (!project.locales.includes(action.locale)) return state;
      return { ...state, project: { ...project, baseLocale: action.locale } };
    }
    case 'setAiProviderPref': {
      const project = state.project;
      if (project === null) return state;
      const current = project.settings.aiProviderPrefs;
      const nextDefault = action.default ?? current?.default;
      const nextPerLocale =
        action.perLocale === undefined
          ? current?.perLocale
          : { ...(current?.perLocale ?? {}), [action.perLocale.locale]: action.perLocale.provider };
      const aiProviderPrefs = pruneEmptyPrefs({
        ...(nextDefault !== undefined ? { default: nextDefault } : {}),
        ...(nextPerLocale !== undefined ? { perLocale: nextPerLocale } : {}),
      });
      const settings =
        aiProviderPrefs === undefined
          ? omitAiPrefs(project.settings)
          : { ...project.settings, aiProviderPrefs };
      // No data-touching change → no dirty marker. Provider preference is
      // a project-file concern that lands on the next save like any other
      // settings change, but it doesn't need to flag a specific key.
      if (sameAiPrefs(settings.aiProviderPrefs, current)) return state;
      return { ...state, project: { ...project, settings } };
    }
    case 'markSaved': {
      return { ...state, dirty: new Set(), lastSavedAt: action.at, banner: null };
    }
    case 'banner': {
      return { ...state, banner: action.banner };
    }
    case 'reset': {
      return initialEditorState;
    }
  }
}

interface UpdateKeyValueInput {
  readonly keyPath: string;
  readonly locale: LocaleCode;
  readonly ir: readonly ICUNode[];
  readonly raw: string;
  readonly source: ValueSource;
  readonly aiProvider?: string;
}

function updateKeyValue(
  project: LocalizationProject,
  input: UpdateKeyValueInput,
): LocalizationProject {
  let changed = false;
  const keys = project.keys.map((k) => {
    if (k.path !== input.keyPath) return k;
    changed = true;
    const newValue: TranslationValue = {
      ir: input.ir,
      raw: input.raw,
      reviewed: true,
      modifiedAt: Date.now(),
      source: input.source,
      ...(input.aiProvider !== undefined ? { aiProvider: input.aiProvider } : {}),
    };
    const values = { ...k.values, [input.locale]: newValue };
    const status = computeStatus(values, project.locales);
    return { ...k, values, status };
  });
  if (!changed) return project;
  return { ...project, keys };
}

function renameKeyIdInPending(
  current: ReadonlyMap<string, PendingTranslation>,
  oldId: string,
  newId: string,
): ReadonlyMap<string, PendingTranslation> {
  if (current.size === 0 || oldId === newId) return current;
  const oldPrefix = `${oldId}:`;
  let mutated = false;
  const next = new Map<string, PendingTranslation>();
  for (const [k, v] of current) {
    if (k.startsWith(oldPrefix)) {
      next.set(`${newId}:${k.slice(oldPrefix.length)}`, v);
      mutated = true;
    } else {
      next.set(k, v);
    }
  }
  return mutated ? next : current;
}

function pruneByKeyId(
  current: ReadonlyMap<string, PendingTranslation>,
  keyId: string,
): ReadonlyMap<string, PendingTranslation> {
  if (current.size === 0) return current;
  const prefix = `${keyId}:`;
  let mutated = false;
  const next = new Map(current);
  for (const k of next.keys()) {
    if (k.startsWith(prefix)) {
      next.delete(k);
      mutated = true;
    }
  }
  return mutated ? next : current;
}

type AiProviderPrefs = NonNullable<ProjectSettings['aiProviderPrefs']>;

function pruneEmptyPrefs(prefs: AiProviderPrefs): AiProviderPrefs | undefined {
  const hasDefault = prefs.default !== undefined;
  const hasPerLocale = prefs.perLocale !== undefined && Object.keys(prefs.perLocale).length > 0;
  if (!hasDefault && !hasPerLocale) return undefined;
  return prefs;
}

function omitAiPrefs(settings: ProjectSettings): ProjectSettings {
  if (settings.aiProviderPrefs === undefined) return settings;
  const { aiProviderPrefs: _omit, ...rest } = settings;
  return rest;
}

function sameAiPrefs(a: AiProviderPrefs | undefined, b: AiProviderPrefs | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.default !== b.default) return false;
  const ak = a.perLocale === undefined ? [] : Object.keys(a.perLocale).sort();
  const bk = b.perLocale === undefined ? [] : Object.keys(b.perLocale).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    const key = ak[i]!;
    if ((a.perLocale ?? {})[key] !== (b.perLocale ?? {})[key]) return false;
  }
  return true;
}

function withoutPending(
  current: ReadonlyMap<string, PendingTranslation>,
  entries: readonly PendingKey[],
): ReadonlyMap<string, PendingTranslation> {
  if (entries.length === 0 || current.size === 0) return current;
  let mutated = false;
  const next = new Map(current);
  for (const entry of entries) {
    if (next.delete(pendingKey(entry.keyId, entry.locale))) mutated = true;
  }
  return mutated ? next : current;
}

function computeStatus(
  values: Readonly<Record<LocaleCode, TranslationValue | undefined>>,
  locales: readonly LocaleCode[],
): KeyStatus {
  for (const locale of locales) {
    if (values[locale] === undefined) return 'missing-translation';
  }
  return 'ok';
}
