/**
 * Compose multiple parsed files into a single LocalizationProject.
 *
 * Format-agnostic by construction: parsers produce `ParsedFile`s; this
 * helper unions their keys, merges per-locale values, and computes
 * cross-locale `KeyStatus`. Used by tests today and by the app shell once
 * UI lands.
 */

import type {
  KeyStatus,
  LocaleCode,
  LocalizationProject,
  Placeholder,
  ProjectId,
  ProjectSettings,
  SourceFile,
  SupportedFormat,
  TranslationKey,
  TranslationValue,
} from './types.js';

export interface ParsedFile {
  readonly locale: LocaleCode;
  readonly format: SupportedFormat;
  readonly path: string;
  readonly keys: readonly TranslationKey[];
  readonly formatMetadata?: Readonly<Record<string, unknown>>;
}

export interface ComposeProjectInput {
  readonly id: ProjectId;
  readonly name: string;
  readonly baseLocale: LocaleCode;
  readonly settings?: ProjectSettings;
  readonly sources: readonly ParsedFile[];
}

export function composeProject(input: ComposeProjectInput): LocalizationProject {
  const locales = uniqueSorted(input.sources.map((s) => s.locale));

  const byPath = new Map<string, MergedKey>();
  for (const source of input.sources) {
    for (const key of source.keys) {
      const existing = byPath.get(key.path);
      const incomingValue = key.values[source.locale];
      if (existing === undefined) {
        byPath.set(key.path, {
          id: key.id,
          path: key.path,
          values: incomingValue ? { [source.locale]: incomingValue } : {},
          description: key.description,
          placeholders: key.placeholders,
        });
      } else {
        if (incomingValue !== undefined) existing.values[source.locale] = incomingValue;
        if (existing.description === undefined && key.description !== undefined) {
          existing.description = key.description;
        }
        if (existing.placeholders === undefined && key.placeholders !== undefined) {
          existing.placeholders = key.placeholders;
        }
      }
    }
  }

  const keys: TranslationKey[] = Array.from(byPath.values())
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((merged) => buildKey(merged, locales));

  const files: SourceFile[] = input.sources.map((s) => ({
    locale: s.locale,
    format: s.format,
    path: s.path,
    ...(s.formatMetadata !== undefined ? { formatMetadata: s.formatMetadata } : {}),
  }));

  return {
    id: input.id,
    name: input.name,
    locales,
    baseLocale: input.baseLocale,
    keys,
    files,
    settings: input.settings ?? {},
  };
}

interface MergedKey {
  id: string;
  path: string;
  values: Record<LocaleCode, TranslationValue>;
  description: string | undefined;
  placeholders: readonly Placeholder[] | undefined;
}

function buildKey(merged: MergedKey, locales: readonly LocaleCode[]): TranslationKey {
  const status = computeStatus(merged.values, locales);
  return {
    id: merged.id,
    path: merged.path,
    values: merged.values,
    status,
    ...(merged.description !== undefined ? { description: merged.description } : {}),
    ...(merged.placeholders !== undefined ? { placeholders: merged.placeholders } : {}),
  };
}

function computeStatus(
  values: Readonly<Record<LocaleCode, TranslationValue>>,
  locales: readonly LocaleCode[],
): KeyStatus {
  for (const locale of locales) {
    if (values[locale] === undefined) return 'missing-translation';
  }
  return 'ok';
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values)).sort();
}
