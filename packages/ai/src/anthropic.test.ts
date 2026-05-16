import { describe, expect, it, vi } from 'vitest';
import type { ICUNode } from '@polylocale/core';

import { createAnthropicProvider } from './anthropic.js';
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

function messagePayload(translations: readonly string[]): unknown {
  return {
    content: [{ type: 'text', text: JSON.stringify({ translations }) }],
  };
}

describe('createAnthropicProvider', () => {
  it('rejects empty apiKey', () => {
    expect(() => createAnthropicProvider({ apiKey: '' })).toThrowError(/apiKey must not be empty/);
  });

  it('skips the network when the IR has no text nodes', async () => {
    const { fn } = fakeFetch();
    const provider = createAnthropicProvider({ apiKey: 'sk-ant-x', fetch: fn });
    const input: readonly ICUNode[] = [{ kind: 'placeholder', name: 'name' }];
    const out = await provider.translate({ nodes: input, from: 'en', to: 'pl' });
    expect(out).toBe(input);
    expect(fn).not.toHaveBeenCalled();
  });

  it('posts to /v1/messages with anthropic headers and the default model', async () => {
    const { fn, captured } = fakeFetch({ body: messagePayload(['Witaj']) });
    const provider = createAnthropicProvider({ apiKey: 'sk-ant-test', fetch: fn });
    await provider.translate({
      nodes: [{ kind: 'text', value: 'Hello' }],
      from: 'en',
      to: 'pl',
    });

    const call = captured[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.max_tokens).toBe(4096);
    expect(typeof body.system).toBe('string');
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    const userPayload = JSON.parse(messages[0]!.content) as Record<string, unknown>;
    expect(userPayload).toEqual({ from: 'en', to: 'pl', fragments: ['Hello'] });
  });

  it('honours model and version overrides', async () => {
    const { fn, captured } = fakeFetch({ body: messagePayload(['Witaj']) });
    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-x',
      model: 'claude-sonnet-4-6',
      anthropicVersion: '2024-10-22',
      fetch: fn,
    });
    await provider.translate({
      nodes: [{ kind: 'text', value: 'Hello' }],
      from: 'en',
      to: 'pl',
    });
    const call = captured[0]!;
    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('claude-sonnet-4-6');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2024-10-22');
  });

  it('preserves placeholders and plurals end-to-end', async () => {
    const { fn } = fakeFetch({
      body: messagePayload(['Witaj ', '!', 'Brak elementów', '# element', '# elementów']),
    });
    const provider = createAnthropicProvider({ apiKey: 'sk-ant-x', fetch: fn });
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

  it('throws ProviderHttpError on 429', async () => {
    const { fn } = fakeFetch({ status: 429, bodyText: 'overloaded' });
    const provider = createAnthropicProvider({ apiKey: 'sk-ant-x', fetch: fn });
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

  it('throws LLMResponseError when no text content block is present', async () => {
    const { fn } = fakeFetch({ body: { content: [{ type: 'tool_use', text: 'irrelevant' }] } });
    const provider = createAnthropicProvider({ apiKey: 'sk-ant-x', fetch: fn });
    await expect(
      provider.translate({
        nodes: [{ kind: 'text', value: 'Hello' }],
        from: 'en',
        to: 'pl',
      }),
    ).rejects.toBeInstanceOf(LLMResponseError);
  });

  it('throws LLMResponseError when the model emits malformed JSON', async () => {
    const { fn } = fakeFetch({
      body: { content: [{ type: 'text', text: 'sorry, I cannot do JSON today' }] },
    });
    const provider = createAnthropicProvider({ apiKey: 'sk-ant-x', fetch: fn });
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
});
