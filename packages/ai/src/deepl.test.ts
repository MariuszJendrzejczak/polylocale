import { describe, expect, it, vi } from 'vitest';
import type { GlossaryEntry, ICUNode } from '@polylocale/core';
import { createDeepLProvider } from './deepl.js';
import type { DeepLGlossaryService } from './deepl-glossary.js';
import { ProviderHttpError, UnsupportedLocaleError } from './provider.js';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

interface FakeFetchOptions {
  status?: number;
  body?: unknown;
  bodyText?: string;
  contentType?: string;
}

function fakeFetch(opts: FakeFetchOptions = {}) {
  const status = opts.status ?? 200;
  const captured: CapturedCall[] = [];

  const fn = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    captured.push({ url, init });
    const body =
      opts.bodyText !== undefined
        ? opts.bodyText
        : JSON.stringify(opts.body ?? { translations: [] });
    return new Response(body, {
      status,
      headers: { 'Content-Type': opts.contentType ?? 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fn, captured };
}

describe('createDeepLProvider', () => {
  it('rejects empty apiKey', () => {
    expect(() => createDeepLProvider({ apiKey: '' })).toThrowError(/apiKey must not be empty/);
  });

  it('routes a Free-tier key to api-free.deepl.com', async () => {
    const { fn, captured } = fakeFetch({ body: { translations: [{ text: 'Witaj' }] } });
    const provider = createDeepLProvider({ apiKey: 'test-key:fx', fetch: fn });
    await provider.translate({
      nodes: [{ kind: 'text', value: 'Hello' }],
      from: 'en',
      to: 'pl',
    });
    expect(captured[0]?.url).toBe('https://api-free.deepl.com/v2/translate');
  });

  it('routes a Pro-tier key to api.deepl.com', async () => {
    const { fn, captured } = fakeFetch({ body: { translations: [{ text: 'Witaj' }] } });
    const provider = createDeepLProvider({ apiKey: 'pro-key', fetch: fn });
    await provider.translate({
      nodes: [{ kind: 'text', value: 'Hello' }],
      from: 'en',
      to: 'pl',
    });
    expect(captured[0]?.url).toBe('https://api.deepl.com/v2/translate');
  });

  it('uses an explicit endpoint override (proxy deployment)', async () => {
    const { fn, captured } = fakeFetch({ body: { translations: [{ text: 'Witaj' }] } });
    const provider = createDeepLProvider({
      apiKey: 'test-key:fx',
      endpoint: '/api/deepl/v2/translate',
      fetch: fn,
    });
    await provider.translate({
      nodes: [{ kind: 'text', value: 'Hello' }],
      from: 'en',
      to: 'pl',
    });
    expect(captured[0]?.url).toBe('/api/deepl/v2/translate');
  });

  it('sends auth header, JSON body, and DeepL-shaped locales', async () => {
    const { fn, captured } = fakeFetch({ body: { translations: [{ text: 'Witaj' }] } });
    const provider = createDeepLProvider({ apiKey: 'k:fx', fetch: fn });
    await provider.translate({
      nodes: [{ kind: 'text', value: 'Hello' }],
      from: 'en-US',
      to: 'pl-PL',
    });

    const call = captured[0]!;
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('DeepL-Auth-Key k:fx');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      text: ['Hello'],
      source_lang: 'EN',
      target_lang: 'PL',
      preserve_formatting: true,
    });
  });

  it('end-to-end: translates around placeholders and plurals without touching structure', async () => {
    const { fn } = fakeFetch({
      body: {
        translations: [
          { text: 'Witaj ' },
          { text: '!' },
          { text: 'Brak elementów' },
          { text: '# element' },
          { text: '# elementów' },
        ],
      },
    });
    const provider = createDeepLProvider({ apiKey: 'k:fx', fetch: fn });

    const input: readonly ICUNode[] = [
      { kind: 'text', value: 'Hello ' },
      { kind: 'placeholder', name: 'name' },
      { kind: 'text', value: '!' },
      {
        kind: 'plural',
        arg: 'count',
        offset: 1,
        cases: {
          '=0': [{ kind: 'text', value: 'No items' }],
          one: [{ kind: 'text', value: '# item' }],
          other: [{ kind: 'text', value: '# items' }],
        },
      },
    ];

    const out = await provider.translate({ nodes: input, from: 'en', to: 'pl' });

    expect(out).toEqual([
      { kind: 'text', value: 'Witaj ' },
      { kind: 'placeholder', name: 'name' },
      { kind: 'text', value: '!' },
      {
        kind: 'plural',
        arg: 'count',
        offset: 1,
        cases: {
          '=0': [{ kind: 'text', value: 'Brak elementów' }],
          one: [{ kind: 'text', value: '# element' }],
          other: [{ kind: 'text', value: '# elementów' }],
        },
      },
    ]);
  });

  it('skips the network when the IR has no text nodes', async () => {
    const { fn } = fakeFetch();
    const provider = createDeepLProvider({ apiKey: 'k:fx', fetch: fn });
    const input: readonly ICUNode[] = [{ kind: 'placeholder', name: 'name' }];
    const out = await provider.translate({ nodes: input, from: 'en', to: 'pl' });
    expect(out).toBe(input);
    expect(fn).not.toHaveBeenCalled();
  });

  it('throws ProviderHttpError on non-2xx', async () => {
    const { fn } = fakeFetch({ status: 403, bodyText: 'Forbidden' });
    const provider = createDeepLProvider({ apiKey: 'k:fx', fetch: fn });
    await expect(
      provider.translate({
        nodes: [{ kind: 'text', value: 'Hello' }],
        from: 'en',
        to: 'pl',
      }),
    ).rejects.toMatchObject({
      name: 'ProviderHttpError',
      status: 403,
    });
  });

  it('wraps quota-exceeded (456) into ProviderHttpError with full body', async () => {
    const { fn } = fakeFetch({ status: 456, bodyText: 'Quota exceeded' });
    const provider = createDeepLProvider({ apiKey: 'k:fx', fetch: fn });
    let caught: unknown;
    try {
      await provider.translate({
        nodes: [{ kind: 'text', value: 'Hello' }],
        from: 'en',
        to: 'pl',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderHttpError);
    expect((caught as ProviderHttpError).status).toBe(456);
    expect((caught as ProviderHttpError).body).toBe('Quota exceeded');
  });

  it('throws UnsupportedLocaleError for an unknown source locale', async () => {
    const { fn } = fakeFetch();
    const provider = createDeepLProvider({ apiKey: 'k:fx', fetch: fn });
    await expect(
      provider.translate({
        nodes: [{ kind: 'text', value: 'Hello' }],
        from: 'xx',
        to: 'pl',
      }),
    ).rejects.toBeInstanceOf(UnsupportedLocaleError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('throws when the response carries a different number of translations', async () => {
    const { fn } = fakeFetch({
      body: { translations: [{ text: 'a' }, { text: 'b' }] },
    });
    const provider = createDeepLProvider({ apiKey: 'k:fx', fetch: fn });
    await expect(
      provider.translate({
        nodes: [{ kind: 'text', value: 'Hello' }],
        from: 'en',
        to: 'pl',
      }),
    ).rejects.toThrowError(/2 translations for 1 inputs/);
  });

  describe('glossary integration', () => {
    const ENTRIES: readonly GlossaryEntry[] = [
      { term: 'Save', perLocale: { pl: { translation: 'Zapisz' } } },
    ];

    function stubGlossaryService(id: string | undefined): {
      readonly service: DeepLGlossaryService;
      readonly ensure: ReturnType<typeof vi.fn>;
    } {
      const ensure = vi.fn(async () => id);
      return {
        ensure,
        service: { ensure } as DeepLGlossaryService,
      };
    }

    it('skips the glossary service when request.glossary is empty', async () => {
      const { fn } = fakeFetch({ body: { translations: [{ text: 'Witaj' }] } });
      const { service, ensure } = stubGlossaryService('glo-x');
      const provider = createDeepLProvider({
        apiKey: 'k:fx',
        fetch: fn,
        glossaryService: service,
      });
      await provider.translate({
        nodes: [{ kind: 'text', value: 'Hello' }],
        from: 'en',
        to: 'pl',
      });
      expect(ensure).not.toHaveBeenCalled();
    });

    it('passes glossary_id on /v2/translate when ensure resolves to an id', async () => {
      const { fn, captured } = fakeFetch({ body: { translations: [{ text: 'Zapisz' }] } });
      const { service, ensure } = stubGlossaryService('glo-deterministic');
      const provider = createDeepLProvider({
        apiKey: 'k:fx',
        fetch: fn,
        glossaryService: service,
      });
      await provider.translate({
        nodes: [{ kind: 'text', value: 'Save' }],
        from: 'en',
        to: 'pl',
        glossary: ENTRIES,
      });
      expect(ensure).toHaveBeenCalledExactlyOnceWith({
        from: 'en',
        to: 'pl',
        entries: ENTRIES,
      });
      const body = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
      expect(body.glossary_id).toBe('glo-deterministic');
    });

    it('omits glossary_id when ensure returns undefined (unsupported pair)', async () => {
      const { fn, captured } = fakeFetch({ body: { translations: [{ text: 'Zapisz' }] } });
      const { service } = stubGlossaryService(undefined);
      const provider = createDeepLProvider({
        apiKey: 'k:fx',
        fetch: fn,
        glossaryService: service,
      });
      await provider.translate({
        nodes: [{ kind: 'text', value: 'Save' }],
        from: 'en',
        to: 'pl',
        glossary: ENTRIES,
      });
      const body = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
      expect(body.glossary_id).toBeUndefined();
    });
  });
});
