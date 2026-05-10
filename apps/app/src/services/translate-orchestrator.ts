/**
 * Drives N translation jobs through an `AIProvider` with a concurrency
 * limit, never throws, returns one structured `TranslationOutcome` per
 * input job. The result list is in input order — even though jobs run
 * concurrently — so the review modal can render rows in a stable shape.
 *
 * The orchestrator owns no React, no DOM, no dispatch. The view layer
 * dispatches `translationStart` before calling, then turns each
 * `TranslationOutcome` into one of:
 *   - `setValuesBatch` entry (status `'ready'` → user accepted),
 *   - `translationFail` (status `'error'`),
 *   - `translationClear` (status `'skipped-*'` or user discarded).
 *
 * Empty IR is short-circuited *before* the network call: nothing to
 * translate, no request fires.
 */

import { collectTextNodes, UnsupportedLocaleError, type AIProvider } from '@polylocale/ai';
import type { ICUNode, LocaleCode } from '@polylocale/core';

export interface TranslationJob {
  readonly keyId: string;
  readonly keyPath: string;
  readonly locale: LocaleCode;
  readonly baseLocale: LocaleCode;
  readonly baseIr: readonly ICUNode[];
  readonly description?: string;
}

export type TranslationStatus =
  | { readonly kind: 'ready'; readonly ir: readonly ICUNode[] }
  | { readonly kind: 'skipped-empty' }
  | { readonly kind: 'skipped-unsupported'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

export interface TranslationOutcome {
  readonly job: TranslationJob;
  readonly status: TranslationStatus;
}

export interface RunTranslationsOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  /** Fired once per job as it completes; lets the UI render an X-of-N counter. */
  readonly onProgress?: (outcome: TranslationOutcome, completed: number, total: number) => void;
}

const DEFAULT_CONCURRENCY = 3;

export async function runTranslations(
  jobs: readonly TranslationJob[],
  provider: AIProvider,
  opts: RunTranslationsOptions = {},
): Promise<readonly TranslationOutcome[]> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const signal = opts.signal;
  const onProgress = opts.onProgress;
  const outcomes: TranslationOutcome[] = new Array(jobs.length);
  let next = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= jobs.length) return;
      const job = jobs[i]!;
      const outcome = await runOne(job, provider, signal);
      outcomes[i] = outcome;
      completed++;
      onProgress?.(outcome, completed, jobs.length);
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, jobs.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return outcomes;
}

async function runOne(
  job: TranslationJob,
  provider: AIProvider,
  signal: AbortSignal | undefined,
): Promise<TranslationOutcome> {
  if (signal?.aborted === true) {
    return { job, status: { kind: 'error', message: 'aborted' } };
  }
  if (collectTextNodes(job.baseIr).texts.length === 0) {
    return { job, status: { kind: 'skipped-empty' } };
  }
  try {
    const ir = await provider.translate({
      nodes: job.baseIr,
      from: job.baseLocale,
      to: job.locale,
      ...(job.description !== undefined
        ? { context: { keyPath: job.keyPath, description: job.description } }
        : { context: { keyPath: job.keyPath } }),
    });
    return { job, status: { kind: 'ready', ir } };
  } catch (err) {
    if (err instanceof UnsupportedLocaleError) {
      return { job, status: { kind: 'skipped-unsupported', message: err.message } };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { job, status: { kind: 'error', message } };
  }
}
