/**
 * ARB (Application Resource Bundle) exporter.
 *
 * Renders one locale of a {@link LocalizationProject} as ARB JSON.
 *
 * Output ordering (deterministic):
 *  1. `@@`-prefixed file-level keys, in the order captured by the parser
 *     (`formatMetadata.fileMetaOrder`). When `@@locale` is absent from the
 *     source we synthesize it as the first key from the `locale` argument.
 *     When no `formatMetadata` exists at all, only `@@locale` is emitted.
 *  2. Translation keys sorted alphabetically by path. Each `foo` is
 *     immediately followed by its `@foo` metadata block when the model
 *     carries any of `description`, `placeholders`, or `keyMetadata`.
 *
 * Per-key metadata is model-wide (see ARCHITECTURE.md §2.2), so a target
 * locale that imported with no `@key` blocks will gain them on export
 * whenever the merged model knows about them. That asymmetry is deliberate:
 * "no silent data loss" outranks byte-identity for files that were
 * metadata-poorer than their siblings.
 *
 * Per-value rendering uses the same `raw` shortcut as the flat-JSON
 * exporter: when the imported `raw` still encodes the current IR, emit
 * it verbatim; otherwise fall back to {@link renderICU}.
 */

import { icuEqual } from '../icu/equal.js';
import { parseICU } from '../icu/parse.js';
import { renderICU } from '../icu/render.js';
import type {
  LocaleCode,
  LocalizationProject,
  Placeholder,
  SourceFile,
  TranslationKey,
  TranslationValue,
} from '../model/types.js';

export function exportArb(project: LocalizationProject, locale: LocaleCode): string {
  const sourceFile = project.files.find((f) => f.locale === locale && f.format === 'arb');
  const out: Record<string, unknown> = {};

  for (const [name, value] of fileMetaEntries(sourceFile, locale)) {
    out[name] = value;
  }

  const keysWithValue = project.keys
    .filter((k) => k.values[locale] !== undefined)
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const key of keysWithValue) {
    out[key.path] = renderValue(key.values[locale]!);
    const meta = buildKeyMetaBlock(key);
    if (meta !== undefined) out[`@${key.path}`] = meta;
  }

  return `${JSON.stringify(out, null, 2)}\n`;
}

function fileMetaEntries(
  source: SourceFile | undefined,
  locale: LocaleCode,
): Array<[string, unknown]> {
  const meta = source?.formatMetadata as
    | { fileMeta?: Record<string, unknown>; fileMetaOrder?: readonly string[] }
    | undefined;
  const fileMeta = meta?.fileMeta ?? {};
  const order = meta?.fileMetaOrder ?? [];

  const entries: Array<[string, unknown]> = [];
  const seen = new Set<string>();

  if (!('@@locale' in fileMeta)) {
    entries.push(['@@locale', locale]);
    seen.add('@@locale');
  }

  for (const name of order) {
    if (seen.has(name)) continue;
    if (!(name in fileMeta)) continue;
    entries.push([name, fileMeta[name]]);
    seen.add(name);
  }

  // Anything in fileMeta that wasn't in fileMetaOrder (parser shouldn't
  // produce this, but treat defensively): emit alphabetical.
  const trailing = Object.keys(fileMeta)
    .filter((k) => !seen.has(k))
    .sort();
  for (const name of trailing) entries.push([name, fileMeta[name]]);

  return entries;
}

function renderValue(value: TranslationValue): string {
  if (value.raw !== undefined) {
    try {
      if (icuEqual(parseICU(value.raw), value.ir)) return value.raw;
    } catch {
      // raw failed to re-parse — fall through to renderICU
    }
  }
  return renderICU(value.ir);
}

function buildKeyMetaBlock(key: TranslationKey): Record<string, unknown> | undefined {
  const placeholdersBlock = buildPlaceholdersBlock(key.placeholders);
  const hasContent =
    key.description !== undefined ||
    placeholdersBlock !== undefined ||
    (key.keyMetadata !== undefined && Object.keys(key.keyMetadata).length > 0);
  if (!hasContent) return undefined;

  const block: Record<string, unknown> = {};
  if (key.description !== undefined) block.description = key.description;
  if (placeholdersBlock !== undefined) block.placeholders = placeholdersBlock;
  if (key.keyMetadata !== undefined) {
    for (const [field, value] of Object.entries(key.keyMetadata)) {
      block[field] = value;
    }
  }
  return block;
}

function buildPlaceholdersBlock(
  placeholders: readonly Placeholder[] | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (placeholders === undefined || placeholders.length === 0) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const p of placeholders) {
    const def: Record<string, unknown> = {};
    if (p.type !== undefined) def.type = p.type;
    if (p.example !== undefined) def.example = p.example;
    if (p.description !== undefined) def.description = p.description;
    out[p.name] = def;
  }
  return out;
}
