# Polylocale UI — how to build with this design system

A small, focused React component set from `@polylocale/ui`, used to build the
Polylocale localization editor (a grid of localization keys with AI-assisted
translation). Two components today: **Table** and **StatusBadge**.

## Setup & wrapping

- **No provider, no theme context.** Components render correctly on their own —
  just import and use them. There is nothing to wrap your app in.
- The only global is the stylesheet: `styles.css` (which `@import`s
  `_ds_bundle.css`) must be loaded. It carries all component styling.
- Components import from the bundle global `window.PolylocaleUI` — `PolylocaleUI.Table`,
  `PolylocaleUI.StatusBadge`.

## Styling idiom — CSS custom properties with built-in fallbacks

This DS has **no utility classes and no style props.** Each component styles
itself internally (CSS Modules). You do **not** pass `className`/`style` to theme
them, and there is no class vocabulary to memorize for the components themselves.

Theming is done by **defining CSS custom properties on an ancestor element.**
Every token has a sensible light-theme fallback baked in, so overriding is optional.
The themeable variables (set them on a wrapper to retheme):

| Group | Variables |
|---|---|
| Surfaces | `--color-bg`, `--color-bg-header`, `--color-bg-hover`, `--color-border`, `--color-focus` |
| Text | `--color-text-muted`, `--font-size-xs`, `--font-size-sm`, `--font-size-md` |
| Layout | `--cell-padding-x` |
| Status badge colors (`-bg`/`-fg` pairs) | `--color-status-ok-*`, `--color-status-missing-*`, `--color-status-review-*`, `--color-status-mismatch-*`, `--color-status-empty-*`, `--color-status-modified-*` |

```css
/* Optional: retheme by defining tokens on a container */
.my-editor { --color-bg: #fff; --color-border: #e3e3e6; --color-status-ok-bg: #e3f5e9; }
```

For **your own layout glue** (the wrappers/spacing around DS components) write
plain CSS — there is no preset to draw from.

## Where the truth lives

- Component styles: `_ds_bundle.css` (reachable via `styles.css`).
- Per-component API + usage: `components/general/<Name>/<Name>.d.ts` and
  `<Name>.prompt.md`. Read these before composing — `Table` is generic over its
  row type and driven entirely by `columns` + `rowKey`.

## Component notes

- **Table** is a virtualized, optionally-sortable data grid. It is **generic over the
  row type**: you pass `rows`, `columns` (each with `id`, `header`, a `cell(row)`
  renderer, optional `width`/`minWidth`, and optional `sortBy` to make it sortable),
  and `rowKey(row)`. It fills its parent's height — **give it a sized container**
  (e.g. `height: 320px`), otherwise it collapses. Use `emptyState` for the no-rows case.
- **StatusBadge** is an inline pill for key/value status: `variant` is one of
  `ok | missing | needs-review | placeholder-mismatch | empty | modified`. It has a
  default label per variant; pass `children` to override (e.g. a count).

## Idiomatic example

```tsx
const columns = [
  { id: 'key', header: 'Key', width: 240, sortBy: r => r.key,
    cell: r => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{r.key}</span> },
  { id: 'en', header: 'English', minWidth: 240, sortBy: r => r.en, cell: r => r.en },
  { id: 'status', header: 'Status', width: 150,
    cell: r => <StatusBadge variant={r.status} /> },
];

<div style={{ height: 320 }}>
  <Table rows={rows} columns={columns} rowKey={r => r.id}
         emptyState="No keys match the current filter." />
</div>
```
