import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { GlossaryEntry } from '@polylocale/core';

import { createDeepLGlossaryService } from './deepl-glossary.js';
import { ProviderHttpError } from './provider.js';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

interface FakeOptions {
  pairs?: Array<{ source_lang: string; target_lang: string }>;
  glossaries?: Array<Record<string, unknown>>;
  createId?: string;
  failPairs?: number;
  failList?: number;
  failCreate?: number;
}

function fakeFetch(opts: FakeOptions = {}) {
  const captured: CapturedCall[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    captured.push({ url, init });
    if (url.endsWith('/glossary-language-pairs')) {
      if (opts.failPairs !== undefined) {
        return new Response('boom', { status: opts.failPairs });
      }
      return jsonResponse({
        supported_languages: opts.pairs ?? [
          { source_lang: 'EN', target_lang: 'DE' },
          { source_lang: 'EN', target_lang: 'PL' },
        ],
      });
    }
    if (url.endsWith('/glossaries') && (init.method ?? 'GET') === 'GET') {
      if (opts.failList !== undefined) {
        return new Response('boom', { status: opts.failList });
      }
      return jsonResponse({ glossaries: opts.glossaries ?? [] });
    }
    if (url.endsWith('/glossaries') && init.method === 'POST') {
      if (opts.failCreate !== undefined) {
        return new Response('boom', { status: opts.failCreate });
      }
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse({
        glossary_id: opts.createId ?? 'glo-new',
        name: body.name,
        source_lang: body.source_lang,
        target_lang: body.target_lang,
        entry_count: (body.entries as string).split('\n').length || 1,
        ready: true,
      });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, captured };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ENTRIES_EN_PL: readonly GlossaryEntry[] = [
  { term: 'Save', perLocale: { pl: { translation: 'Zapisz' } } },
  { term: 'polylocale', perLocale: { pl: { doNotTranslate: true } } },
];

function makeService(fn: typeof fetch) {
  return createDeepLGlossaryService({
    apiKey: 'k:fx',
    baseEndpoint: '/api/deepl/v2',
    fetch: fn,
    subtle: webcrypto.subtle,
  });
}

describe('createDeepLGlossaryService', () => {
  it('returns undefined when no entries are usable for the target locale', async () => {
    const { fn } = fakeFetch();
    const svc = makeService(fn);
    const id = await svc.ensure({
      from: 'en',
      to: 'fr',
      entries: [{ term: 'Save', perLocale: { pl: { translation: 'Zapisz' } } }],
    });
    expect(id).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns undefined when entries exist but the language pair is not glossary-supported', async () => {
    const { fn, captured } = fakeFetch({ pairs: [{ source_lang: 'DE', target_lang: 'FR' }] });
    const svc = makeService(fn);
    const id = await svc.ensure({ from: 'en', to: 'pl', entries: ENTRIES_EN_PL });
    expect(id).toBeUndefined();
    // We did call /glossary-language-pairs to check, but never list/create.
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toMatch(/glossary-language-pairs$/);
  });

  it('reuses an existing glossary by deterministic name', async () => {
    let createdName = '';
    const { fn, captured } = fakeFetch({
      glossaries: [],
      createId: 'glo-created',
    });
    // First create one to learn the deterministic name…
    const svc = makeService(fn);
    const newId = await svc.ensure({ from: 'en', to: 'pl', entries: ENTRIES_EN_PL });
    expect(newId).toBe('glo-created');
    const createCall = captured.find((c) => c.init.method === 'POST');
    expect(createCall).toBeDefined();
    createdName = (JSON.parse(createCall!.init.body as string) as { name: string }).name;
    expect(createdName.startsWith('polylocale:')).toBe(true);

    // …then a second service instance should find it during list and skip create.
    const second = fakeFetch({
      glossaries: [
        {
          glossary_id: 'glo-existing',
          name: createdName,
          source_lang: 'EN',
          target_lang: 'PL',
          ready: true,
        },
      ],
    });
    const svc2 = makeService(second.fn);
    const reusedId = await svc2.ensure({ from: 'en', to: 'pl', entries: ENTRIES_EN_PL });
    expect(reusedId).toBe('glo-existing');
    expect(second.captured.some((c) => c.init.method === 'POST')).toBe(false);
  });

  it('creates a new glossary with TSV entries when none exists', async () => {
    const { fn, captured } = fakeFetch({ glossaries: [], createId: 'glo-fresh' });
    const svc = makeService(fn);
    const id = await svc.ensure({ from: 'en', to: 'pl', entries: ENTRIES_EN_PL });
    expect(id).toBe('glo-fresh');

    const createCall = captured.find((c) => c.init.method === 'POST')!;
    expect(createCall.url).toBe('/api/deepl/v2/glossaries');
    const body = JSON.parse(createCall.init.body as string) as Record<string, unknown>;
    expect(body.source_lang).toBe('EN');
    expect(body.target_lang).toBe('PL');
    expect(body.entries_format).toBe('tsv');
    // Sorted by source term: "Save" < "polylocale".
    expect(body.entries).toBe('Save\tZapisz\npolylocale\tpolylocale');

    const headers = createCall.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('DeepL-Auth-Key k:fx');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('caches the glossary id across calls — second ensure makes no network requests', async () => {
    const { fn, captured } = fakeFetch({ glossaries: [], createId: 'glo-cached' });
    const svc = makeService(fn);
    const a = await svc.ensure({ from: 'en', to: 'pl', entries: ENTRIES_EN_PL });
    const callsAfterFirst = captured.length;
    const b = await svc.ensure({ from: 'en', to: 'pl', entries: ENTRIES_EN_PL });
    expect(a).toBe(b);
    expect(captured.length).toBe(callsAfterFirst);
  });

  it('escapes tabs and newlines inside glossary terms before TSV', async () => {
    const { fn, captured } = fakeFetch({ glossaries: [], createId: 'glo-x' });
    const svc = makeService(fn);
    await svc.ensure({
      from: 'en',
      to: 'pl',
      entries: [{ term: 'Hello\tWorld', perLocale: { pl: { translation: 'Witaj\nświat' } } }],
    });
    const createCall = captured.find((c) => c.init.method === 'POST')!;
    const body = JSON.parse(createCall.init.body as string) as Record<string, unknown>;
    expect(body.entries).toBe('Hello World\tWitaj świat');
  });

  it('strips a region subtag for glossary purposes (translate stays regional)', async () => {
    const { fn, captured } = fakeFetch({
      pairs: [{ source_lang: 'EN', target_lang: 'PT' }],
      glossaries: [],
      createId: 'glo-pt',
    });
    const svc = makeService(fn);
    const id = await svc.ensure({
      from: 'en',
      to: 'pt-BR',
      entries: [{ term: 'Save', perLocale: { 'pt-BR': { translation: 'Salvar' } } }],
    });
    expect(id).toBe('glo-pt');
    const createCall = captured.find((c) => c.init.method === 'POST')!;
    const body = JSON.parse(createCall.init.body as string) as Record<string, unknown>;
    expect(body.target_lang).toBe('PT');
  });

  it('bubbles a ProviderHttpError when the create call fails', async () => {
    const { fn } = fakeFetch({ glossaries: [], failCreate: 500 });
    const svc = makeService(fn);
    let caught: unknown;
    try {
      await svc.ensure({ from: 'en', to: 'pl', entries: ENTRIES_EN_PL });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderHttpError);
    expect((caught as ProviderHttpError).status).toBe(500);
  });
});
