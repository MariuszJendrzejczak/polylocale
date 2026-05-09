/**
 * AI translation provider abstraction.
 *
 * Every provider (DeepL, OpenAI, Google, …) implements {@link AIProvider} on
 * top of the shared ICU IR. Inputs and outputs are {@link ICUNode}[]; the
 * provider is responsible for preserving structure across the translation
 * boundary. The recommended primitive is {@link collectTextNodes} from
 * `./icu-walk.js`, which exposes only {@link ICUText.value}s to the
 * underlying model.
 *
 * Glossary and context are advisory hints. Providers SHOULD honour them when
 * the underlying model supports it and MAY ignore them otherwise; passing
 * them is never a correctness requirement.
 */

import type { GlossaryEntry, ICUNode, LocaleCode } from '@polylocale/core';

export interface TranslateContext {
  readonly keyPath: string;
  readonly description?: string;
}

export interface TranslateRequest {
  readonly nodes: readonly ICUNode[];
  readonly from: LocaleCode;
  readonly to: LocaleCode;
  readonly glossary?: readonly GlossaryEntry[];
  readonly context?: TranslateContext;
}

export interface AIProvider {
  /** Stable provider identifier, e.g. `'deepl'`, `'openai'`. */
  readonly id: string;
  translate(input: TranslateRequest): Promise<readonly ICUNode[]>;
}

/**
 * Thrown by providers when the requested locale pair is not supported by the
 * underlying API. The message lists what the provider does support so the UI
 * can render an actionable error.
 */
export class UnsupportedLocaleError extends Error {
  readonly providerId: string;
  readonly locale: LocaleCode;
  readonly direction: 'source' | 'target';

  constructor(providerId: string, locale: LocaleCode, direction: 'source' | 'target') {
    super(`${providerId}: ${direction} locale "${locale}" is not supported by this provider`);
    this.name = 'UnsupportedLocaleError';
    this.providerId = providerId;
    this.locale = locale;
    this.direction = direction;
  }
}

/**
 * Thrown for non-2xx HTTP responses from the underlying API. The provider
 * adapter wraps fetch errors into this so callers can branch on status
 * (auth, quota, server) without knowing about fetch internals.
 */
export class ProviderHttpError extends Error {
  readonly providerId: string;
  readonly status: number;
  readonly body: string;

  constructor(providerId: string, status: number, body: string) {
    super(`${providerId}: HTTP ${status} — ${body.slice(0, 200)}`);
    this.name = 'ProviderHttpError';
    this.providerId = providerId;
    this.status = status;
    this.body = body;
  }
}
