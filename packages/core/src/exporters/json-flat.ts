/**
 * Flat JSON exporter.
 *
 * Renders one locale of a LocalizationProject as a flat JSON object.
 * Determinism: keys sorted alphabetically by path, 2-space indent, LF
 * newlines, trailing newline. Keys without a value for the requested
 * locale are skipped (a missing translation is a missing line, not an
 * empty string).
 *
 * ICU IR support is limited to ICUText nodes in this session; richer
 * nodes throw with a forward-compatibility hint until the ICU exporter
 * lands alongside ARB.
 */

import type { ICUNode } from '../model/icu.js';
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
  if (value.raw !== undefined) return value.raw;
  return renderNode(value.ir);
}

function renderNode(node: ICUNode): string {
  if (node.kind === 'text') return node.value;
  throw new Error(
    `exportFlatJson: ICU node kind "${node.kind}" is not yet supported (ICU rendering lands with the ARB exporter).`,
  );
}
