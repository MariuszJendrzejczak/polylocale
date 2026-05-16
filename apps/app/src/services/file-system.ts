/**
 * File System Access API plumbing for the editor.
 *
 * Two entry points:
 *   - `openDirectory()` — Chromium-grade picker; returns the directory
 *     handle and the parsed locale files inside it.
 *   - `loadFromInputFiles()` — fallback for browsers without
 *     `showDirectoryPicker` (Firefox / Safari today). Files come from a
 *     `<input type="file" multiple>` and there's no directory handle to
 *     persist; saving falls back to per-file downloads.
 *
 * `.json` files are tried as nested first, then flat — `parseNestedJson`
 * is the stricter shape (rejects literal-dot keys, requires string leaves)
 * so a successful nested parse means the file really was nested. Files we
 * can't make sense of are surfaced as `SkippedFile` warnings, not silently
 * dropped.
 */

import {
  composeProject,
  exportArb,
  exportFlatJson,
  exportNestedJson,
  parseArb,
  parseFlatJson,
  parseNestedJson,
} from '@polylocale/core';
import type {
  GlossaryEntry,
  LocaleCode,
  LocalizationProject,
  ParsedFile,
  ProjectSettings,
  SourceFile,
} from '@polylocale/core';

export interface LoadedFile {
  readonly parsed: ParsedFile;
  readonly fileName: string;
  readonly fileHandle?: FileSystemFileHandle;
}

export interface SkippedFile {
  readonly fileName: string;
  readonly reason: string;
}

export interface ReadResult {
  readonly loaded: readonly LoadedFile[];
  readonly skipped: readonly SkippedFile[];
}

export interface OpenDirectoryResult extends ReadResult {
  readonly directoryHandle: FileSystemDirectoryHandle;
  readonly directoryName: string;
}

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function openDirectory(): Promise<OpenDirectoryResult | null> {
  if (!isDirectoryPickerSupported()) return null;
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const { loaded, skipped } = await readDirectory(handle);
  return { directoryHandle: handle, directoryName: handle.name, loaded, skipped };
}

export async function readDirectory(handle: FileSystemDirectoryHandle): Promise<ReadResult> {
  const loaded: LoadedFile[] = [];
  const skipped: SkippedFile[] = [];
  for await (const child of handle.values()) {
    if (child.kind !== 'file') continue;
    if (!isLocaleFile(child.name)) continue;
    const fileHandle = child as FileSystemFileHandle;
    try {
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = parseFileByName(child.name, text);
      loaded.push({ parsed, fileName: child.name, fileHandle });
    } catch (err) {
      skipped.push({ fileName: child.name, reason: errorMessage(err) });
    }
  }
  return { loaded, skipped };
}

export async function loadFromInputFiles(files: FileList | readonly File[]): Promise<ReadResult> {
  const loaded: LoadedFile[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of Array.from(files)) {
    if (!isLocaleFile(file.name)) {
      skipped.push({ fileName: file.name, reason: 'unsupported extension' });
      continue;
    }
    try {
      const text = await file.text();
      const parsed = parseFileByName(file.name, text);
      loaded.push({ parsed, fileName: file.name });
    } catch (err) {
      skipped.push({ fileName: file.name, reason: errorMessage(err) });
    }
  }
  return { loaded, skipped };
}

export interface ComposeFromLoadedInput {
  readonly loaded: readonly LoadedFile[];
  readonly projectName: string;
  readonly baseLocale?: LocaleCode;
  readonly settings?: ProjectSettings;
  readonly glossary?: readonly GlossaryEntry[];
}

export function composeFromLoaded(input: ComposeFromLoadedInput): LocalizationProject {
  const sources: ParsedFile[] = input.loaded.map((l) => l.parsed);
  if (sources.length === 0) {
    throw new Error('composeFromLoaded: no parsed files supplied');
  }
  const baseLocale = input.baseLocale ?? sources[0]!.locale;
  const project = composeProject({
    id: crypto.randomUUID(),
    name: input.projectName,
    baseLocale,
    sources,
    ...(input.settings !== undefined ? { settings: input.settings } : {}),
  });
  if (input.glossary !== undefined && input.glossary.length > 0) {
    return { ...project, glossary: input.glossary };
  }
  return project;
}

export interface SaveToDirectoryInput {
  readonly project: LocalizationProject;
  readonly handlesByPath: ReadonlyMap<string, FileSystemFileHandle>;
}

export interface SaveResult {
  readonly written: readonly string[];
  readonly errors: ReadonlyArray<{ readonly path: string; readonly reason: string }>;
}

export async function saveToDirectory(input: SaveToDirectoryInput): Promise<SaveResult> {
  const written: string[] = [];
  const errors: Array<{ path: string; reason: string }> = [];
  for (const sourceFile of input.project.files) {
    const fileHandle = input.handlesByPath.get(sourceFile.path);
    if (fileHandle === undefined) {
      errors.push({ path: sourceFile.path, reason: 'no file handle (open the folder again?)' });
      continue;
    }
    try {
      const text = exportFor(sourceFile, input.project);
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      written.push(sourceFile.path);
    } catch (err) {
      errors.push({ path: sourceFile.path, reason: errorMessage(err) });
    }
  }
  return { written, errors };
}

export function downloadFiles(project: LocalizationProject): void {
  for (const sourceFile of project.files) {
    const text = exportFor(sourceFile, project);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sourceFile.path.split(/[\\/]/).pop() ?? sourceFile.path;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

function parseFileByName(fileName: string, text: string): ParsedFile {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'arb') return parseArb({ fileName, text });
  if (ext === 'json') {
    try {
      return parseNestedJson({ fileName, text });
    } catch {
      return parseFlatJson({ fileName, text });
    }
  }
  throw new Error(`unsupported file extension: "${fileName}"`);
}

function isLocaleFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.arb') || lower.endsWith('.json');
}

function exportFor(sourceFile: SourceFile, project: LocalizationProject): string {
  switch (sourceFile.format) {
    case 'arb':
      return exportArb(project, sourceFile.locale);
    case 'json-flat':
      return exportFlatJson(project, sourceFile.locale);
    case 'json-nested':
      return exportNestedJson(project, sourceFile.locale);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
