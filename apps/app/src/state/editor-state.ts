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
  TranslationValue,
} from '@polylocale/core';

import type { SkippedFile } from '../services/file-system.js';

export type FsMode = 'fs-access' | 'fallback' | 'none';

export interface EditorBanner {
  readonly kind: 'error' | 'info';
  readonly message: string;
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
    }
  | { readonly type: 'markSaved'; readonly at: number }
  | { readonly type: 'banner'; readonly banner: EditorBanner | null }
  | { readonly type: 'reset' };

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
      const updated = updateKeyValue(project, action.keyPath, action.locale, action.ir, action.raw);
      if (updated === project) return state;
      const dirty = new Set(state.dirty);
      const key = updated.keys.find((k) => k.path === action.keyPath);
      if (key !== undefined) dirty.add(key.id);
      return { ...state, project: updated, dirty };
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

function updateKeyValue(
  project: LocalizationProject,
  keyPath: string,
  locale: LocaleCode,
  ir: readonly ICUNode[],
  raw: string,
): LocalizationProject {
  let changed = false;
  const keys = project.keys.map((k) => {
    if (k.path !== keyPath) return k;
    changed = true;
    const newValue: TranslationValue = {
      ir,
      raw,
      reviewed: true,
      modifiedAt: Date.now(),
      source: 'manual',
    };
    const values = { ...k.values, [locale]: newValue };
    const status = computeStatus(values, project.locales);
    return { ...k, values, status };
  });
  if (!changed) return project;
  return { ...project, keys };
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
