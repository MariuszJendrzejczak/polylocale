/**
 * Nested JSON exporter.
 *
 * Renders one locale of a {@link LocalizationProject} as a tree of
 * objects with string leaves — the i18next / react-intl / Vue I18n
 * default shape. Determinism: object keys are sorted alphabetically at
 * **every** depth; output is `JSON.stringify(_, null, 2) + '\n'`.
 *
 * Per-leaf rendering uses the same `raw` shortcut as flat JSON: when
 * the imported `raw` still encodes the current `ir` (verified via
 * {@link parseICU} + {@link icuEqual}), we emit `raw` byte-for-byte.
 * When the IR has been edited (UI / AI translation) the shortcut
 * misses and we fall back to {@link renderICU}.
 *
 * Throws on prefix collision: if the model carries both a leaf path
 * and a path that descends through it (e.g. `home` and `home.title`),
 * nested JSON cannot represent both — silently dropping either would
 * violate the no-silent-data-loss rule.
 */

import { icuEqual } from '../icu/equal.js';
import { parseICU } from '../icu/parse.js';
import { renderICU } from '../icu/render.js';
import type { LocaleCode, LocalizationProject, TranslationValue } from '../model/types.js';

type NestedNode = string | { [segment: string]: NestedNode };

export function exportNestedJson(project: LocalizationProject, locale: LocaleCode): string {
  const root: { [segment: string]: NestedNode } = {};
  const entries = project.keys
    .filter((key) => key.values[locale] !== undefined)
    .map((key) => [key.path, render(key.values[locale]!)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const [path, leaf] of entries) {
    nestKey(root, path, leaf);
  }

  return `${JSON.stringify(sortDeep(root), null, 2)}\n`;
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

function nestKey(root: { [segment: string]: NestedNode }, path: string, leaf: string): void {
  const segments = path.split('.');
  let cursor: { [segment: string]: NestedNode } = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = cursor[segment];
    if (existing === undefined) {
      const branch: { [segment: string]: NestedNode } = {};
      cursor[segment] = branch;
      cursor = branch;
      continue;
    }
    if (typeof existing === 'string') {
      const leafPath = segments.slice(0, i + 1).join('.');
      throw new Error(
        `exportNestedJson: path "${leafPath}" is a leaf and also a parent of "${path}" — cannot represent both in nested JSON`,
      );
    }
    cursor = existing;
  }
  const last = segments[segments.length - 1]!;
  const conflicting = cursor[last];
  if (conflicting !== undefined) {
    if (typeof conflicting === 'string') {
      throw new Error(
        `exportNestedJson: duplicate path "${path}" cannot appear twice in nested JSON`,
      );
    }
    throw new Error(
      `exportNestedJson: path "${path}" is a leaf and also a parent of nested keys — cannot represent both in nested JSON`,
    );
  }
  cursor[last] = leaf;
}

function sortDeep(node: { [segment: string]: NestedNode }): { [segment: string]: NestedNode } {
  const out: { [segment: string]: NestedNode } = {};
  for (const segment of Object.keys(node).sort()) {
    const value = node[segment]!;
    out[segment] = typeof value === 'string' ? value : sortDeep(value);
  }
  return out;
}
