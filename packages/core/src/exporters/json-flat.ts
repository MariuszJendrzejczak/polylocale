/**
 * Flat JSON exporter.
 *
 * Renders one locale of a {@link LocalizationProject} as a flat JSON object.
 * Determinism: keys sorted alphabetically by path, 2-space indent, LF
 * newlines, trailing newline. Keys without a value for the requested
 * locale are skipped (a missing translation is a missing line, not an
 * empty string).
 *
 * Per-value rendering uses a `raw` shortcut: when the imported `raw`
 * still encodes the current `ir` (verified via {@link parseICU} +
 * {@link icuEqual}), we emit `raw` byte-for-byte — preserving any
 * formatting quirks the original file had. When the IR has been edited
 * (UI / AI translation) the shortcut misses and we fall back to
 * {@link renderICU}, which produces canonical output.
 */

import { icuEqual } from '../icu/equal.js';
import { parseICU } from '../icu/parse.js';
import { renderICU } from '../icu/render.js';
import type { LocaleCode, LocalizationProject, TranslationValue } from '../model/types.js';

export function exportFlatJson(project: LocalizationProject, locale: LocaleCode): string {
  const entries = project.keys
    .filter((key) => key.values[locale] !== undefined)
    .map((key) => [key.path, render(key.values[locale]!)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const obj: Record<string, string> = {};
  for (const [path, raw] of entries) obj[path] = raw;

  return `${JSON.stringify(obj, null, 2)}\n`;
}

function render(value: TranslationValue): string {
  if (value.raw !== undefined) {
    try {
      if (icuEqual(parseICU(value.raw), value.ir)) return value.raw;
    } catch {
      // raw failed to re-parse — fall through to renderICU
    }
  }
  return renderICU(value.ir);
}
