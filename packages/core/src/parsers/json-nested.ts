/**
 * Nested JSON parser.
 *
 * Reads a single locale file whose top-level JSON object is a tree of
 * objects with string leaves (the i18next / react-intl / Vue I18n shape).
 * The tree is flattened to dot-segmented {@link TranslationKey.path}s
 * while every leaf goes through {@link parseICU} for ICU MessageFormat
 * structure. Locale comes from the filename via
 * {@link detectLocaleFromFileName}; we keep the original `raw` so the
 * exporter can byte-exact round-trip values that haven't been edited
 * since import.
 *
 * Rejection rules at the import boundary (this is user-input territory):
 *  - any object key segment containing `.` — ambiguous with the model's
 *    path separator; nested JSON cannot represent a literal dot in a key.
 *  - any leaf that isn't a string (number, boolean, null) — not v1.
 *  - any array value at any depth — not v1.
 */

import { parseICU } from '../icu/parse.js';
import { detectLocaleFromFileName } from '../locale/detect.js';
import type { ParsedFile } from '../model/compose.js';
import type { LocaleCode, TranslationKey, TranslationValue } from '../model/types.js';

export interface ParseNestedJsonInput {
  readonly fileName: string;
  readonly text: string;
}

export function parseNestedJson(input: ParseNestedJsonInput): ParsedFile {
  const locale = detectLocaleFromFileName(input.fileName);
  if (locale === null) {
    throw new Error(`parseNestedJson: could not detect locale from filename "${input.fileName}"`);
  }

  const stripped = stripBom(input.text);
  const parsed = parseJson(stripped, input.fileName);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`parseNestedJson: "${input.fileName}" must contain a top-level JSON object`);
  }

  const entries: Array<[string, string]> = [];
  flatten(parsed as Record<string, unknown>, [], entries, input.fileName);

  const now = Date.now();
  const keys: TranslationKey[] = entries.map(([path, raw]) =>
    buildKey(path, locale, raw, now, input.fileName),
  );

  return {
    locale,
    format: 'json-nested',
    path: input.fileName,
    keys,
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
    throw new Error(`parseNestedJson: invalid JSON in "${fileName}": ${reason}`);
  }
}

function flatten(
  obj: Record<string, unknown>,
  stack: readonly string[],
  out: Array<[string, string]>,
  fileName: string,
): void {
  for (const [segment, value] of Object.entries(obj)) {
    if (segment.includes('.')) {
      const where = stack.length > 0 ? `${stack.join('.')}.${segment}` : segment;
      throw new Error(
        `parseNestedJson: key segment "${segment}" at "${where}" in "${fileName}" cannot contain a literal '.'`,
      );
    }
    const nextStack = [...stack, segment];
    const path = nextStack.join('.');
    if (typeof value === 'string') {
      out.push([path, value]);
      continue;
    }
    if (Array.isArray(value)) {
      throw new Error(`parseNestedJson: value at "${path}" in "${fileName}" must not be an array`);
    }
    if (value !== null && typeof value === 'object') {
      flatten(value as Record<string, unknown>, nextStack, out, fileName);
      continue;
    }
    throw new Error(
      `parseNestedJson: value at "${path}" in "${fileName}" must be a string or object (got ${describeType(value)})`,
    );
  }
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
  modifiedAt: number,
  fileName: string,
): TranslationKey {
  let ir;
  try {
    ir = parseICU(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `parseNestedJson: value at "${path}" in "${fileName}" is not valid ICU MessageFormat: ${reason}`,
    );
  }
  const value: TranslationValue = {
    ir,
    raw,
    reviewed: false,
    modifiedAt,
    source: 'imported',
  };
  return {
    id: path,
    path,
    values: { [locale]: value },
    status: 'ok',
  };
}
