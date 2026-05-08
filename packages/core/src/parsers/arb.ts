/**
 * ARB (Application Resource Bundle) parser.
 *
 * ARB is a JSON-based localization format used by Flutter. The top-level
 * object interleaves three kinds of entries:
 *
 *  - `@@`-prefixed file-level metadata (`@@locale`, `@@last_modified`,
 *    vendor extensions like `@@x-author`). Captured into
 *    `formatMetadata.fileMeta`; their input order is captured into
 *    `formatMetadata.fileMetaOrder` so the exporter can replay it.
 *  - `@`-prefixed (single `@`) per-key metadata blocks. The block sibling
 *    of translation key `foo` is `@foo`. We recognise `description` and
 *    `placeholders`; everything else is preserved verbatim under
 *    {@link TranslationKey.keyMetadata}.
 *  - Translation keys mapping to ICU message strings.
 *
 * Locale resolution prefers `@@locale` (normalized) then falls back to
 * {@link detectLocaleFromFileName}. If neither resolves, parsing throws.
 *
 * Errors are thrown at the import boundary with precise messages — this
 * is user-input territory, not internal code.
 */

import { parseICU } from '../icu/parse.js';
import { detectLocaleFromFileName } from '../locale/detect.js';
import { normalizeLocale } from '../locale/normalize.js';
import type { ParsedFile } from '../model/compose.js';
import type {
  LocaleCode,
  Placeholder,
  TranslationKey,
  TranslationValue,
} from '../model/types.js';

export interface ParseArbInput {
  readonly fileName: string;
  readonly text: string;
}

export function parseArb(input: ParseArbInput): ParsedFile {
  const stripped = stripBom(input.text);
  const parsed = parseJson(stripped, input.fileName);
  const top = validateTopLevelObject(parsed, input.fileName);

  const split = splitEntries(top);
  const locale = resolveLocale(split.fileMeta, input.fileName);

  const now = Date.now();
  const keys: TranslationKey[] = split.translationEntries.map(([path, raw]) =>
    buildKey(path, locale, raw, split.keyMeta[path], now, input.fileName),
  );

  const formatMetadata =
    split.fileMetaOrder.length > 0
      ? { fileMeta: split.fileMeta, fileMetaOrder: split.fileMetaOrder }
      : undefined;

  return {
    locale,
    format: 'arb',
    path: input.fileName,
    keys,
    ...(formatMetadata !== undefined ? { formatMetadata } : {}),
  };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseJson(text: string, fileName: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`parseArb: invalid JSON in "${fileName}": ${reason}`);
  }
}

function validateTopLevelObject(value: unknown, fileName: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`parseArb: "${fileName}" must contain a top-level JSON object`);
  }
  return value as Record<string, unknown>;
}

interface SplitEntries {
  readonly fileMeta: Record<string, unknown>;
  readonly fileMetaOrder: string[];
  readonly keyMeta: Record<string, Record<string, unknown>>;
  readonly translationEntries: Array<[string, string]>;
}

function splitEntries(top: Record<string, unknown>): SplitEntries {
  const fileMeta: Record<string, unknown> = {};
  const fileMetaOrder: string[] = [];
  const keyMeta: Record<string, Record<string, unknown>> = {};
  const translationEntries: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(top)) {
    if (key.startsWith('@@')) {
      fileMeta[key] = value;
      fileMetaOrder.push(key);
    } else if (key.startsWith('@')) {
      const path = key.slice(1);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(
          `parseArb: metadata block "${key}" must be a JSON object (got ${describeType(value)})`,
        );
      }
      keyMeta[path] = value as Record<string, unknown>;
    } else {
      if (typeof value !== 'string') {
        throw new Error(
          `parseArb: value for key "${key}" must be a string (got ${describeType(value)})`,
        );
      }
      translationEntries.push([key, value]);
    }
  }

  return { fileMeta, fileMetaOrder, keyMeta, translationEntries };
}

function resolveLocale(
  fileMeta: Record<string, unknown>,
  fileName: string,
): LocaleCode {
  const fromAtAt = fileMeta['@@locale'];
  if (typeof fromAtAt === 'string') {
    const normalized = normalizeLocale(fromAtAt);
    if (normalized !== null) return normalized;
    throw new Error(
      `parseArb: "@@locale" value "${fromAtAt}" in "${fileName}" is not a recognisable locale`,
    );
  }
  const fromName = detectLocaleFromFileName(fileName);
  if (fromName !== null) return fromName;
  throw new Error(
    `parseArb: could not resolve locale for "${fileName}" — set "@@locale" or use a locale-bearing filename`,
  );
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function buildKey(
  path: string,
  locale: LocaleCode,
  raw: string,
  meta: Record<string, unknown> | undefined,
  modifiedAt: number,
  fileName: string,
): TranslationKey {
  let ir;
  try {
    ir = parseICU(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `parseArb: value for key "${path}" in "${fileName}" is not valid ICU MessageFormat: ${reason}`,
    );
  }
  const value: TranslationValue = {
    ir,
    raw,
    reviewed: false,
    modifiedAt,
    source: 'imported',
  };

  const extracted = extractKeyMeta(meta, path, fileName);

  return {
    id: path,
    path,
    values: { [locale]: value },
    status: 'ok',
    ...(extracted.description !== undefined ? { description: extracted.description } : {}),
    ...(extracted.placeholders !== undefined ? { placeholders: extracted.placeholders } : {}),
    ...(extracted.keyMetadata !== undefined ? { keyMetadata: extracted.keyMetadata } : {}),
  };
}

interface ExtractedKeyMeta {
  readonly description: string | undefined;
  readonly placeholders: readonly Placeholder[] | undefined;
  readonly keyMetadata: Readonly<Record<string, unknown>> | undefined;
}

function extractKeyMeta(
  meta: Record<string, unknown> | undefined,
  path: string,
  fileName: string,
): ExtractedKeyMeta {
  if (meta === undefined) {
    return { description: undefined, placeholders: undefined, keyMetadata: undefined };
  }

  let description: string | undefined;
  let placeholders: readonly Placeholder[] | undefined;
  const extras: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(meta)) {
    if (field === 'description') {
      if (typeof value !== 'string') {
        throw new Error(
          `parseArb: "@${path}.description" in "${fileName}" must be a string (got ${describeType(value)})`,
        );
      }
      description = value;
    } else if (field === 'placeholders') {
      placeholders = parsePlaceholders(value, path, fileName);
    } else {
      extras[field] = value;
    }
  }

  const keyMetadata = Object.keys(extras).length > 0 ? extras : undefined;
  return { description, placeholders, keyMetadata };
}

function parsePlaceholders(
  value: unknown,
  path: string,
  fileName: string,
): readonly Placeholder[] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `parseArb: "@${path}.placeholders" in "${fileName}" must be a JSON object (got ${describeType(value)})`,
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;

  return entries.map(([name, def]) => buildPlaceholder(name, def, path, fileName));
}

function buildPlaceholder(
  name: string,
  def: unknown,
  path: string,
  fileName: string,
): Placeholder {
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    throw new Error(
      `parseArb: placeholder "${name}" in "@${path}" of "${fileName}" must be a JSON object (got ${describeType(def)})`,
    );
  }
  const obj = def as Record<string, unknown>;
  return {
    name,
    ...(typeof obj.type === 'string' ? { type: obj.type } : {}),
    ...(typeof obj.example === 'string' ? { example: obj.example } : {}),
    ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
  };
}
