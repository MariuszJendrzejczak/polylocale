# CLAUDE.md

> Instructions for Claude Code (and any AI agent) working in this repo.
> For product context see [`PROJECT.md`](./PROJECT.md). For architecture and
> stack rationale see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## TL;DR

We're building **polylocale** — a client-only TypeScript SPA for managing
localization files (ARB, flat JSON, nested JSON) with AI-assisted translation.
The architecture is **parsers → internal model → exporters**. Each format is
independently testable. Round-trip must be lossless. ICU/placeholder
preservation is non-negotiable.

Repo is a **pnpm monorepo**: `packages/core`, `packages/ai`, `packages/ui`,
`apps/app`. UI never imports parsers directly — it works through the model.

---

## Stack at a glance

| Concern           | Choice                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Language          | TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)            |
| Frontend          | React 19 + Vite                                                                          |
| Persistence       | File System Access API (Chromium-first), IndexedDB cache, `<input type="file">` fallback |
| API key storage   | IndexedDB, AES-GCM-encrypted with user passphrase (WebCrypto)                            |
| ICU MessageFormat | Full structural IR (`ICUNode` tree); never store raw user text without an IR alongside   |
| Tests             | Vitest + fixtures + snapshots + property-based (fast-check) for parsers                  |
| Lint / format     | ESLint (flat config) + Prettier                                                          |
| Package manager   | pnpm workspaces (pnpm 11+)                                                               |
| Node              | 22+ (pnpm 11 uses `node:sqlite`)                                                         |

Full rationale lives in `ARCHITECTURE.md`.

---

## Repo layout

```
polylocale/
├─ apps/app/                Vite SPA, React entry
├─ packages/
│  ├─ core/                 Model + parsers + exporters (zero UI/AI deps)
│  ├─ ai/                   Provider abstraction + adapters
│  └─ ui/                   Reusable React components
├─ doc/BRIEF.md             Original kickoff brief — preserved verbatim
├─ PROJECT.md               Living product reference
├─ ARCHITECTURE.md          Architecture & stack decisions
├─ CLAUDE.md                This file
└─ .github/workflows/ci.yml Lint + typecheck + test on PR and push to main
```

### Inside `packages/core` (target shape)

```
packages/core/src/
├─ model/
│  ├─ types.ts              Internal data model (single source of truth)
│  └─ icu.ts                ICU IR node types
├─ parsers/
│  ├─ arb.ts                ARB → model
│  ├─ json-flat.ts          Flat JSON → model
│  └─ json-nested.ts        Nested JSON → model
├─ exporters/
│  ├─ arb.ts                Model → ARB
│  ├─ json-flat.ts          Model → flat JSON
│  └─ json-nested.ts        Model → nested JSON
├─ icu/                     ICU parse/render helpers (built on @formatjs/icu-messageformat-parser)
├─ locale/                  Locale code detection & normalization
└─ index.ts                 Public surface (re-exports)
```

Layout is aspirational — Session 1 only contains `model/`. New folders appear
as their first format is implemented.

---

## Layer rules (read carefully)

- **`core` knows nothing about UI, AI, storage, or the DOM.** It's pure
  TypeScript. If you're tempted to import React or `window` in `core` — stop.
- **`ai` knows about the model**, not about UI or about file formats. Its
  translate functions take and return `ICUNode[]`, never raw strings.
- **`ui` knows about the model and about React.** It must not import parsers
  or AI providers directly — it consumes them through services / hooks
  defined in `apps/app`.
- **`apps/app` is the composition root.** It wires storage + parsers +
  exporters + AI providers + UI. This is the only place where format strings
  meet provider keys.

If a change crosses these boundaries, that's a design decision — call it out
in the PR description, don't smuggle it.

---

## Commands

Run from the repo root unless noted.

```bash
pnpm install                # Install all workspaces
pnpm dev                    # Start the app (apps/app on Vite)
pnpm build                  # Build all packages
pnpm lint                   # ESLint over the whole monorepo
pnpm format                 # Prettier write
pnpm format:check           # Prettier check (CI uses this)
pnpm typecheck              # tsc -b on all references
pnpm test                   # Vitest run in every package
pnpm clean                  # Remove dist + tsbuildinfo
```

**Don't push without** `pnpm lint && pnpm typecheck && pnpm test` clean. CI
runs the same; failing CI is a blocker for merge.

---

## Adding a new format — checklist

When adding a new format (Phase 2: i18next, FormatJS; Phase 3: native):

1. **Parser** in `packages/core/src/parsers/<format>.ts`. File text → `LocalizationProject`
   (or merge into existing). Stash anything you can't model in `formatMetadata`.
2. **Exporter** in `packages/core/src/exporters/<format>.ts`. Model → file text.
   For every input it has seen, the output must round-trip.
3. **Round-trip test** in `packages/core/src/exporters/<format>.test.ts`:
   parse → export → parse → assert deep-equal. Snapshot the exported text.
4. **Property-based test** with `fast-check` — generate random valid inputs
   for that format, parse + export + parse, assert equivalence.
5. **Real-world fixtures** in `packages/core/fixtures/<format>/`:
   one tiny example, one realistic example, plus minimal repros for every
   bug you fix. File pairs as `<case>.in.<ext>` / `<case>.out.<ext>`.
6. **Edge case fixtures** for: ICU plurals/selects, nested ICU, escapes,
   empty values, missing keys, placeholder mismatches, BOM, CRLF, comments
   (where the format allows them).
7. **Locale detection** rules in `packages/core/src/locale/` if the format
   has format-specific naming conventions (`intl_pl.arb` etc.).
8. **`SupportedFormat` union** updated in `packages/core/src/model/types.ts`.
9. **Docs** — short section in `README.md`, longer rationale in `ARCHITECTURE.md`
   if the format introduces a new modeling decision.

A new format is **not done** until all of the above are green and CI is green.

---

## Coding conventions

- TypeScript strict, all public types `readonly` where possible, no `any`.
- Prefer `interface` for object shapes that may be extended; `type` for
  unions and aliases.
- Discriminated unions over enums for state (`KeyStatus`, `ICUNode.kind`).
- ESM everywhere — `"type": "module"` in every `package.json`. Imports use
  `.js` extensions (TS resolves them at build).
- Prefer pure functions in `core`. State lives in `apps/app`.
- Tests next to the code (`*.test.ts`), fixtures in `fixtures/`.
- Don't add error handling for things that can't happen. Trust internal
  callers; validate at boundaries (file IO, AI responses, user input).
- No comments that restate the code. Comments answer **why** when the why is
  non-obvious.

## Path aliases

Imports across packages use the workspace name, never relative paths:

```ts
import type { LocalizationProject } from '@polylocale/core';
import { translate } from '@polylocale/ai';
```

---

## Quality bar (do not lower)

- **Round-trip lossless.** If a fixture round-trips imperfectly, that's a
  bug, not a config option.
- **ICU/placeholder preservation.** Every parser ships with a test that
  proves placeholders survive an AI translation cycle in _both_ directions.
- **No silent data loss.** Unknown keys/sections in source files survive
  export via `formatMetadata`.
- **Determinism.** Exports must be byte-stable for the same model — order
  keys consistently, normalize whitespace, no timestamps in output.

---

## What's _not_ in this repo yet (and why)

Session 1 produced foundation only: docs, scaffold, internal model, CI.
**No parsers, no exporters, no UI components, no AI providers** yet — that
is Session 2 onward. The first parser+exporter pair is **flat JSON** because
it's the simplest and exercises the model end-to-end without ICU complexity.
ARB comes next (introduces ICU + `@key` metadata). Nested JSON after that.

---

## Working with humans

- The user is `MariuszJendrzejczak` — solo developer, this is a side
  project. Decisions get made in conversation, not by RFC.
- Polish is the working language for chat; **code, comments, and docs are
  English** so the project is contribution-friendly from day one.
- When in doubt about scope, default to "Phase 1 only". Ideas for Phase 2+
  go to `PROJECT.md` under the right phase, not into code.
