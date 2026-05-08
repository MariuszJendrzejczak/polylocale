# Realworld ARB fixture

A trimmed slice of the [Flutter Gallery](https://github.com/flutter/gallery)
ARB localization files, used to sanity-check `parseArb` / `exportArb`
against keys that real Flutter apps actually ship.

## Source

- Repository: https://github.com/flutter/gallery (BSD-3-Clause)
- Path: `lib/l10n/intl_en.arb` and `lib/l10n/intl_pl.arb`
- Commit pinned for citation: `18f1e8e2d4b367b2bf24269110793ed1b33c770a`
  (2023-07-01)

## Modifications from upstream

- **Trimmed** to nine shared keys (`deselect`, `notSelected`, `select`,
  `selectable`, `selected`, `signIn`, `dismiss`, `cardsDemoExploreSemantics`,
  `cardsDemoShareSemantics`) so the fixture stays small. Both keys with
  placeholders kept.
- **Renamed** files from `intl_en.arb` / `intl_pl.arb` to `en.arb` / `pl.arb`
  so `detectLocaleFromFileName` resolves them without a Flutter-specific
  prefix-stripping convention. Upstream relies on Flutter's `arb-prefix`
  config which lives outside the file itself.
- **No** `@@locale` added — kept absent to exercise the filename-fallback
  path. Round-trip therefore introduces a synthesized `@@locale` line,
  so the realworld test asserts parse → export → parse deep-equality
  rather than byte identity.
- **No** other content edits — text, descriptions, and placeholder
  examples are verbatim from upstream.

## What this exercises

- `pl.arb` has no `@key` blocks at all (target-locale file pattern).
  Round-trip will add `@key` blocks on export because per-key metadata
  is model-wide; that asymmetry is documented in `ARCHITECTURE.md §2.2`.
- `placeholders` entries use only `example` (no `type`) — verifies the
  parser handles a partial `Placeholder` shape.
- Description strings include single quotes (`"Sign in label to sign into
website."`) which JSON itself doesn't care about but ICU's literal
  apostrophe rule does — exercises the `raw`-shortcut path that bypasses
  `renderICU` for unmodified imports.
