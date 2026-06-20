# design-sync notes — @polylocale/ui

Repo-specific gotchas for future syncs of this design system.

## Source shape

- Shape: `package` (no Storybook). Component list = PascalCase `.d.ts` exports of `@polylocale/ui`.
- Components: `StatusBadge`, `Table`.
- Styling: **CSS Modules** (`*.module.css`) + CSS-variable tokens with **inline fallbacks**
  (e.g. `var(--color-status-ok-bg, #e3f5e9)`). Because every token has a literal fallback,
  the components render fully styled with **no external tokens stylesheet** — there is no
  `cfg.cssEntry`/`cfg.tokensPkg`; the bundled `_ds_bundle.css` (from esbuild's auto
  `local-css` on `*.module.css`) is the only stylesheet, `@import`ed by `styles.css`.

## Build / bundle

- Bundle entry is the **source** `packages/ui/src/index.ts`, NOT the `tsc` dist:
  `tsc -b` does not copy `*.module.css` into `dist/`, so bundling from dist fails CSS
  resolution. esbuild bundles from source — it auto-applies `local-css` to `*.module.css`
  and rewrites `./X.js` → `./X.tsx` for TS importers (the repo's ESM `.js`-extension convention).
- `--node-modules` = `packages/ui/node_modules` (pnpm symlinks react + @tanstack there;
  repo root has no react).

## Known render warns

- None. The render check fired no warn lines for either component.

## Re-sync risks

- **`dtsPropsFor.Table` is a hand-written contract.** The ts-morph extractor drops
  `Table`'s `TRow` generic and emits an invalid `rows: readonly TRow[]` (TRow undefined,
  plus unresolved `TableColumn`/`SortingState`/`OnChangeFn`). The config override replaces
  it with a self-contained body using `unknown` for the row type. **If `TableProps`
  changes upstream, update `dtsPropsFor.Table` by hand** — otherwise the emitted
  `Table.d.ts` silently reverts to a broken contract.
- **Previews inline realistic data + a local `Entry` row shape.** `previews/Table.tsx`
  and `previews/StatusBadge.tsx` are tied to the current `StatusBadgeVariant` union and
  `TableColumn`/`TableProps` shape. Re-grade after any API change to `@polylocale/ui`.
- **Bundle entry is the source `packages/ui/src/index.ts`, not dist** — relies on esbuild
  auto-applying `local-css` to `*.module.css` and rewriting `./X.js`→`./X.tsx`. An esbuild
  major bump could change either; if styling vanishes or imports fail to resolve, check this first.
- **Render check toolchain:** used `playwright@1.60.0` → chromium build **1223** (was already
  cached under `~/.cache/ms-playwright`). On a fresh clone, install the `playwright` version
  whose `browsers.json` pins a cached chromium build into `.ds-sync` (or accept the ~200MB download).
- **No tokens stylesheet ships.** Theming relies entirely on CSS-var fallbacks baked into the
  component CSS. If `@polylocale/ui` later adds a real tokens/theme stylesheet, set
  `cfg.cssEntry`/`cfg.tokensPkg` so it ships too.
- **Not shown in previews (can't render statically):** controlled sorting
  (`sorting`/`onSortingChange`) and hover/focus states. Document-only if a reviewer asks.
