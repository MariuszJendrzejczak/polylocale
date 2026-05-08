/**
 * ICU MessageFormat parser.
 *
 * Single integration point with `@formatjs/icu-messageformat-parser`. Maps the
 * library's AST onto the project's internal {@link ICUNode} discriminated
 * union, so callers stay decoupled from the underlying parser. PoundElement
 * (the `#` placeholder inside plurals) is collapsed to `Text('#')` — see
 * ARCHITECTURE.md §2.1 for the round-trip rationale.
 */

import {
  SKELETON_TYPE,
  TYPE,
  parse as formatjsParse,
  type DateTimeSkeleton,
  type MessageFormatElement,
  type NumberSkeleton,
  type PluralElement,
  type PluralOrSelectOption,
  type SelectElement,
} from '@formatjs/icu-messageformat-parser';

import type { ICUNode } from '../model/icu.js';

export function parseICU(raw: string): ICUNode[] {
  // `shouldParseSkeletons: false` skips parsing skeletons into Intl options
  // (we don't introspect them) but still hands us a NumberSkeleton/
  // DateTimeSkeleton object whenever the source style was a `::…` skeleton.
  // {@link styleAsString} re-serializes those back to their `::…` form so
  // our `format` field stays a plain, faithful string in every case.
  const ast = formatjsParse(raw, { shouldParseSkeletons: false });
  return mapElements(ast);
}

function mapElements(ast: readonly MessageFormatElement[]): ICUNode[] {
  return ast.map(mapElement);
}

function mapElement(el: MessageFormatElement): ICUNode {
  switch (el.type) {
    case TYPE.literal:
      return { kind: 'text', value: el.value };
    case TYPE.argument:
      return { kind: 'placeholder', name: el.value };
    case TYPE.number:
      return placeholderWithType(el.value, 'number', styleAsString(el.style));
    case TYPE.date:
      return placeholderWithType(el.value, 'date', styleAsString(el.style));
    case TYPE.time:
      return placeholderWithType(el.value, 'time', styleAsString(el.style));
    case TYPE.select:
      return mapSelect(el);
    case TYPE.plural:
      return mapPlural(el);
    case TYPE.pound:
      return { kind: 'text', value: '#' };
    case TYPE.tag:
      return { kind: 'tag', name: el.value, children: mapElements(el.children) };
  }
}

function placeholderWithType(name: string, type: string, format: string | undefined): ICUNode {
  return format === undefined
    ? { kind: 'placeholder', name, type }
    : { kind: 'placeholder', name, type, format };
}

function styleAsString(
  style: string | NumberSkeleton | DateTimeSkeleton | null | undefined,
): string | undefined {
  if (style == null) return undefined;
  if (typeof style === 'string') return style;
  if (style.type === SKELETON_TYPE.dateTime) return `::${style.pattern}`;
  return `::${style.tokens.map(numberSkeletonToken).join(' ')}`;
}

function numberSkeletonToken(token: { stem: string; options: readonly string[] }): string {
  return token.options.length === 0
    ? token.stem
    : `${token.stem}${token.options.map((o) => `/${o}`).join('')}`;
}

function mapSelect(el: SelectElement): ICUNode {
  return { kind: 'select', arg: el.value, cases: mapCases(el.options) };
}

function mapPlural(el: PluralElement): ICUNode {
  const cases = mapCases(el.options);
  const kind = el.pluralType === 'ordinal' ? 'selectordinal' : 'plural';
  return el.offset === 0
    ? { kind, arg: el.value, cases }
    : { kind, arg: el.value, cases, offset: el.offset };
}

function mapCases(
  options: Record<string, PluralOrSelectOption>,
): Record<string, readonly ICUNode[]> {
  const out: Record<string, readonly ICUNode[]> = {};
  for (const [name, opt] of Object.entries(options)) {
    out[name] = mapElements(opt.value);
  }
  return out;
}
