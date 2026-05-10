import { describe, expect, it, vi } from 'vitest';

import { LLMResponseError } from './provider.js';
import { llmTranslateFragments, MAX_FRAGMENTS_PER_CALL } from './llm-translate.js';
import type { LlmChat, LlmChatRequest } from './llm-translate.js';

function stubChat(replies: readonly string[]): {
  readonly chat: LlmChat;
  readonly calls: LlmChatRequest[];
} {
  const calls: LlmChatRequest[] = [];
  let i = 0;
  const chat: LlmChat = async (req) => {
    calls.push(req);
    const reply = replies[i++];
    if (reply === undefined) {
      throw new Error(`stubChat: ran out of replies (call #${i})`);
    }
    return reply;
  };
  return { chat, calls };
}

describe('llmTranslateFragments', () => {
  it('short-circuits on empty fragments without calling chat', async () => {
    const chat = vi.fn<LlmChat>();
    const out = await llmTranslateFragments({
      fragments: [],
      from: 'en',
      to: 'pl',
      providerId: 'stub',
      chat,
    });
    expect(out).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('round-trips a well-formed response', async () => {
    const { chat, calls } = stubChat([JSON.stringify({ translations: ['Witaj', 'świat'] })]);
    const out = await llmTranslateFragments({
      fragments: ['Hello', 'world'],
      from: 'en',
      to: 'pl',
      providerId: 'stub',
      chat,
    });
    expect(out).toEqual(['Witaj', 'świat']);
    expect(calls).toHaveLength(1);
    const userPayload = JSON.parse(calls[0]!.user) as Record<string, unknown>;
    expect(userPayload).toEqual({
      from: 'en',
      to: 'pl',
      fragments: ['Hello', 'world'],
    });
    expect(calls[0]!.system).toContain('Translate every element of `fragments`');
    expect(calls[0]!.system).toContain('Return a single JSON object');
  });

  it('throws LLMResponseError for malformed JSON', async () => {
    const { chat } = stubChat(['not json at all']);
    await expect(
      llmTranslateFragments({
        fragments: ['a'],
        from: 'en',
        to: 'pl',
        providerId: 'stub',
        chat,
      }),
    ).rejects.toBeInstanceOf(LLMResponseError);
  });

  it('throws LLMResponseError when the array length differs', async () => {
    const { chat } = stubChat([JSON.stringify({ translations: ['only-one'] })]);
    let caught: unknown;
    try {
      await llmTranslateFragments({
        fragments: ['a', 'b'],
        from: 'en',
        to: 'pl',
        providerId: 'stub',
        chat,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LLMResponseError);
    expect((caught as LLMResponseError).reason).toMatch(/expected 2 translations, got 1/);
  });

  it('throws LLMResponseError when an element is not a string', async () => {
    const { chat } = stubChat([JSON.stringify({ translations: ['ok', 42] })]);
    await expect(
      llmTranslateFragments({
        fragments: ['a', 'b'],
        from: 'en',
        to: 'pl',
        providerId: 'stub',
        chat,
      }),
    ).rejects.toThrowError(/translations\[1\] is not a string/);
  });

  it('throws LLMResponseError when translations key is missing', async () => {
    const { chat } = stubChat([JSON.stringify({ result: ['a'] })]);
    await expect(
      llmTranslateFragments({
        fragments: ['a'],
        from: 'en',
        to: 'pl',
        providerId: 'stub',
        chat,
      }),
    ).rejects.toThrowError(/missing a `translations` array/);
  });

  it('splits fragments above the cap into multiple chat calls and stitches them in order', async () => {
    const total = MAX_FRAGMENTS_PER_CALL + 5;
    const fragments = Array.from({ length: total }, (_, i) => `f${i}`);
    const replyA = JSON.stringify({
      translations: fragments.slice(0, MAX_FRAGMENTS_PER_CALL).map((f) => `${f}!`),
    });
    const replyB = JSON.stringify({
      translations: fragments.slice(MAX_FRAGMENTS_PER_CALL).map((f) => `${f}!`),
    });
    const { chat, calls } = stubChat([replyA, replyB]);

    const out = await llmTranslateFragments({
      fragments,
      from: 'en',
      to: 'pl',
      providerId: 'stub',
      chat,
    });

    expect(out).toEqual(fragments.map((f) => `${f}!`));
    expect(calls).toHaveLength(2);
    const firstUser = JSON.parse(calls[0]!.user) as { fragments: string[] };
    const secondUser = JSON.parse(calls[1]!.user) as { fragments: string[] };
    expect(firstUser.fragments).toHaveLength(MAX_FRAGMENTS_PER_CALL);
    expect(secondUser.fragments).toHaveLength(5);
    expect(secondUser.fragments[0]).toBe(`f${MAX_FRAGMENTS_PER_CALL}`);
  });

  it('embeds glossary hints and key context into the system prompt', async () => {
    const { chat, calls } = stubChat([JSON.stringify({ translations: ['Witaj'] })]);
    await llmTranslateFragments({
      fragments: ['Hello'],
      from: 'en',
      to: 'pl',
      providerId: 'stub',
      chat,
      glossary: [
        {
          term: 'polylocale',
          perLocale: { pl: { doNotTranslate: true } },
        },
        {
          term: 'Save',
          perLocale: { pl: { translation: 'Zapisz' } },
        },
        {
          term: 'unrelated',
          perLocale: { fr: { translation: 'sans rapport' } },
        },
      ],
      context: { keyPath: 'home.welcome', description: 'Greeting on the home screen' },
    });
    const systemPrompt = calls[0]!.system;
    expect(systemPrompt).toContain('Key path: home.welcome');
    expect(systemPrompt).toContain('Description: Greeting on the home screen');
    expect(systemPrompt).toContain('"polylocale" → keep as "polylocale"');
    expect(systemPrompt).toContain('"Save" → "Zapisz"');
    // The "unrelated" entry has no `pl` mapping — it must not leak.
    expect(systemPrompt).not.toContain('unrelated');
  });

  it('skips the glossary section entirely when no entries match the target locale', async () => {
    const { chat, calls } = stubChat([JSON.stringify({ translations: ['Witaj'] })]);
    await llmTranslateFragments({
      fragments: ['Hello'],
      from: 'en',
      to: 'pl',
      providerId: 'stub',
      chat,
      glossary: [{ term: 'foo', perLocale: { de: { translation: 'foo' } } }],
    });
    expect(calls[0]!.system).not.toContain('Glossary');
  });
});
