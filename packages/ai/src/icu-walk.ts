/**
 * ICU IR walker for AI translation.
 *
 * Splits an ICU node tree into two parts:
 *  - the ordered list of translatable text values (every {@link ICUText.value}
 *    found by depth-first traversal across plural/select/selectordinal cases
 *    and tag children);
 *  - a `reassemble` callback that takes a translated list of the same length
 *    and rebuilds the original tree with text values replaced in place,
 *    leaving every placeholder, plural offset, case key, format, and tag
 *    name untouched.
 *
 * This is the masking strategy: providers that operate on plain text (DeepL,
 * Google) only see {@link CollectedTexts.texts}; ICU structure is invisible to
 * them and therefore unbreakable. LLM-based providers may still want richer
 * context, but they too can fall back to this primitive when round-trip
 * safety matters more than fluency.
 */

import type { ICUNode } from '@polylocale/core';

export interface CollectedTexts {
  readonly texts: readonly string[];
  reassemble(translated: readonly string[]): readonly ICUNode[];
}

export function collectTextNodes(nodes: readonly ICUNode[]): CollectedTexts {
  const texts: string[] = [];
  collect(nodes, texts);

  return {
    texts,
    reassemble(translated) {
      if (translated.length !== texts.length) {
        throw new Error(
          `collectTextNodes.reassemble: expected ${texts.length} translated strings, got ${translated.length}`,
        );
      }
      const cursor = { i: 0 };
      const rebuilt = rebuild(nodes, translated, cursor);
      if (cursor.i !== translated.length) {
        throw new Error(
          `collectTextNodes.reassemble: consumed ${cursor.i} of ${translated.length} translations`,
        );
      }
      return rebuilt;
    },
  };
}

function collect(nodes: readonly ICUNode[], out: string[]): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out.push(node.value);
        break;
      case 'placeholder':
        break;
      case 'plural':
      case 'select':
      case 'selectordinal':
        for (const caseNodes of Object.values(node.cases)) {
          collect(caseNodes, out);
        }
        break;
      case 'tag':
        collect(node.children, out);
        break;
    }
  }
}

function rebuild(
  nodes: readonly ICUNode[],
  translated: readonly string[],
  cursor: { i: number },
): readonly ICUNode[] {
  return nodes.map((node): ICUNode => {
    switch (node.kind) {
      case 'text': {
        const value = translated[cursor.i++];
        if (value === undefined) {
          throw new Error('collectTextNodes.reassemble: ran out of translations');
        }
        return { kind: 'text', value };
      }
      case 'placeholder':
        return node;
      case 'plural':
        return { ...node, cases: rebuildCases(node.cases, translated, cursor) };
      case 'selectordinal':
        return { ...node, cases: rebuildCases(node.cases, translated, cursor) };
      case 'select':
        return { ...node, cases: rebuildCases(node.cases, translated, cursor) };
      case 'tag':
        return { ...node, children: rebuild(node.children, translated, cursor) };
    }
  });
}

function rebuildCases(
  cases: Readonly<Record<string, readonly ICUNode[]>>,
  translated: readonly string[],
  cursor: { i: number },
): Readonly<Record<string, readonly ICUNode[]>> {
  const out: Record<string, readonly ICUNode[]> = {};
  for (const [key, caseNodes] of Object.entries(cases)) {
    out[key] = rebuild(caseNodes, translated, cursor);
  }
  return out;
}
