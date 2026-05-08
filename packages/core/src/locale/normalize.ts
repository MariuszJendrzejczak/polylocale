/**
 * BCP-47 locale normalization.
 *
 * The model holds locales in one canonical form: hyphen-separated,
 * lowercase language subtag, title-case script subtag, uppercase region
 * subtag. UN M.49 numeric regions (e.g. `419`) are kept verbatim.
 *
 * Supported shapes: `lang`, `lang-region`, `lang-script`, `lang-script-region`.
 * Underscores are accepted as separators (Flutter / Java convention) and
 * normalized to hyphens. See ARCHITECTURE.md §3.9.
 */

import type { LocaleCode } from '../model/types.js';

const LOCALE_RE = /^([A-Za-z]{2,3})(?:[_-]([A-Za-z]{4}))?(?:[_-]([A-Za-z]{2}|\d{3}))?$/;

export function normalizeLocale(raw: string): LocaleCode | null {
  const match = LOCALE_RE.exec(raw.trim());
  if (!match) return null;

  const lang = match[1]!.toLowerCase();
  const script = match[2];
  const region = match[3];

  let result = lang;
  if (script !== undefined) result += `-${titleCase(script)}`;
  if (region !== undefined) result += `-${/^\d/.test(region) ? region : region.toUpperCase()}`;
  return result;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
