/**
 * Internal data model for polylocale.
 *
 * This is the format-agnostic, single source of truth that lives between
 * parsers (file → model) and exporters (model → file). UI and AI providers
 * operate on this model, never on raw file contents.
 *
 * Quality bar:
 *  - Round-trip lossless (parse → export → parse must match).
 *  - ICU/placeholder preservation is non-negotiable.
 *  - No silent data loss on import or export — surface unknowns explicitly.
 */

import type { ICUNode } from './icu.js';

/** BCP-47 language tag, e.g. 'en', 'pl-PL', 'zh-Hant'. */
export type LocaleCode = string;

export type ProjectId = string;
export type KeyId = string;

export type SupportedFormat = 'arb' | 'json-flat' | 'json-nested';

export interface LocalizationProject {
  readonly id: ProjectId;
  readonly name: string;
  readonly locales: readonly LocaleCode[];
  readonly baseLocale: LocaleCode;
  readonly keys: readonly TranslationKey[];
  readonly files: readonly SourceFile[];
  readonly glossary?: readonly GlossaryEntry[];
  readonly settings: ProjectSettings;
}

export interface SourceFile {
  readonly locale: LocaleCode;
  readonly format: SupportedFormat;
  /** Path relative to the project root the user opened. */
  readonly path: string;
  /**
   * Format-specific bag preserved verbatim for round-trip
   * (e.g. ARB `@@locale`, `@@last_modified`, file-level comments).
   * Parsers stash here whatever they read but do not interpret.
   */
  readonly formatMetadata?: Readonly<Record<string, unknown>>;
}

export interface TranslationKey {
  readonly id: KeyId;
  /**
   * Logical key path. Flat for ARB/json-flat (`homeTitle`),
   * dot-segmented for nested JSON (`home.title`).
   */
  readonly path: string;
  readonly values: Readonly<Record<LocaleCode, TranslationValue | undefined>>;
  /** ARB `@key.description` or equivalent, when available. */
  readonly description?: string;
  readonly placeholders?: readonly Placeholder[];
  readonly status: KeyStatus;
}

export interface TranslationValue {
  /**
   * Structural ICU IR — source of truth for exporters and AI translation.
   * A message parses to a sequence of top-level elements (e.g. `"Hello {n}"`
   * → `[Text, Placeholder]`), so the field is an array even when there's
   * just one node.
   */
  readonly ir: readonly ICUNode[];
  /** Original raw string from import; kept verbatim for round-trip optimization. */
  readonly raw?: string;
  readonly reviewed: boolean;
  /** ms since epoch. */
  readonly modifiedAt: number;
  readonly source?: 'manual' | 'ai' | 'imported';
  /** Provider id when source = 'ai' (e.g. 'deepl', 'openai'). */
  readonly aiProvider?: string;
}

export interface Placeholder {
  readonly name: string;
  /**
   * Type from ARB or inferred from ICU `{name, type, format}`.
   * Common: 'String', 'int', 'double', 'num', 'DateTime'.
   */
  readonly type?: string;
  readonly example?: string;
  readonly description?: string;
}

export type KeyStatus =
  | 'ok'
  | 'needs-review'
  | 'missing-translation'
  | 'placeholder-mismatch'
  | 'empty';

export interface GlossaryEntry {
  readonly term: string;
  readonly perLocale: Readonly<
    Record<LocaleCode, { readonly translation?: string; readonly doNotTranslate?: boolean }>
  >;
  readonly notes?: string;
}

export interface ProjectSettings {
  readonly aiProviderPrefs?: {
    readonly default?: string;
    readonly perLocale?: Readonly<Record<LocaleCode, string>>;
  };
  /**
   * NOTE: API keys live in a separate, passphrase-encrypted store
   * (WebCrypto AES-GCM in IndexedDB). They are intentionally NOT here.
   */
}
