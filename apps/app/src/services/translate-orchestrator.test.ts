import { describe, expect, it, vi } from 'vitest';

import { UnsupportedLocaleError, type AIProvider } from '@polylocale/ai';
import type { ICUNode } from '@polylocale/core';

import { runTranslations, type TranslationJob } from './translate-orchestrator.js';

function job(overrides: Partial<TranslationJob> = {}): TranslationJob {
  return {
    keyId: 'k1',
    keyPath: 'greet',
    locale: 'pl',
    baseLocale: 'en',
    baseIr: [{ kind: 'text', value: 'Hello' }] satisfies ICUNode[],
    ...overrides,
  };
}

describe('runTranslations', () => {
  it('respects the concurrency limit and preserves input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider: AIProvider = {
      id: 'stub',
      async translate({ nodes }) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return nodes;
      },
    };
    const jobs = Array.from({ length: 5 }, (_, i) => job({ keyId: `k${i}`, keyPath: `path-${i}` }));
    const out = await runTranslations(jobs, provider, { concurrency: 3 });
    expect(out).toHaveLength(5);
    expect(out.map((o) => o.job.keyId)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
    expect(out.every((o) => o.status.kind === 'ready')).toBe(true);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('short-circuits jobs whose base IR has no translatable text', async () => {
    const translate = vi.fn();
    const provider: AIProvider = { id: 'stub', translate };
    const jobs = [
      job({ keyId: 'placeholder-only', baseIr: [{ kind: 'placeholder', name: 'count' }] }),
      job({ keyId: 'empty', baseIr: [] }),
    ];
    const out = await runTranslations(jobs, provider);
    expect(out[0]?.status.kind).toBe('skipped-empty');
    expect(out[1]?.status.kind).toBe('skipped-empty');
    expect(translate).not.toHaveBeenCalled();
  });

  it('catches UnsupportedLocaleError into a skipped-unsupported outcome', async () => {
    const provider: AIProvider = {
      id: 'stub',
      async translate() {
        throw new UnsupportedLocaleError('deepl', 'mt-MT', 'target');
      },
    };
    const out = await runTranslations([job({ locale: 'mt-MT' })], provider);
    expect(out[0]?.status.kind).toBe('skipped-unsupported');
    if (out[0]?.status.kind === 'skipped-unsupported') {
      expect(out[0].status.message).toContain('mt-MT');
    }
  });

  it('catches generic errors into an error outcome', async () => {
    const provider: AIProvider = {
      id: 'stub',
      async translate() {
        throw new Error('rate limited');
      },
    };
    const out = await runTranslations([job()], provider);
    expect(out[0]?.status.kind).toBe('error');
    if (out[0]?.status.kind === 'error') {
      expect(out[0].status.message).toBe('rate limited');
    }
  });

  it('forwards a job glossary onto provider.translate when present', async () => {
    const translate = vi.fn<AIProvider['translate']>(async ({ nodes }) => nodes);
    const provider: AIProvider = { id: 'stub', translate };
    const glossary = [
      { term: 'polylocale', perLocale: { pl: { doNotTranslate: true as const } } },
    ];
    await runTranslations([job({ glossary })], provider);
    expect(translate).toHaveBeenCalledTimes(1);
    const call = translate.mock.calls[0]![0];
    expect(call.glossary).toEqual(glossary);
  });

  it('omits the glossary field on provider.translate when the job has none', async () => {
    const translate = vi.fn<AIProvider['translate']>(async ({ nodes }) => nodes);
    const provider: AIProvider = { id: 'stub', translate };
    await runTranslations([job()], provider);
    const call = translate.mock.calls[0]![0];
    expect('glossary' in call).toBe(false);
  });

  it('stops dispatching new jobs after the abort signal fires', async () => {
    let count = 0;
    const controller = new AbortController();
    const provider: AIProvider = {
      id: 'stub',
      async translate({ nodes }) {
        count++;
        if (count === 1) controller.abort();
        return nodes;
      },
    };
    const jobs = Array.from({ length: 5 }, (_, i) => job({ keyId: `k${i}` }));
    const out = await runTranslations(jobs, provider, {
      concurrency: 1,
      signal: controller.signal,
    });
    expect(out).toHaveLength(5);
    expect(out[0]?.status.kind).toBe('ready');
    expect(out.slice(1).every((o) => o.status.kind === 'error')).toBe(true);
  });
});
