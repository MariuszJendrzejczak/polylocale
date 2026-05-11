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

### Structural equality vs byte equality of the IR

Two equality predicates live next to each other in
`packages/core/src/icu/` and answer different questions about the same
`ICUNode[]` shape.

- **`icuEqual(a, b)`** — byte-identical IR. Same node order, same text
  values, same placeholder types and formats, same plural offsets, same
  case-key sets and bodies. Used by the flat-JSON exporter's `raw`
  shortcut (skip the renderer when the parsed IR is byte-identical to
  the imported one) and by the round-trip property tests in
  `icu/round-trip.test.ts` (`parseICU(renderICU(parseICU(s)))` ≡
  `parseICU(s)`).
- **`icuStructuralEqual(a, b)`** — same _skeleton_, text content
  ignored. Placeholder _names_, plural/select arg names, plural offsets,
  case-key sets, and tag names must match exactly; text values, and
  placeholder `type`/`format` modifiers, are not compared. Used by the
  diff view to surface keys whose underlying message changed between
  two locales (placeholder renamed, plural case dropped, tag swapped) —
  a positive result is the precondition for "AI translation of A is a
  legal translation of B" because the non-text structure is what the
  masking primitive in `packages/ai/src/icu-walk.ts` preserves across
  the network call.

If we later want a stricter "skeleton including placeholder type" check
(say, for a "did the formatter change" inspector), it lands as a third
predicate next to these two rather than tightening either one.

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

### Path representation (flat ↔ nested JSON)

`TranslationKey.path` is dot-segmented inside the model: `home.title`,
not `home/title`, not a `string[]`. ARB and flat JSON keys map straight
through (no separator interpretation); nested JSON's parser flattens the
object tree on import and the exporter re-nests on export by splitting
the path on `.`.

The dot is therefore reserved as a **structural** character. Three
consequences fall out:

#### Nested JSON cannot carry a literal dot in a key

`parseNestedJson` rejects any object key segment containing `.` —
`{ "app.v1.title": "…" }` is ambiguous (one key with a literal dot, or
three nesting levels?), and we'd rather refuse than guess. Flat JSON has
no such restriction: `app.v1.title` is a single legal flat key whose
model `path` happens to look 3-level. The model itself doesn't care;
only nested JSON does.

#### Flat ↔ nested are interchangeable views — with one exception

The same `LocalizationProject` exports cleanly to either form **provided
no path is a strict prefix of another**. If the model holds both `home`
(leaf) and `home.title` (leaf), nested JSON cannot represent both: the
object position `home` would have to be both a string and a parent.
`exportNestedJson` throws naming both paths rather than dropping either
— consistent with the no-silent-data-loss rule. Flat JSON has no such
restriction.

In practice, prefix-collisions only arise when projects mix formats
carelessly: a flat JSON file with a key `home` plus a nested JSON file
with a `home.title` leaf, composed into the same project. The exporter
catches it; the model itself is happy to hold the data.

#### Flat-imported `app.v1.title` round-trips through nested as a tree

A flat JSON file with key `app.v1.title` parses to `path: 'app.v1.title'`.
Re-exporting that project as **nested** JSON produces
`{ "app": { "v1": { "title": "…" } } }`. Re-importing that nested file
yields the same model `path`. The surface representation flipped; the
model is byte-identical. This is the contract of choosing a format —
nested JSON's path-shape is **structural**, flat JSON's is **opaque**,
and the model is always the latter.

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

### 3.10 Encrypted secret store (apps/app)

- **Decision:** API keys for AI providers live in an IndexedDB-backed
  store at `apps/app/src/services/secret-store.ts`. They are encrypted
  at rest with AES-GCM (256-bit) under a key derived from a user
  passphrase via PBKDF2-SHA256, 600 000 iterations. Each ciphertext is
  bound to its slot name through AES-GCM Additional Authenticated Data,
  so a blob swapped between slots fails to decrypt.
- **Context:** §3.4 sets the policy ("encrypted IndexedDB, passphrase
  per session"); this is the implementation. PBKDF2 iteration count
  follows the OWASP 2023 baseline. AAD-binding the slot name closes a
  small but real attack: anyone who can write to the user's IndexedDB
  (a hostile browser extension, the devtools console) could otherwise
  rename a known-good ciphertext over a target slot and have it
  transparently decrypt.
- **Lifecycle:** `unlock(passphrase)` derives the key. On the first
  call ever it generates a fresh salt and a sentinel verifier
  ciphertext; every subsequent `unlock` re-derives the key and
  decrypts the verifier — wrong passphrase → `InvalidPassphraseError`.
  `set` / `get` / `delete` / `list` require an unlocked store.
  `lock()` drops the in-memory `CryptoKey`; the IDB blobs stay, the
  next `unlock` rebuilds the key from the stored salt.
- **Passphrase rotation:** `changePassphrase(old, new)` runs in three
  phases. (1) Verify `old` against the stored verifier (same path as
  `unlock`; wrong passphrase → `InvalidPassphraseError`, IDB
  untouched). (2) Read every slot record and decrypt its ciphertext
  in memory under the old key; any decrypt failure (e.g. an
  AAD-bound blob someone tampered with) throws before any write
  opens, so the IDB state is preserved exactly. (3) Generate a fresh
  salt, derive a new `CryptoKey` from `new`, encrypt a fresh
  verifier and one fresh ciphertext per slot, then commit the new
  meta record together with the full set of re-encrypted slot
  records inside a **single** readwrite transaction spanning both
  object stores. Browsers roll the transaction back atomically on
  any commit error, so partial-rotation states are not observable.
  On success the in-memory `CryptoKey` is swapped to the new one;
  the store stays unlocked under `new`.
- **Testability:** the factory takes `IDBFactory` and `Crypto` as
  options. Tests substitute `fake-indexeddb`; production uses
  `globalThis.indexedDB` and `globalThis.crypto`. Node 22 ships
  WebCrypto natively, so the test runner needs no DOM environment.
- **Consequences:** PBKDF2 at 600k iterations costs ~300–500 ms per
  unlock on commodity hardware. Acceptable: it happens once per
  session and the cost is what makes a stolen ciphertext blob
  expensive to brute-force. If we ever measure the unlock as a UX
  problem we revisit the iteration count rather than the algorithm.

---

## 4. AI translation flow

Settled in session 5a. The interface is:

```ts
interface AIProvider {
  readonly id: string;
  translate(input: {
    readonly nodes: readonly ICUNode[];
    readonly from: LocaleCode;
    readonly to: LocaleCode;
    readonly glossary?: readonly GlossaryEntry[];
    readonly context?: { readonly keyPath: string; readonly description?: string };
  }): Promise<readonly ICUNode[]>;
}
```

The shared masking primitive is `collectTextNodes(nodes)` in
`packages/ai/src/icu-walk.ts`. It returns the ordered list of every
`ICUText.value` in the tree (depth-first across plural / select /
selectordinal cases and tag children) plus a `reassemble(translated)`
callback. Whatever the provider does between those two steps, the
non-text structure is unbreakable: placeholders, plural offsets, case
keys (`one`, `=0`, …), tag names — all preserved by construction.

### 4.1 DeepL adapter

`createDeepLProvider({ apiKey, endpoint?, fetch? })` posts to DeepL's
JSON `/v2/translate`. Free vs Pro is auto-routed by the `:fx` API-key
suffix; passing `endpoint` overrides the default for proxy
deployments. The body sets `preserve_formatting: true` (capitalization
and trailing whitespace matter for fragments around placeholders) and
omits `tag_handling`, so DeepL treats fragments as plain text rather
than guessing at XML.

Only collected text fragments hit the wire. ICU placeholders, plural
selectors, etc. are never serialized into the request — they live only
in the surrounding IR that the adapter walks before and after the
network call. If a tree carries no text at all (`{name}` only) the
adapter returns the input unchanged without making a request.

**Glossary and context** are accepted on the request shape but not
yet sent. DeepL has a separate `/v2/glossaries` flow; wiring it in is
a follow-up session that doesn't touch the `AIProvider` surface.

### 4.2 BCP-47 ↔ DeepL locale mapping

DeepL distinguishes a number of regional / scripted target locales —
EN-US vs EN-GB, PT-BR vs PT-PT, ZH-HANS vs ZH-HANT, ES-419 — and a
shorter, region-free source list. The mapper in
`packages/ai/src/deepl-locales.ts` resolves a model `LocaleCode` to
the right DeepL code, falling back from region+language to language
alone (`pl-PL` → `PL`), and from generic to a regional default for
the two cases DeepL deprecates as targets (`en` → `EN-US`, `pt` →
`PT-PT`). Unsupported locales throw `UnsupportedLocaleError` so the
UI can show an actionable message instead of an HTTP 400.

### 4.3 CORS and the same-origin proxy

DeepL does not return CORS headers, so a browser request from the app
origin to `api-free.deepl.com` is blocked at preflight. The deployment
shape is therefore **never direct**:

- **Dev:** Vite's dev server proxies `/api/deepl/*` to the configured
  upstream. The default upstream is the Free tier; setting
  `DEEPL_API_TARGET=https://api.deepl.com` in `apps/app/.env.local`
  switches it to Pro. The provider receives `endpoint:
'/api/deepl/v2/translate'` so the same code path works in dev and
  in tests (tests pass an injected `fetch`).
- **Production:** any deployment serving the SPA needs its own
  same-origin proxy (Cloudflare Worker, nginx, …) with the same
  `/api/deepl/*` shape. Self-hosting documentation will cover this in
  the deployment guide; the adapter does not change.
- **Node / CLI:** no proxy needed — pass DeepL's real URL as
  `endpoint` and the runtime's global `fetch` reaches it directly.

### 4.4 LLM providers

The interface is identical for LLM-backed providers — they too
receive `ICUNode[]` and return `ICUNode[]`. The masking strategy is
shared via `packages/ai/src/llm-translate.ts`; see §4.6 for the JSON
fragment-prompt contract, the `LLMResponseError` shape, and the
per-call cap that keeps individual prompts within token budgets.
`context.description` and `glossary` are now actually used by the LLM
adapters (the DeepL adapter wires `glossary` through its own
`/v2/glossaries` flow — see §4.7).

### 4.5 AI in the editor

`apps/app` plugs the §4 provider surface into the tabular editor with
three entry points (per-cell ✦, per-row "⋯ Translate missing
locales", per-locale "Fill missing for…") and one hard rule:
**nothing lands in the model that the user has not explicitly
approved**.

#### Where the API keys live

Each provider has its own slot in the encrypted secret store from
§3.10:

- DeepL → `'deepl-api-key'`
- OpenAI → `'openai-api-key'`
- Anthropic → `'anthropic-api-key'`

The slot map and per-provider factories live in
`apps/app/src/services/ai-provider-host.ts`; call sites pass a
`ProviderId` (`'deepl' | 'openai' | 'anthropic'`) to
`getProvider(id)` and the host walks the right slot, prompts for the
right label, and caches per-id. The project file never carries any
key (`ProjectSettings` has no field for keys on purpose) — a `.json`
/ `.arb` the user opens or commits is always safe to share.
Day-to-day inspection and rotation of those slots — and of the
passphrase that protects them — lives in the Settings modal
(`apps/app/src/views/SettingsModal.tsx`), reached from the topbar.

Default and per-locale provider choice live in
`ProjectSettings.aiProviderPrefs` (`{ default?, perLocale? }`). The
editor reads `prefs.perLocale[locale] ?? prefs.default ?? 'deepl'`
when picking the provider for a translation; the topbar dropdown
writes `prefs.default`, and reducer action `setAiProviderPref` is the
single mutation point.

`apps/app/src/services/ai-provider-host.ts` is the lazy host:
`getProvider()` first ensures the secret store is unlocked
(`requestUnlock` gate → passphrase modal), then ensures the slot has
a value (`requestApiKey` gate → key modal), then caches a
`createDeepLProvider` instance against that key. Cancelling either
gate returns `null` cleanly so the calling action no-ops without a
banner. The default endpoint is `/api/deepl/v2/translate` so the
Vite dev proxy and any production same-origin proxy take over CORS
(see §4.3) — adapter signature unchanged.

#### End-to-end masking

The editor never serializes ICU structure into a request body. It
hands `value.ir` straight to `provider.translate()` and stores the
returned `ICUNode[]` straight back. `collectTextNodes` (§4) does the
masking inside the provider; the editor's only contribution is to
respect the contract — _no `parseICU(translatedString)` round-trip
on the way back_. Whatever IR the provider returns is what lands in
the model, which keeps the placeholders/plurals/selects unbreakable
by construction.

When the base IR carries no translatable text at all (e.g.
`{name}` only), the orchestrator (and the per-cell ✦ button) treat
it as `'skipped-empty'` _before_ the network call. The UI does not
show a fake "translation suggested" state in that case.

#### Concurrency

Batch flows go through `apps/app/src/services/translate-orchestrator.ts`,
which limits concurrent in-flight calls to a default of **3** (rolled
by hand, no extra dep). Outcomes are returned in input order even
though jobs run concurrently, so the review modal renders rows in a
stable shape. The orchestrator catches every failure into a
structured `TranslationOutcome.status` (`'ready'`, `'skipped-empty'`,
`'skipped-unsupported'`, `'error'`) and never throws — the caller
gets one outcome per input job, always.

Each batch carries an `AbortSignal`. Cancelling the running modal
aborts the orchestrator: not-yet-started jobs short-circuit to
`'error'` (with `aborted` as the message), in-flight jobs are
allowed to finish, and the editor dispatches a `translationClear`
for every job in the batch. The model never holds half-applied state
because nothing was applied yet — `setValuesBatch` only fires from
the review-modal Apply path.

#### Review-before-apply fits "no silent data loss"

Per-cell ✦ shows a small popover anchored to the cell with `before`
(rendered base text) and `after` (rendered suggestion); the user
clicks Accept to dispatch `setValue` (`source: 'ai'`,
`aiProvider: 'deepl'`), or Discard / Esc / click-outside to drop the
suggestion. Per-row and per-locale flows funnel into a single
`BatchTranslateModal` whose checkbox per row defaults to _checked
for ready outcomes only_; skipped/errored rows render with a reason
and no checkbox. "Apply selected" lands every checked outcome
through one `setValuesBatch` dispatch.

Failures live in `pendingTranslations` (a `ReadonlyMap<string,
'pending' | { error }>` keyed by `${keyId}:${locale}`) — visible UI
state, never `project.keys`. A second click on a still-`'pending'`
cell is a no-op; an error entry stays visible (red border, tooltip)
until the user dismisses it. This satisfies PROJECT.md's "no silent
data loss" quality bar end-to-end: the user sees what would land,
chooses what lands, and the model reflects only what they accepted.

#### `UnsupportedLocaleError`

Thrown by the DeepL adapter when the BCP-47 locale resolves to no
DeepL code (e.g. `mt-MT`). The orchestrator catches it into
`'skipped-unsupported'`; the batch modal renders the row with the
exact message ("deepl: target locale "mt-MT" is not supported by
this provider") and no checkbox. The per-cell popover renders the
same message in a soft-error style (Close only) instead of dispatching
a banner — the user can pick a different target locale and try
again.

#### Glossary flow

`project.glossary` lives at the project level and is editable from a
modal reachable via the topbar 📖 Glossary button
(`apps/app/src/views/GlossaryModal.tsx`). Edits dispatch
`addGlossaryEntry` / `updateGlossaryEntry` / `removeGlossaryEntry`
on the reducer, which mutate `state.project.glossary` immutably and
**do not** touch `state.dirty` — glossary is a project-level concern,
not a per-key edit. The modal persists across reloads through
`EditorMeta.glossary` (`apps/app/src/services/persistence.ts`); the
sibling project-file option is left for the day a real `.polylocale`
file lands.

Every translation site forwards the current glossary to
`provider.translate({ glossary })`:

- per-cell ✦ — `AiCellAction` receives a `glossary?` prop from the
  column factory and attaches it to the request,
- per-row "Translate missing locales" and per-locale "Fill missing
  for…" — `jobsForRow` / `jobsForLocale` write the glossary onto each
  `TranslationJob`, and `runOne` forwards it.

DeepL turns the glossary into a `/v2/glossaries` lookup (§4.7). The
LLM helper appends glossary entries as advisory hints inside the
system prompt (§4.6). The wire was live since Session 8 — the editor
side that finally feeds it landed in Session 10.

### 4.6 LLM masking strategy

LLM-backed providers (OpenAI, Anthropic) all share
`packages/ai/src/llm-translate.ts`. The flow:

1. The adapter calls `collectTextNodes(nodes)` — same primitive DeepL
   uses, no special path.
2. The shared helper builds two prompts:
   - **System** (fixed instruction): "You will receive a JSON object
     `{from, to, fragments}`. Translate every element of `fragments`
     from `from` to `to`. Return a single JSON object
     `{translations: string[]}` of identical length and order.
     Preserve leading and trailing whitespace verbatim. Never add,
     remove, merge, or split fragments. If a fragment is purely
     whitespace or punctuation, return it unchanged. Do not output
     any text outside the JSON object." Glossary entries (the ones
     whose `perLocale[to]` is set) and `context.{keyPath, description}`
     are appended as advisory hints.
   - **User**: the literal JSON `{from, to, fragments}`.
3. The adapter's provider-specific `chat` callable posts those to the
   provider's API and returns the assistant's text response.
4. The helper parses, validates `translations` is a string array of
   the exact requested length, and on any mismatch throws
   `LLMResponseError` (provider id + reason + truncated response
   body). Strict JSON mode (OpenAI's `response_format: {type:
'json_schema', strict: true}`; Anthropic's instruction-only
   contract) is best-effort, not a guarantee — the helper validates
   regardless.

**Per-call cap.** `MAX_FRAGMENTS_PER_CALL = 100`. Above the cap, the
helper splits the fragment list into chunks, runs them sequentially
through the same `chat` callable, and stitches the results in input
order. The cap is invisible to callers — one input IR still produces
one output IR. The cap exists to keep prompts within reasonable
token budgets even for pathological keys (a `select` with hundreds of
text fragments across cases). Cross-key batching would change the
`AIProvider` signature and is intentionally out of scope; the
`runTranslations` orchestrator already runs 3 jobs in parallel,
which gives most of the throughput win without the API churn.

**Default models** (current as of 2026-05-10):

- OpenAI: `gpt-4o-mini`. Stable, available across account tiers,
  cheapest GPT-4-class model. Override via `model` if your account
  has access to a cheaper variant (e.g. GPT-5 mini).
- Anthropic: `claude-haiku-4-5-20251001`. Pinned (not the rolling
  alias) so future refreshes are deliberate. Brief explicitly
  recommends Haiku for speed/cost.

When refreshing models, also refresh this date.

**CORS.** Both providers return CORS headers (Anthropic gates on the
`anthropic-dangerous-direct-browser-access: true` header, which the
adapter sends unconditionally). No same-origin proxy needed in dev.
DeepL is the only provider that requires the proxy from §4.3.

### 4.7 DeepL glossary mapping

`createDeepLGlossaryService` (`packages/ai/src/deepl-glossary.ts`)
turns the model's `GlossaryEntry[]` into a DeepL glossary id usable
on `/v2/translate`. The DeepL adapter calls it lazily — only when
`request.glossary` is non-empty. Flow per `(from, to)`:

1. **Filter** entries to those with a usable `perLocale[to]` mapping
   (either a non-empty `translation` or `doNotTranslate: true`,
   which becomes a same-source-as-target pair). No usable entries →
   return `undefined`, the adapter posts `/v2/translate` without a
   glossary.
2. **Language-pair check.** `GET /v2/glossary-language-pairs` is
   fetched once per service instance and cached. If the
   `(EN, PL)`-style DeepL pair (region-stripped) isn't listed →
   return `undefined`. Translation still happens, just without
   glossary semantics — silent skip is the right call here because
   "DeepL doesn't have glossaries for Maltese" isn't an error
   condition the user can fix.
3. **Cache key.** `sha256(apiKey + ' ' + dlSource + ' ' + dlTarget +
' ' + tsv)`, where `tsv` is the deterministic TSV body
   (entries sorted by source term, tabs/newlines stripped from
   values). The first 16 hex chars become the glossary's
   deterministic name (`polylocale:<short-hash>`).
4. **Lookup.** `GET /v2/glossaries`; if a glossary with that exact
   name and matching `(source_lang, target_lang)` exists → reuse
   its `glossary_id`.
5. **Create** otherwise: `POST /v2/glossaries` with `{name,
source_lang, target_lang, entries: tsv, entries_format: 'tsv'}`,
   cache the returned id.

The cache is in-memory per service instance; subsequent translations
for the same `(from, to, glossary content)` short-circuit at step 3.
DeepL's glossary endpoint accepts only the bare ISO-639-1 code
(`EN`, `PT`); the region (`EN-US`, `PT-BR`) is stripped for
glossary use but kept verbatim for `/v2/translate`. The adapter
passes `glossary_id` only when `ensure` returns one — otherwise the
field is omitted.

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
- **Session 4 (done):** nested JSON parser + exporter. Path-segmented
  keys, prefix-collision handling, cross-format equivalence with flat
  JSON.
- **Session 5a (done):** `AIProvider` interface, `collectTextNodes`
  masking primitive, DeepL adapter, BCP-47 ↔ DeepL locale mapping,
  encrypted secret store in `apps/app`, Vite dev proxy for CORS.
- **Parallel:** UI tabular editor once the model is stable (TanStack Table
  is a strong candidate; decided in the UI session).
- **Parallel:** further AI providers (LLM-backed translators, DeepL
  glossary integration) on top of the now-settled provider surface.
- **Periodic:** dependency audits, refactor passes, architecture review.

Roadmap is a guide, not a contract. We adjust as we learn.
