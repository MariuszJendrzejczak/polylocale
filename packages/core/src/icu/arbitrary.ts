/**
 * fast-check generators for {@link ICUNode} trees.
 *
 * The generators are deliberately conservative — they exclude legal-but-
 * tricky inputs whose round-trip behaviour is already covered by the hand-
 * written fixtures in `round-trip.test.ts` (e.g. literal `#` inside plural
 * bodies, empty-string text). Their job is to fuzz the *shape* of the tree:
 * arbitrary nesting, arbitrary case sets, arbitrary placeholder configs.
 *
 * Two invariants are enforced *constructively* (not via `fc.pre`) because
 * they would otherwise dominate shrinking:
 *
 *  1. No two adjacent `text` nodes — `formatjs` merges adjacent literals on
 *     re-parse (`[Text('a'), Text('b')] → [Text('ab')]`), so adjacency
 *     would make `icuEqual` fail trivially.
 *  2. Text values never contain `<` — `render.ts` deliberately leaves `<`
 *     unescaped (tag literals come from {@link ICUTag}, not from text), so
 *     a literal `<…>` inside a `text` node would re-parse as a tag.
 *
 * Identifiers (placeholder/plural/select args, tag names) are drawn from
 * fixed pools that exclude ICU reserved words (`plural`, `select`,
 * `selectordinal`, `number`, `date`, `time`, `offset`, CLDR keywords) and
 * known formatjs syntax.
 */

import fc, { type Arbitrary } from 'fast-check';

import type {
  ICUNode,
  ICUPlaceholder,
  ICUPlural,
  ICUSelect,
  ICUSelectOrdinal,
  ICUTag,
  ICUText,
} from '../model/icu.js';

const TEXT_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?:;-'.split('');

const IDENTIFIER_POOL = ['count', 'n', 'name', 'user', 'arg', 'x', 'y', 'z', 'idx', 'id'] as const;

const TAG_NAME_POOL = ['b', 'i', 'strong', 'em', 'span'] as const;

const NUMBER_FORMAT_POOL = ['integer', 'currency', 'percent', '::currency/USD'] as const;

const DATE_FORMAT_POOL = ['short', 'medium', 'long', 'full'] as const;

const PLURAL_KEYWORD_CASES = ['zero', 'one', 'two', 'few', 'many'] as const;

/** Non-empty ASCII text safe for ICU literals — see file header for excluded chars. */
export const arbitraryText: Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 12,
  unit: fc.constantFrom(...TEXT_ALPHABET),
});

const arbitraryIdentifier: Arbitrary<string> = fc.constantFrom(...IDENTIFIER_POOL);

function arbitraryTextNode(): Arbitrary<ICUText> {
  return arbitraryText.map((value) => ({ kind: 'text', value }));
}

export const arbitraryPlaceholder: Arbitrary<ICUPlaceholder> = fc.oneof(
  arbitraryIdentifier.map((name): ICUPlaceholder => ({ kind: 'placeholder', name })),
  fc
    .tuple(
      arbitraryIdentifier,
      fc.option(fc.constantFrom(...NUMBER_FORMAT_POOL), { nil: undefined }),
    )
    .map(
      ([name, format]): ICUPlaceholder =>
        format === undefined
          ? { kind: 'placeholder', name, type: 'number' }
          : { kind: 'placeholder', name, type: 'number', format },
    ),
  fc
    .tuple(
      arbitraryIdentifier,
      fc.constantFrom('date' as const, 'time' as const),
      fc.option(fc.constantFrom(...DATE_FORMAT_POOL), { nil: undefined }),
    )
    .map(
      ([name, type, format]): ICUPlaceholder =>
        format === undefined
          ? { kind: 'placeholder', name, type }
          : { kind: 'placeholder', name, type, format },
    ),
);

const arbitraryPluralCaseName: Arbitrary<string> = fc.oneof(
  fc.integer({ min: 0, max: 5 }).map((n) => `=${n}`),
  fc.constantFrom(...PLURAL_KEYWORD_CASES),
);

function arbitraryCaseEntries(
  name: Arbitrary<string>,
  body: Arbitrary<readonly ICUNode[]>,
): Arbitrary<ReadonlyArray<readonly [string, readonly ICUNode[]]>> {
  return fc.array(fc.tuple(name, body), { minLength: 0, maxLength: 3 });
}

function buildCases(
  extras: ReadonlyArray<readonly [string, readonly ICUNode[]]>,
  otherBody: readonly ICUNode[],
): Record<string, readonly ICUNode[]> {
  const out: Record<string, readonly ICUNode[]> = {};
  for (const [caseName, caseBody] of extras) {
    if (caseName === 'other') continue;
    out[caseName] = caseBody;
  }
  out.other = otherBody;
  return out;
}

export function arbitraryPlural(depth: number): Arbitrary<ICUPlural> {
  const body = arbitraryIcuNodes(depth - 1);
  return fc
    .tuple(
      arbitraryIdentifier,
      arbitraryCaseEntries(arbitraryPluralCaseName, body),
      fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
      body,
    )
    .map(([arg, extras, offset, otherBody]): ICUPlural => {
      const cases = buildCases(extras, otherBody);
      return offset === undefined
        ? { kind: 'plural', arg, cases }
        : { kind: 'plural', arg, cases, offset };
    });
}

export function arbitrarySelectOrdinal(depth: number): Arbitrary<ICUSelectOrdinal> {
  const body = arbitraryIcuNodes(depth - 1);
  return fc
    .tuple(
      arbitraryIdentifier,
      arbitraryCaseEntries(arbitraryPluralCaseName, body),
      fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
      body,
    )
    .map(([arg, extras, offset, otherBody]): ICUSelectOrdinal => {
      const cases = buildCases(extras, otherBody);
      return offset === undefined
        ? { kind: 'selectordinal', arg, cases }
        : { kind: 'selectordinal', arg, cases, offset };
    });
}

export function arbitrarySelect(depth: number): Arbitrary<ICUSelect> {
  const body = arbitraryIcuNodes(depth - 1);
  return fc.tuple(arbitraryIdentifier, arbitraryCaseEntries(arbitraryIdentifier, body), body).map(
    ([arg, extras, otherBody]): ICUSelect => ({
      kind: 'select',
      arg,
      cases: buildCases(extras, otherBody),
    }),
  );
}

export function arbitraryTag(depth: number): Arbitrary<ICUTag> {
  return fc
    .tuple(fc.constantFrom(...TAG_NAME_POOL), arbitraryIcuNodes(depth - 1))
    .map(([name, children]): ICUTag => ({ kind: 'tag', name, children }));
}

function arbitraryNonTextNode(depth: number): Arbitrary<ICUNode> {
  if (depth <= 0) return arbitraryPlaceholder;
  return fc.oneof(
    { weight: 3, arbitrary: arbitraryPlaceholder },
    { weight: 1, arbitrary: arbitraryPlural(depth) },
    { weight: 1, arbitrary: arbitrarySelect(depth) },
    { weight: 1, arbitrary: arbitrarySelectOrdinal(depth) },
    { weight: 1, arbitrary: arbitraryTag(depth) },
  );
}

/**
 * Top-level node sequence. Generates non-text "slot" nodes first, then
 * sprinkles optional text in each gap (start, between slots, end). This
 * makes adjacent-text impossible by construction.
 */
export function arbitraryIcuNodes(maxDepth = 3): Arbitrary<readonly ICUNode[]> {
  return fc.array(arbitraryNonTextNode(maxDepth), { minLength: 0, maxLength: 5 }).chain((slots) =>
    fc
      .array(fc.option(arbitraryTextNode(), { nil: undefined }), {
        minLength: slots.length + 1,
        maxLength: slots.length + 1,
      })
      .map((gaps) => {
        const out: ICUNode[] = [];
        for (let i = 0; i < slots.length; i++) {
          const lead = gaps[i];
          if (lead !== undefined) out.push(lead);
          out.push(slots[i]!);
        }
        const tail = gaps[slots.length];
        if (tail !== undefined) out.push(tail);
        return out;
      }),
  );
}
