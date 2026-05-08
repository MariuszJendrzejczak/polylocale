/**
 * fast-check generators for ARB-shaped {@link TranslationKey} extras.
 *
 * Companion to {@link arbitraryIcuNodes} from `icu/arbitrary.ts`. The
 * ICU generator handles message bodies; these generators add the
 * description / placeholders / keyMetadata that ARB layers on top, and
 * are used by `arb.property.test.ts` to fuzz round-trip lossless-ness.
 *
 * Identifier pools are deliberately tiny and disjoint from the field
 * names ARB reserves for itself (`description`, `placeholders`, `type`,
 * `example`). That keeps shrinking tractable and avoids accidental
 * collisions between keyMetadata fields and recognised metadata.
 */

import fc, { type Arbitrary } from 'fast-check';

import type { Placeholder } from '../model/types.js';

const PLACEHOLDER_NAME_POOL = ['count', 'name', 'value', 'item', 'amount'] as const;
const PLACEHOLDER_TYPE_POOL = ['String', 'int', 'double', 'num', 'DateTime'] as const;
const KEY_META_FIELD_POOL = ['context', 'screen', 'category', 'kind', 'tag'] as const;

const arbitrarySafeText: Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 12,
  unit: fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,-'.split(''),
  ),
});

export const arbitraryArbPlaceholder: Arbitrary<Placeholder> = fc
  .tuple(
    fc.constantFrom(...PLACEHOLDER_NAME_POOL),
    fc.option(fc.constantFrom(...PLACEHOLDER_TYPE_POOL), { nil: undefined }),
    fc.option(arbitrarySafeText, { nil: undefined }),
    fc.option(arbitrarySafeText, { nil: undefined }),
  )
  .map(
    ([name, type, example, description]): Placeholder => ({
      name,
      ...(type !== undefined ? { type } : {}),
      ...(example !== undefined ? { example } : {}),
      ...(description !== undefined ? { description } : {}),
    }),
  );

export const arbitraryArbPlaceholders: Arbitrary<readonly Placeholder[] | undefined> = fc.option(
  fc
    .uniqueArray(arbitraryArbPlaceholder, {
      minLength: 1,
      maxLength: 3,
      selector: (p) => p.name,
    })
    .map((arr): readonly Placeholder[] => arr),
  { nil: undefined },
);

const arbitraryKeyMetaValue: Arbitrary<unknown> = fc.oneof(
  arbitrarySafeText,
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
);

export const arbitraryArbKeyMetadata: Arbitrary<Readonly<Record<string, unknown>> | undefined> =
  fc.option(
    fc
      .uniqueArray(fc.tuple(fc.constantFrom(...KEY_META_FIELD_POOL), arbitraryKeyMetaValue), {
        minLength: 1,
        maxLength: 3,
        selector: ([field]) => field,
      })
      .map((entries) => Object.fromEntries(entries) as Readonly<Record<string, unknown>>),
    { nil: undefined },
  );

export const arbitraryArbDescription: Arbitrary<string | undefined> = fc.option(arbitrarySafeText, {
  nil: undefined,
});
