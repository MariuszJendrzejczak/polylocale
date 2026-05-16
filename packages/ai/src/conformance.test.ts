/**
 * Cross-provider IR-shape conformance.
 *
 * Five fixtures cover the structural surfaces every provider has to
 * preserve: plain text, text + placeholder, plural with offset, select,
 * and a tag wrapping a placeholder + text. Each fixture is run through
 * all three adapters (DeepL via the mocked `/v2/translate`; OpenAI via
 * `/v1/chat/completions`; Anthropic via `/v1/messages`) with stubbed
 * fetches that always return the same fragments uppercased.
 *
 * Assertion: every output has the same node-kind tree as the input —
 * placeholder names, plural offsets, selector keys, tag names all
 * preserved — and only the leaf `text` values differ. This is the
 * one-and-only contract the AIProvider surface promises; if any
 * provider were to diverge here, this is where it would surface.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ICUNode } from '@polylocale/core';

import { collectTextNodes } from './icu-walk.js';
import { createAnthropicProvider } from './anthropic.js';
import { createDeepLProvider } from './deepl.js';
import { createOpenAIProvider } from './openai.js';
import type { AIProvider } from './provider.js';

interface Fixture {
  readonly name: string;
  readonly nodes: readonly ICUNode[];
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'plain text',
    nodes: [{ kind: 'text', value: 'Hello, world!' }],
  },
  {
    name: 'text + placeholder',
    nodes: [
      { kind: 'text', value: 'Hello ' },
      { kind: 'placeholder', name: 'name' },
      { kind: 'text', value: '!' },
    ],
  },
  {
    name: 'plural with offset',
    nodes: [
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
    ],
  },
  {
    name: 'select',
    nodes: [
      {
        kind: 'select',
        arg: 'gender',
        cases: {
          female: [{ kind: 'text', value: 'She liked it' }],
          male: [{ kind: 'text', value: 'He liked it' }],
          other: [{ kind: 'text', value: 'They liked it' }],
        },
      },
    ],
  },
  {
    name: 'tag wrapping placeholder + text',
    nodes: [
      {
        kind: 'tag',
        name: 'b',
        children: [
          { kind: 'text', value: 'Welcome ' },
          { kind: 'placeholder', name: 'user' },
          { kind: 'text', value: '!' },
        ],
      },
    ],
  },
];

/** Returns a copy of `nodes` with every text leaf upper-cased. */
function uppercaseTexts(nodes: readonly ICUNode[]): readonly ICUNode[] {
  return nodes.map((node): ICUNode => {
    switch (node.kind) {
      case 'text':
        return { kind: 'text', value: node.value.toUpperCase() };
      case 'placeholder':
        return node;
      case 'plural':
      case 'select':
      case 'selectordinal':
        return { ...node, cases: mapCases(node.cases) };
      case 'tag':
        return { ...node, children: uppercaseTexts(node.children) };
    }
  });
}

function mapCases(
  cases: Readonly<Record<string, readonly ICUNode[]>>,
): Readonly<Record<string, readonly ICUNode[]>> {
  const out: Record<string, readonly ICUNode[]> = {};
  for (const [k, v] of Object.entries(cases)) out[k] = uppercaseTexts(v);
  return out;
}

/** Recursively assert two IR trees have identical node-kind structure. */
function assertSameShape(a: readonly ICUNode[], b: readonly ICUNode[]): void {
  expect(b).toHaveLength(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    expect(y.kind).toBe(x.kind);
    switch (x.kind) {
      case 'placeholder':
        expect((y as typeof x).name).toBe(x.name);
        break;
      case 'plural':
      case 'select':
      case 'selectordinal': {
        const yCases = (y as typeof x).cases;
        expect((y as typeof x).arg).toBe(x.arg);
        if ('offset' in x) expect((y as typeof x).offset).toBe(x.offset);
        expect(Object.keys(yCases).sort()).toEqual(Object.keys(x.cases).sort());
        for (const key of Object.keys(x.cases)) {
          assertSameShape(x.cases[key]!, yCases[key]!);
        }
        break;
      }
      case 'tag':
        expect((y as typeof x).name).toBe(x.name);
        assertSameShape(x.children, (y as typeof x).children);
        break;
      case 'text':
        // Text leaves are allowed to differ; that's the whole point.
        break;
    }
  }
}

function deepLFetch() {
  return vi.fn(async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(init.body as string) as { text: string[] };
    return new Response(
      JSON.stringify({
        translations: body.text.map((t) => ({ text: t.toUpperCase() })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

function openAiFetch() {
  return vi.fn(async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMsg = body.messages.find((m) => m.role === 'user')!;
    const payload = JSON.parse(userMsg.content) as { fragments: string[] };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                translations: payload.fragments.map((f) => f.toUpperCase()),
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

function anthropicFetch() {
  return vi.fn(async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMsg = body.messages[0]!;
    const payload = JSON.parse(userMsg.content) as { fragments: string[] };
    return new Response(
      JSON.stringify({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              translations: payload.fragments.map((f) => f.toUpperCase()),
            }),
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

function makeProviders(): readonly { readonly id: string; readonly provider: AIProvider }[] {
  return [
    {
      id: 'deepl',
      provider: createDeepLProvider({
        apiKey: 'k:fx',
        fetch: deepLFetch(),
        // Inject a no-op glossary service so we don't pretend to call /v2/glossaries.
        glossaryService: { ensure: async () => undefined },
      }),
    },
    {
      id: 'openai',
      provider: createOpenAIProvider({ apiKey: 'sk-x', fetch: openAiFetch() }),
    },
    {
      id: 'anthropic',
      provider: createAnthropicProvider({ apiKey: 'sk-ant-x', fetch: anthropicFetch() }),
    },
  ];
}

describe('cross-provider IR-shape conformance', () => {
  for (const fixture of FIXTURES) {
    it(`preserves IR shape across all providers — ${fixture.name}`, async () => {
      const expected = uppercaseTexts(fixture.nodes);
      for (const { id, provider } of makeProviders()) {
        const out = await provider.translate({
          nodes: fixture.nodes,
          from: 'en',
          to: 'pl',
        });
        // Structural shape identical to the input.
        assertSameShape(fixture.nodes, out);
        // Leaves are exactly the uppercase-mapped expectation, so all three
        // providers also agree on what the leaf strings look like.
        expect(out, `${id} on ${fixture.name}`).toEqual(expected);
        // And the original fragment count survives the round-trip.
        expect(collectTextNodes(out).texts.length).toBe(
          collectTextNodes(fixture.nodes).texts.length,
        );
      }
    });
  }
});
