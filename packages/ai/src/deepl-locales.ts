/**
 * BCP-47 ↔ DeepL locale code mapping.
 *
 * DeepL uses uppercase ISO-639-1 (and a handful of region-/script-qualified
 * targets). Sources never carry a region; targets distinguish e.g. EN-US
 * from EN-GB and PT-BR from PT-PT. The mapping below covers the lists from
 * https://developers.deepl.com/docs/resources/supported-languages.
 *
 * Generic fallbacks: `pt` and `en` are accepted as targets (DeepL keeps
 * them as aliases) but mapped to a regional default (PT-PT, EN-US) so the
 * request lands on a supported value even when callers omit the region.
 * Override by passing the regional locale explicitly (`en-GB`, `pt-BR`).
 */

import type { LocaleCode } from '@polylocale/core';
import { UnsupportedLocaleError } from './provider.js';

const SOURCE_LANGS: ReadonlySet<string> = new Set([
  'AR',
  'BG',
  'CS',
  'DA',
  'DE',
  'EL',
  'EN',
  'ES',
  'ET',
  'FI',
  'FR',
  'HU',
  'ID',
  'IT',
  'JA',
  'KO',
  'LT',
  'LV',
  'NB',
  'NL',
  'PL',
  'PT',
  'RO',
  'RU',
  'SK',
  'SL',
  'SV',
  'TR',
  'UK',
  'ZH',
]);

const TARGET_LANGS: ReadonlySet<string> = new Set([
  'AR',
  'BG',
  'CS',
  'DA',
  'DE',
  'EL',
  'EN-GB',
  'EN-US',
  'ES',
  'ES-419',
  'ET',
  'FI',
  'FR',
  'HU',
  'ID',
  'IT',
  'JA',
  'KO',
  'LT',
  'LV',
  'NB',
  'NL',
  'PL',
  'PT-BR',
  'PT-PT',
  'RO',
  'RU',
  'SK',
  'SL',
  'SV',
  'TR',
  'UK',
  'ZH',
  'ZH-HANS',
  'ZH-HANT',
]);

const TARGET_DEFAULTS: Readonly<Record<string, string>> = {
  EN: 'EN-US',
  PT: 'PT-PT',
};

export function bcp47ToDeepLSource(locale: LocaleCode): string {
  const language = primaryLanguage(locale);
  if (SOURCE_LANGS.has(language)) return language;
  throw new UnsupportedLocaleError('deepl', locale, 'source');
}

export function bcp47ToDeepLTarget(locale: LocaleCode): string {
  const language = primaryLanguage(locale);
  const region = regionSubtag(locale);
  const script = scriptSubtag(locale);

  const candidates: string[] = [];
  if (region !== undefined) candidates.push(`${language}-${region}`);
  if (script !== undefined) candidates.push(`${language}-${script}`);
  candidates.push(language);

  for (const candidate of candidates) {
    if (TARGET_LANGS.has(candidate)) return candidate;
  }
  const fallback = TARGET_DEFAULTS[language];
  if (fallback !== undefined && TARGET_LANGS.has(fallback)) return fallback;

  throw new UnsupportedLocaleError('deepl', locale, 'target');
}

function primaryLanguage(locale: LocaleCode): string {
  const segments = locale.split('-');
  const first = segments[0];
  if (first === undefined || first.length === 0) {
    throw new Error(`deepl: invalid locale "${locale}"`);
  }
  return first.toUpperCase();
}

function regionSubtag(locale: LocaleCode): string | undefined {
  for (const seg of locale.split('-').slice(1)) {
    if (/^[A-Za-z]{2}$/.test(seg) || /^[0-9]{3}$/.test(seg)) return seg.toUpperCase();
  }
  return undefined;
}

function scriptSubtag(locale: LocaleCode): string | undefined {
  for (const seg of locale.split('-').slice(1)) {
    if (/^[A-Za-z]{4}$/.test(seg)) return `${seg[0]?.toUpperCase()}${seg.slice(1).toUpperCase()}`;
  }
  return undefined;
}
