import { describe, expect, it, vi } from 'vitest';
import type { ICUNode } from '@polylocale/core';

import { createOpenAIProvider } from './openai.js';
import { LLMResponseError, ProviderHttpError } from './provider.js';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

interface FakeFetchOptions {
  status?: number;
  body?: unknown;
  bodyText?: string;
}

function fakeFetch(opts: FakeFetchOptions = {}) {
  const status = opts.status ?? 200;
  const captured: CapturedCall[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    captured.push({ url, init });
    const body = opts.bodyText !== undefined ? opts.bodyText : JSON.stringify(opts.body ?? {});
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, captured };
}

function chatCompletionPayload(translations: readonly string[]): unknown {
  return {
    choices: [
      {
        message: { role: 'assistant', content: JSON.stringify({ translations }) },
      },
    ],
  };
}

describe('createOpenAIProvider', () => {
  it('rejects empty apiKey', () => {
    expect(() => createOpenAIProvider({ apiKey: '' })).toThrowError(/apiKey must not be empty/);
  });

  it('skips the network when the IR has no text nodes', async () => {
    const { fn } = fakeFetch();
    const provider = createOpenAIProvider({ apiKey: 'sk-x', fetch: fn });
    const input: readonly ICUNode[] = [{ kind: 'placeholder', name: 'name' }];
    const out = await provider.translate({ nodes: input, from: 'en', to: 'pl' });
    expect(out).toBe(input);
    expect(fn).not.toHaveBeenCalled();
  });

  it('posts to the chat completions endpoint with bearer auth and json_schema response_format', async () => {
    const { fn, captured } = fakeFetch({ body: chatCompletionPayload(['Witaj']) });
    const provider = createOpenAIProvider({ apiKey: 'sk-test', fetch: fn });
    await provider.translate({
      nodes: [{ kind: 'text', value: 'Hello' }],
      from: 'en',
      to: 'pl',
    });

    const call = captured[0]!;
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0);
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
    const userPayload = JSON.parse(messages[1]!.content) as Record<string, unknown>;
    expect(userPayload).toEqual({ from: 'en', to: 'pl', fragments: ['Hello'] });

    const rf = body.response_format as Record<string, unknown>;
    expect(rf.type).toBe('json_schema');
    const schema = rf.json_schema as { name: string; strict: boolean };
    expect(schema.name).toBe('translations');
    expect(schema.strict).toBe(true);
  });

  it('honours an explicit model override', async () => {
    const { fn, captured } = fakeFetch({ body: chatCompletionPayload(['Witaj']) });
    const provider = createOpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5-mini', fetch: fn });
    await provider.translate({
      nodes: [{ kind: 'text', value: 'Hello' }],
      from: 'en',
      to: 'pl',
    });
    const body = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('gpt-5-mini');
  });

  it('preserves placeholders and plurals end-to-end', async () => {
    const { fn } = fakeFetch({
      body: chatCompletionPayload(['Witaj ', '!', 'Brak elementów', '# element', '# elementów']),
    });
    const provider = createOpenAIProvider({ apiKey: 'sk-x', fetch: fn });
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

  it('throws ProviderHttpError on 401', async () => {
    const { fn } = fakeFetch({ status: 401, bodyText: 'Unauthorized' });
    const provider = createOpenAIProvider({ apiKey: 'sk-bad', fetch: fn });
    await expect(
      provider.translate({
        nodes: [{ kind: 'text', value: 'Hello' }],
        from: 'en',
        to: 'pl',
      }),
    ).rejects.toMatchObject({ name: 'ProviderHttpError', status: 401 });
  });

  it('wraps a malformed model output into LLMResponseError', async () => {
    const { fn } = fakeFetch({
      body: { choices: [{ message: { content: 'not-json-at-all' } }] },
    });
    const provider = createOpenAIProvider({ apiKey: 'sk-x', fetch: fn });
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
    expect(caught).toBeInstanceOf(LLMResponseError);
  });

  it('throws LLMResponseError when no assistant content is present', async () => {
    const { fn } = fakeFetch({ body: { choices: [{ message: {} }] } });
    const provider = createOpenAIProvider({ apiKey: 'sk-x', fetch: fn });
    await expect(
      provider.translate({
        nodes: [{ kind: 'text', value: 'Hello' }],
        from: 'en',
        to: 'pl',
      }),
    ).rejects.toBeInstanceOf(LLMResponseError);
  });

  it('throws ProviderHttpError on quota errors (429)', async () => {
    const { fn } = fakeFetch({ status: 429, bodyText: 'Rate limit' });
    const provider = createOpenAIProvider({ apiKey: 'sk-x', fetch: fn });
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
    expect((caught as ProviderHttpError).status).toBe(429);
  });
});
