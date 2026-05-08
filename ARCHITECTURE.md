# ARCHITECTURE.md — polylocale

> Audience: contributors and future-us. This file explains _how_ the system
> is built and _why_ it's built that way. For _what_ we're building, see
> [`PROJECT.md`](./PROJECT.md). For agent / day-to-day rules, see
> [`CLAUDE.md`](./CLAUDE.md).

---

## 1. The three-layer model

```
   ┌──────────────┐   ┌────────────────────────┐   ┌──────────────┐
   │  Parsers     │ ─►│  Internal data model   │◄─ │  Exporters   │
   │  (per fmt)   │   │  (format-agnostic)     │   │  (per fmt)   │
   └──────────────┘   └─────────┬──────────────┘   └──────────────┘
                                │
                  ┌─────────────┴────────────┐
                  │                          │
              ┌───▼───┐                  ┌───▼───┐
              │  UI   │                  │  AI   │
              │ React │                  │ prov. │
              └───────┘                  └───────┘
```

Every file format has **its own parser and its own exporter**. The internal
model is the only thing UI and AI providers ever see. This means:

- A new format = parser + exporter + tests + fixtures. **No UI changes.**
- A new AI provider = adapter implementing the AI interface. **No format changes.**
- A UI redesign = React work. **No model changes.**

The price is one indirection (model) for every format. We pay it gladly.

---

## 2. Internal data model

The authoritative definition lives in
[`packages/core/src/model/types.ts`](./packages/core/src/model/types.ts).
Treat the snippet below as a mirror — when in doubt, the file wins.

```ts
export type LocaleCode = string; // BCP-47: 'en', 'pl-PL', 'zh-Hant'
export type SupportedFormat = 'arb' | 'json-flat' | 'json-nested';

export interface LocalizationProject {
  readonly id: ProjectId;
  readonly name: string;
  readonly locales: readonly LocaleCode[];
  readonly baseLocale: LocaleCode;
  readonly keys: readonly TranslationKey[];
  readonly files: readonly SourceFile[];
  readonly glossary?: readonly GlossaryEntry[];
  readonly settings: ProjectSettings;
}

export interface TranslationKey {
  readonly id: KeyId;
  readonly path: string; // 'home.title' or 'homeTitle'
  readonly values: Readonly<Record<LocaleCode, TranslationValue | undefined>>;
  readonly description?: string; // ARB @key.description
  readonly placeholders?: readonly Placeholder[];
  readonly status: KeyStatus;
}

export interface TranslationValue {
  readonly ir: ICUNode; // source of truth
  readonly raw?: string; // original import string (round-trip aid)
  readonly reviewed: boolean;
  readonly modifiedAt: number;
  readonly source?: 'manual' | 'ai' | 'imported';
  readonly aiProvider?: string;
}
```

### Why a full ICU IR (not raw strings)

The brief calls placeholder/ICU preservation **non-negotiable**. If a value is
just a string, every parser, exporter, and AI provider has to know how to
recognize and protect ICU spans — duplicated logic, easy to break.

We pay the cost of a structural IR once (`ICUNode` discriminated union) and
get three things for free:

1. **AI-safe by construction** — AI translation operates on `ICUNode[]`. It
   gets `text` nodes only; placeholders, plurals, and selects are opaque to
   the prompt. We re-assemble the tree on the way back.
2. **Format-agnostic exports** — exporter walks the IR and emits the right
   surface for ARB, JSON, or future formats. `{count, plural, ...}` becomes
   ARB's plural syntax verbatim, becomes ICU JSON, becomes whatever Phase 2+
   needs.
3. **Cheap diffing** — semantic diff between IR trees beats string diff for
   detecting "did the translation actually change anything meaningful".

Implementation leans on
[`@formatjs/icu-messageformat-parser`](https://www.npmjs.com/package/@formatjs/icu-messageformat-parser)
for the heavy lifting. The IR in `packages/core/src/model/icu.ts` is a thin,
internal-only shape so we are not coupled to formatjs's exact AST. The single
file allowed to import from `@formatjs/icu-messageformat-parser` is
`packages/core/src/icu/parse.ts`; the renderer (`render.ts`) is a pure walker
over our IR with no parser coupling.

#### Whitespace and idempotency

`renderICU(parseICU(s)) === s` is **not** guaranteed at the byte level.
`@formatjs` normalizes whitespace inside plural/select case lists, drops
location info, and our renderer applies its own canonical case ordering
(`=N` numeric ascending, then CLDR keyword order with `other` last).
Different surface, same meaning.

What we do hold is **double-round-trip stability** of the IR:

```
parseICU(renderICU(parseICU(s))) ≡ parseICU(s)
```

— round-tripping the IR through the renderer and back produces an
identical tree. This is exercised by
`packages/core/src/icu/round-trip.test.ts` and is the property AI
translation will rely on when comparing pre/post-translation messages.

Byte-exact round-trip for unmodified imports is provided separately by
the flat-JSON exporter's `raw` shortcut: parsers stash the original
string on every `TranslationValue`; the exporter emits that string
verbatim whenever `parseICU(raw) ≡ value.ir`. The shortcut misses (and
`renderICU` takes over) once UI or AI translation has actually edited
the IR. That trade keeps "no surprise rewrites" of files the user hasn't
touched, while still giving us a real renderer for everything else.

A subtle case: ICU's `#` placeholder inside a plural body (`PoundElement`)
is mapped to `Text('#')` in our IR — we don't carry a separate `pound`
variant. The text node renders as a bare `#` (no escaping) inside a
plural case, which `@formatjs` re-parses to `PoundElement` and we re-map
back to `Text('#')`. The two-step is a fixed point, so the IR stays
stable even though the surface representation flips between Pound and
literal-text on each side of the boundary.

### ARB-specific decisions

ARB (Application Resource Bundle, Flutter's native format) is the first
format that exercises every escape hatch in the model. Three decisions
worth pinning down before contributors stare at `parsers/arb.ts` and
`exporters/arb.ts`:

#### `@key` metadata splits across the model

Each `@foo` block on import gets dismantled three ways:

- `description` (string) → `TranslationKey.description`
- `placeholders` (object, name → `{ type?, example?, description? }`) →
  `TranslationKey.placeholders[]`
- everything else (`context`, `type`, vendor extensions, …) →
  `TranslationKey.keyMetadata` (verbatim, untyped)

The first two are the fields UI and AI providers actually consume. The
third exists so unknown fields survive round-trip without ballooning the
typed model. An empty `placeholders: {}` object on input parses to
`undefined` (and is omitted on export) — equal-meaning encodings collapse
to one canonical absence.

#### Per-key metadata is model-wide, not per-locale

When `app_en.arb` carries `@foo.description` and `app_pl.arb` carries no
`@foo` block at all (the typical "target locale file" pattern), the model
ends up with one shared `TranslationKey.description`. On export, **every**
locale file gains the description block. The `pl` round-trip is therefore
not byte-identical to the input — it grew metadata it didn't originally
have.

This trade-off is deliberate: it matches how Flutter's `gen-l10n` actually
produces target files (uniform `@key` shape across locales), keeps the
model honest (one description per key, not N), and respects the "no silent
data loss" rule (we **add** structure, never drop it). Per-file metadata
fidelity (different `@foo` blocks per locale) is a future concern; if
needed, it lands as a `keyBlocks` map under `SourceFile.formatMetadata`
without disturbing this layer.

#### `@@` keys survive in `formatMetadata` with insertion order

File-level keys (`@@locale`, `@@last_modified`, `@@x-author`, vendor
extensions) land in `SourceFile.formatMetadata.fileMeta` as a verbatim
map; their original position lands in `formatMetadata.fileMetaOrder` as a
parallel string array. The exporter replays that order on output. When
`@@locale` is absent on input, the exporter synthesizes it as the first
key from the locale argument — ARB tooling expects it, and the cost
(round-trip not byte-identical for files that omitted it) is bounded.

#### Export key order, in full

1. `@@`-keys, in `fileMetaOrder`, with `@@locale` synthesized at the
   front when missing. Anything in `fileMeta` that wasn't in
   `fileMetaOrder` (defensive only — the parser shouldn't produce this)
   trails alphabetically.
2. Translation keys, sorted alphabetically by `path`. Keys without a
   value for the requested locale are skipped (a missing translation is
   a missing line, not an empty string).
3. Each translation key `foo` is immediately followed by `@foo` whenever
   the model carries any of `description`, `placeholders`, or
   `keyMetadata`. The `@foo` block fields are written in canonical order:
   `description` first, `placeholders` second (omitted when empty), then
   `keyMetadata` fields in their captured insertion order.

The whole structure is built into a single object then handed to
`JSON.stringify(_, null, 2) + '\n'` — JS object insertion order carries
determinism through the encoder, no manual stringification needed.

### Why `formatMetadata` on `SourceFile`

We will encounter format quirks we don't model — ARB has `@@last_modified`,
file-level `@@x-author`, comment lines in some JSON setups. Exporters need to
emit those back unchanged on round-trip. Parsers stash anything they read but
do not interpret in `formatMetadata`. This is our **escape hatch against
silent data loss** without polluting the typed model.

### Why API keys live somewhere else

`ProjectSettings` deliberately has no field for API keys. Project files are
saved/exported/shared; keys are sensitive, encrypted, and per-machine. They
live in IndexedDB, AES-GCM-encrypted with a user passphrase via WebCrypto.
Keeping them out of the project model means a project file is always safe to
share / commit / open on another machine.

---

## 3. Stack decisions

Each decision below uses Decision / Context / Alternatives / Consequences.

### 3.1 React + Vite + TypeScript

- **Decision:** React 19 + Vite 6 + TypeScript (strict).
- **Context:** Client-only SPA. The user opens a folder via the File System
  Access API, edits in-app, exports back to disk. No SSR, no API routes, no
  SEO needs.
- **Alternatives considered:**
  - _SvelteKit:_ smaller bundle, better state ergonomics, but smaller
    ecosystem for the kind of complex tabular editor we'll build.
  - _Next.js:_ attractive for stack consistency with other projects, but
    every component would be `"use client"` (FS Access API is browser-only),
    losing Server Components / API routes / image pipeline — about 60% of
    Next.js's value goes unused. Vite is the lighter, more honest fit.
  - _Solid + Vite:_ best perf for very large tables (signals), but smaller
    component ecosystem.
- **Consequences:** Largest pool of contributors and libraries. Ecosystem
  spend is on rolling our own router-shaped concerns; we accept that.

### 3.2 Client-only, no backend

- **Decision:** No backend in Phase 1. AI calls go directly browser → provider.
- **Context:** Brief explicitly biases toward "client-only, no backend".
  Privacy: strings stay on the user's machine; AI calls use _user's_ keys.
- **Alternatives:** A thin Node/Bun proxy for AI rate-limit handling.
  Rejected: complicates self-hosting, requires server costs, defeats the
  privacy story. Reconsider only if a provider blocks browser-origin calls.
- **Consequences:** Self-hostable as a static site. Provider rate limits land
  on the user. We must handle CORS rejection gracefully (some providers may
  require a proxy in practice — that lands in a later session if needed).

### 3.3 File System Access API + IndexedDB cache + `<input>` fallback

- **Decision:** Default workflow uses File System Access API (`showDirectoryPicker`).
  IndexedDB caches project metadata, opened-file handles where the API
  supports persistence, and the encrypted API-key store. Firefox/Safari fall
  back to `<input type="file" multiple>` for import + download for export.
- **Context:** "Files-as-source-of-truth" is part of why developers will
  trust this tool. The FS Access API gives us native-app-feeling read/write
  in Chromium without bundling Electron.
- **Alternatives:** IndexedDB-only (works everywhere, but UX is worse —
  users must remember to export); FS Access API only (cuts off Firefox/
  Safari from day one).
- **Consequences:** Two code paths in the app shell — picker-based session
  for Chromium users, import/export for everyone else. The model layer is
  the same in both cases.

### 3.4 API key storage: IndexedDB + AES-GCM via passphrase

- **Decision:** Encrypted IndexedDB. WebCrypto AES-GCM with a key derived
  via PBKDF2 from a user passphrase. Passphrase prompted once per session.
- **Context:** Plain `localStorage` is readable by any script on the same
  origin and survives across sessions. We host as a static site — the
  attack surface is real (compromised CDN, hostile browser extension).
- **Alternatives:** Plain storage (rejected: too much exposure for keys
  that can rack up real charges); deferred to a desktop wrapper (rejected:
  it would block AI work indefinitely).
- **Consequences:** Adds a passphrase prompt to first AI use of a session.
  We accept the friction in exchange for safer defaults.

### 3.5 Monorepo via pnpm workspaces

- **Decision:** Monorepo. `packages/core`, `packages/ai`, `packages/ui`,
  `apps/app`. Internal references via `workspace:*`.
- **Context:** Phase 2 brings React/web formats. CLI / desktop wrappers
  may follow. All of these reuse `core` (and most reuse `ai`) without UI.
  Splitting now means `core` cannot accidentally grow a React import.
- **Alternatives:** Single package with folders. Rejected: makes the
  layer rules in `CLAUDE.md` more aspirational than enforced. The boundary
  between `core` and `ui` is a real one, and the `package.json` is what
  makes it real.
- **Consequences:** Slightly heavier setup. Worth it.

### 3.6 Vitest + fixtures + property-based with fast-check

- **Decision:** Vitest for unit and integration tests. Real-world and
  edge-case fixture files for parsers/exporters. `fast-check` for
  property-based round-trip checks per format.
- **Context:** Round-trip lossless is a quality bar, not a feature.
  Property-based testing finds the edge cases we wouldn't think to write.
- **Alternatives:** Jest (slower, less Vite-native); fixtures-only (catches
  what you imagine, misses what you don't).
- **Consequences:** New parsers must come with both a property generator
  and curated fixtures. The format-addition checklist enforces this.

### 3.7 ESLint flat config + Prettier

- **Decision:** ESLint 9 with flat config (`eslint.config.js`),
  `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-config-prettier`
  to disable rules that fight Prettier.
- **Alternatives:** Biome (fast, but smaller plugin ecosystem); oxlint
  (very fast, but younger and missing some rules we'll want).
- **Consequences:** Slowest of the three options, most familiar to
  contributors, most rules available.

### 3.8 AGPL-3.0-or-later

- **Decision:** AGPL-3.0-or-later. Final for Phase 1.
- **Context:** OSS friendliness + protection against closed-SaaS reuse.
  Door open for dual-licensing or open-core later.
- **Consequences:** Some companies avoid AGPL in their products —
  acceptable; this is a developer tool, not a library you embed.

### 3.9 Locale code normalization (BCP-47, hyphen-separated)

- **Decision:** All `LocaleCode` values inside the model are BCP-47 with a
  hyphen separator: language subtag lowercase, optional script subtag in
  title case (`Hant`), region subtag uppercase (`PL`) or kept verbatim if
  numeric (UN M.49: `419`). Parsers normalize at the file/folder boundary
  via `normalizeLocale` / `detectLocaleFromFileName` from
  `@polylocale/core`.
- **Context:** Real-world filenames mix conventions — `pl_PL.json` (Java
  / Flutter), `pl-PL.json` (web / BCP-47), `zh-Hant.json`,
  `EN-us.json`. The model needs one canonical form so equality, merge,
  diff, and UI all see the same string. BCP-47 is the lingua franca:
  HTML `lang`, browser APIs, ICU, and Flutter's locale resolution all
  understand it.
- **Alternatives considered:** Keep input verbatim and compare
  case-insensitively — rejected; turns equality into a function call
  everywhere and complicates `Record<LocaleCode, ...>` lookups.
- **Consequences:** Locale-bearing inputs go through `normalizeLocale`
  exactly once, at the parser. Exporters use the canonical form. When a
  Flutter project prefers underscore filenames (`pl_PL.arb`), that's a
  per-format _output_ concern handled in the exporter, not a model
  change.

---

## 4. AI translation flow (preview)

Designed in detail in a later session, but the shape is fixed by the model:

```ts
interface AIProvider {
  id: string;
  translate(input: {
    nodes: readonly ICUNode[];
    from: LocaleCode;
    to: LocaleCode;
    glossary?: readonly GlossaryEntry[];
    context?: { keyPath: string; description?: string };
  }): Promise<readonly ICUNode[]>;
}
```

The provider receives `ICUNode[]` and returns `ICUNode[]` of the same shape.
Internally each provider:

1. Walks the IR collecting `text` nodes.
2. Sends only the text to the model with masked placeholders if the model
   is text-only (DeepL, Google), or sends a structured prompt if the model
   is LLM-based (OpenAI, Anthropic).
3. Reassembles the IR with translated text nodes; placeholder, plural, and
   select structures are unchanged by construction.

This is why the IR exists. UI never sees this complexity.

---

## 5. Persistence flow (preview)

```
User clicks "Open project"
  ├─ Chromium: showDirectoryPicker() → DirectoryHandle (persisted in IndexedDB)
  └─ Other:    <input type="file" multiple> → File[] in memory

Loaded files
  └─ parsers/<format>.ts → LocalizationProject (in memory)

User edits / translates
  └─ React state holds the project; saves debounce to IndexedDB cache

User saves
  ├─ Chromium: write through the DirectoryHandle (real files updated)
  └─ Other:    download a ZIP of exported files
```

Project state (which files belong together, glossary, settings) saves to
IndexedDB next to the directory handle. Reopening the app picks up where
the user left off — without re-prompting for the directory in Chromium.

---

## 6. What lives where (cheat sheet)

| Concern                      | Lives in                                | Forbidden imports                     |
| ---------------------------- | --------------------------------------- | ------------------------------------- |
| Internal types & ICU IR      | `@polylocale/core` (model)              | nothing — pure                        |
| Parsers / exporters          | `@polylocale/core` (parsers, exporters) | UI, AI, DOM, Node                     |
| AI provider abstraction      | `@polylocale/ai`                        | UI, format files, DOM                 |
| AI provider adapters         | `@polylocale/ai`                        | UI, format files                      |
| Reusable React components    | `@polylocale/ui`                        | parsers, AI providers, file IO        |
| App shell, routing, services | `apps/app`                              | (composition root — wires everything) |
| Storage / crypto / key-store | `apps/app` (services)                   | format files                          |

When in doubt, ask: _"could this run in a Node test without a DOM?"_ If yes,
it belongs in `core` or `ai`. If no, it belongs in `ui` or `apps/app`.

---

## 7. Session-by-session roadmap

- **Session 1 (this one):** foundation. Docs, license, scaffold, internal
  model, CI. **No production code.**
- **Session 2:** flat JSON parser + exporter + round-trip tests + first
  property-based generator. Locale detection helpers (basic BCP-47).
- **Session 3:** ARB parser + exporter. Introduces ICU IR end-to-end and
  `@key` metadata handling.
- **Session 4:** nested JSON parser + exporter. Path-segmented keys.
- **Parallel:** UI tabular editor once the model is stable (TanStack Table
  is a strong candidate; decided in the UI session).
- **Parallel:** AI providers once one format works end-to-end. First
  adapter likely DeepL (simplest API surface) or OpenAI (most flexible
  prompt for structural protection).
- **Periodic:** dependency audits, refactor passes, architecture review.

Roadmap is a guide, not a contract. We adjust as we learn.
