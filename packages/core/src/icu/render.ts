/**
 * ICU MessageFormat renderer.
 *
 * Pure walker over the internal {@link ICUNode} tree — no `@formatjs`
 * coupling. Output is parseable but not byte-equal to arbitrary inputs:
 * see ARCHITECTURE.md §2.1 ("Whitespace and idempotency"). The exporter
 * uses this only when a value's `raw` is missing or stale; byte-exact
 * round-trip for unmodified imports is provided by the `raw` shortcut.
 */

import type { ICUNode } from '../model/icu.js';

export function renderICU(nodes: readonly ICUNode[]): string {
  return render(nodes, false);
}

function render(nodes: readonly ICUNode[], inPlural: boolean): string {
  let out = '';
  for (const node of nodes) out += renderNode(node, inPlural);
  return out;
}

function renderNode(node: ICUNode, inPlural: boolean): string {
  switch (node.kind) {
    case 'text':
      return escapeLiteral(node.value, inPlural);
    case 'placeholder':
      return renderPlaceholder(node.name, node.type, node.format);
    case 'plural':
      return renderPluralLike('plural', node.arg, node.cases, node.offset, pluralKeyOrder, true);
    case 'selectordinal':
      return renderPluralLike(
        'selectordinal',
        node.arg,
        node.cases,
        node.offset,
        pluralKeyOrder,
        true,
      );
    case 'select':
      return renderPluralLike('select', node.arg, node.cases, undefined, selectKeyOrder, false);
    case 'tag':
      return `<${node.name}>${render(node.children, inPlural)}</${node.name}>`;
  }
}

function renderPlaceholder(name: string, type?: string, format?: string): string {
  if (type === undefined) return `{${name}}`;
  if (format === undefined) return `{${name}, ${type}}`;
  return `{${name}, ${type}, ${format}}`;
}

function renderPluralLike(
  keyword: 'plural' | 'selectordinal' | 'select',
  arg: string,
  cases: Readonly<Record<string, readonly ICUNode[]>>,
  offset: number | undefined,
  order: (keys: readonly string[]) => string[],
  caseBodyInPlural: boolean,
): string {
  const parts: string[] = [];
  if (offset !== undefined && offset !== 0) parts.push(`offset:${offset}`);
  for (const caseName of order(Object.keys(cases))) {
    const body = render(cases[caseName]!, caseBodyInPlural);
    parts.push(`${caseName} {${body}}`);
  }
  return `{${arg}, ${keyword}, ${parts.join(' ')}}`;
}

/**
 * Numeric `=N` cases first (sorted ascending), then keyword cases in CLDR
 * order (`zero one two few many other`), then anything else in insertion
 * order. `other` falls naturally at the end of the keyword set.
 */
const PLURAL_KEYWORDS = ['zero', 'one', 'two', 'few', 'many', 'other'];

function pluralKeyOrder(keys: readonly string[]): string[] {
  const numeric: string[] = [];
  const keyword: string[] = [];
  const extra: string[] = [];
  for (const k of keys) {
    if (/^=-?\d+$/.test(k)) numeric.push(k);
    else if (PLURAL_KEYWORDS.includes(k)) keyword.push(k);
    else extra.push(k);
  }
  numeric.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  keyword.sort((a, b) => PLURAL_KEYWORDS.indexOf(a) - PLURAL_KEYWORDS.indexOf(b));
  return [...numeric, ...extra, ...keyword];
}

function selectKeyOrder(keys: readonly string[]): string[] {
  const other: string[] = [];
  const rest: string[] = [];
  for (const k of keys) (k === 'other' ? other : rest).push(k);
  return [...rest, ...other];
}

/**
 * Encode literal text per ICU MessageFormat quoting rules.
 *
 * Rules applied:
 *  - Every literal apostrophe becomes `''` (always-on doubled-quote escape).
 *  - Every syntax char that requires quoting in the current context is
 *    wrapped in its own quoted span: `'{'`, `'}'`, and (inside plural)
 *    `'#'`. Wrapping per-char is necessary because `'X` only opens quote
 *    mode when X is a quote-requiring char in the active context.
 *  - Special case: a text node whose value is exactly `#` inside a plural
 *    is emitted as `#`. It re-parses to PoundElement, which we re-map to
 *    `Text('#')` — keeping the IR stable (see ARCHITECTURE.md §2.1).
 *  - `<` is not escaped — tag literals come from {@link ICUTag}, not from
 *    text content. Inputs containing raw `<…>` text are out of scope.
 */
function escapeLiteral(value: string, inPlural: boolean): string {
  if (inPlural && value === '#') return '#';
  const syntax = inPlural ? /[{}#]/g : /[{}]/g;
  return value.replace(/'/g, "''").replace(syntax, (c) => `'${c}'`);
}
