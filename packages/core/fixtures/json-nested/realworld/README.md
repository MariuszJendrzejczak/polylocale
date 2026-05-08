# Realworld nested-JSON fixture

A trimmed slice of the [Excalidraw](https://github.com/excalidraw/excalidraw)
i18next translation files, used to sanity-check `parseNestedJson` /
`exportNestedJson` against keys that a real production app actually
ships.

## Source

- Repository: https://github.com/excalidraw/excalidraw (MIT)
- Files: `packages/excalidraw/locales/en.json` and `packages/excalidraw/locales/de-DE.json`
- Commit pinned for citation: `b2b2815954f6561f0980bef8997750dabec16e87`
  (master at fixture-creation time)

## Modifications from upstream

- **Trimmed** to 14 shared keys split across two top-level sections
  (`buttons` and `labels`) so the fixture stays small.
- **Renamed** `de-DE.json` to `de.json` because
  `detectLocaleFromFileName` resolves `de.json` to the BCP-47 `de`
  locale; the upstream `de-DE` would normalize to `de-DE`, which is a
  legitimate but distinct locale code. Keeping the fixture at `de`
  matches our other realworld fixtures' naming convention.
- **No `{{...}}`-placeholder keys included.** Excalidraw uses i18next's
  `{{name}}` interpolation syntax, which is **not** ICU MessageFormat —
  `parseICU` would (correctly) reject those values. ICU coverage for
  nested JSON lives in the dedicated `mixed-icu/` fixture; this
  realworld file exists to verify plain-string round-trip on a real
  public file with realistic UTF-8 content (German umlauts).
- **Re-sorted** keys alphabetically at every level, both top-level and
  inside each section. Upstream files are not strictly alphabetical;
  the exporter is, so a byte-identical round-trip is only meaningful
  against a sorted source. The trim therefore captures the same
  _content_ as upstream while presenting it in the canonical exporter
  shape.
- **No** other content edits — translation strings are verbatim from
  upstream.

## What this exercises

- Real UTF-8 in nested-JSON values (German `ö`, `ü`, `ä`, `&`).
- Two top-level sections, each with several leaves — exercises the
  exporter's deep-sort at depth ≥ 2.
- Plain-string round-trip via the parser's `raw` shortcut: parse →
  export → byte-identical to the input.
