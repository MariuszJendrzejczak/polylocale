/**
 * Locale detection from a filename.
 *
 * The basename minus its extension is run through `normalizeLocale`. This
 * handles the common Flutter / web cases (`en.json`, `pl-PL.json`,
 * `pl_PL.json`). Format-specific naming patterns (`intl_pl.arb`) land with
 * their respective parsers.
 */

import type { LocaleCode } from '../model/types.js';
import { normalizeLocale } from './normalize.js';

export function detectLocaleFromFileName(fileName: string): LocaleCode | null {
  const basename = fileName.replace(/^.*[\\/]/, '');
  const stem = basename.replace(/\.[^.]+$/, '');
  return normalizeLocale(stem);
}
