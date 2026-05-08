/**
 * Flat JSON parser.
 *
 * Reads a single locale file: the top-level JSON object must map
 * key paths (strings) to translated strings. Locale is detected from the
 * filename via `detectLocaleFromFileName`. ICU parsing is intentionally
 * deferred: every value becomes a single ICUText node holding the raw
 * string verbatim, with `TranslationValue.raw` preserved for round-trip.
 *
 * Errors are thrown at the import boundary with precise messages — this
 * is user-input territory, not internal code.
 */

import { detectLocaleFromFileName } from '../locale/detect.js';
import type { ParsedFile } from '../model/compose.js';
import type { LocaleCode, TranslationKey, TranslationValue } from '../model/types.js';

export interface ParseFlatJsonInput {
  readonly fileName: string;
  readonly text: string;
}

export function parseFlatJson(input: ParseFlatJsonInput): ParsedFile {
  const locale = detectLocaleFromFileName(input.fileName);
  if (locale === null) {
    throw new Error(`parseFlatJson: could not detect locale from filename "${input.fileName}"`);
  }

  const stripped = stripBom(input.text);
  const parsed = parseJson(stripped, input.fileName);
  const entries = validateFlatObject(parsed, input.fileName);

  const now = Date.now();
  const keys: TranslationKey[] = entries.map(([path, raw]) => buildKey(path, locale, raw, now));

  return {
    locale,
    format: 'json-flat',
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
    throw new Error(`parseFlatJson: invalid JSON in "${fileName}": ${reason}`);
  }
}

function validateFlatObject(value: unknown, fileName: string): Array<[string, string]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`parseFlatJson: "${fileName}" must contain a top-level JSON object`);
  }
  const entries: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') {
      throw new Error(
        `parseFlatJson: value for key "${key}" in "${fileName}" must be a string (got ${describeType(raw)})`,
      );
    }
    entries.push([key, raw]);
  }
  return entries;
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
): TranslationKey {
  const value: TranslationValue = {
    ir: { kind: 'text', value: raw },
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
