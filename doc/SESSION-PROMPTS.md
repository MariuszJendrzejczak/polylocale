# Session prompts — polylocale

Each section below is a **standalone prompt** to paste into a fresh
Claude Code session in this repo. Run sessions sequentially; each one
ends with green CI before you close it and start the next.

> Why separate sessions instead of one long thread or Team Agents?
> A fresh session starts with an empty context window. `CLAUDE.md`,
> `PROJECT.md`, `ARCHITECTURE.md` re-load cheaply (prompt cache), and
> nothing carries over from the previous session except what's committed
> to the repo. For iterative implementation work this is usually the
> cheapest option.

---

## Status snapshot

What's been built so far (verify with `git log --oneline`):

- ✅ **Session 1** — foundation, scaffold, docs, license, CI.
- ✅ **Session 2** — locale detection (BCP-47), `composeProject`, flat
  JSON parser+exporter, ICU IR (parse/render/equal) integrated with flat
  JSON, fast-check property-based round-trip tests.
- ✅ **Session 3** — ARB parser+exporter with `@key` metadata blocks
  and `@@`-keys, deterministic export ordering, full property-based
  testing.
- ✅ **Session 4** — nested JSON parser+exporter; flat ↔ nested
  cross-format equivalence; prefix-collision detection.
- ✅ **Session 5a** — `AIProvider` interface + DeepL adapter +
  BCP-47 ↔ DeepL locale mapping + encrypted secret store
  (AES-GCM/PBKDF2 in IndexedDB) + Vite dev proxy for CORS.
- ✅ **Session 5b** — tabular editor skeleton in `apps/app`: generic
  virtualized `<Table>` in `packages/ui` (TanStack Table + Virtual),
  `file-system` service (FS Access API + `<input>` fallback,
  nested-then-flat JSON detection), IDB-cached directory handle with
  permission re-prompt on reload, inline cell editor (re-parses ICU on
  commit), per-cell status badges, manual save-back to disk through the
  exporter.

What's next: **session 6 (AI in the editor)**, **session 7 (editor UX:
search + key add/remove/rename + sort)**, **session 8 (more AI
providers + DeepL glossary)**.

---

## Session 6 — AI translate inside the editor

The editor opens a folder, edits and saves files. The DeepL adapter
exists in `packages/ai` but nothing in `apps/app` calls it yet. This
session connects the two: the user supplies a DeepL API key (kept in
the encrypted secret store), then translates one cell, one row, or
every missing value for a locale, with a review step before changes
land in the model.

**Paste into a new Claude Code session in `polylocale`:**

```
Session 6 — AI translate inside the editor.

Read CLAUDE.md, PROJECT.md, ARCHITECTURE.md. Check `git log --oneline`
— DeepL adapter, BCP-47 ↔ DeepL mapping, encrypted secret store, the
tabular editor (FS Access + inline edit + save-back), and the
`/api/deepl` Vite dev proxy are all on main. Start in plan mode.

Goal: translate cells / rows / missing-for-a-locale via DeepL from
inside the editor. ICU IR is preserved by `collectTextNodes` already;
placeholders, plurals and selects must come back intact. The user must
review and approve before changes land in the model.

Decide upfront (in plan mode):
- API-key UI: dedicated settings panel vs. inline prompt on first
  translate. Lean toward inline-on-demand for v1.
- Provider selection: hard-code DeepL for v1 (only adapter we have)
  vs. provider dropdown that's just one option today. Latter sets up
  Session 8 cleanly.
- Review-before-apply UX: per-cell preview-and-confirm vs. batch
  modal showing the full before/after diff. Brief flags batch +
  review step as the must-have.

Scope:
1. `apps/app/src/services/ai-provider-host.ts` — wires
   `createDeepLProvider` from `@polylocale/ai` to a fixed slot
   ('deepl-api-key') in the secret store. Surface:
   `getProvider(): Promise<AIProvider | null>` that ensures the
   store is unlocked and a key is present, returning null when the
   user cancels either prompt.

2. `apps/app/src/views/PassphrasePrompt.tsx` — modal that unlocks
   the secret store on first AI call of the session. ESC dismisses;
   wrong passphrase shows inline error and stays open.

3. `apps/app/src/views/ApiKeyPrompt.tsx` — modal that asks for a
   DeepL key when the slot is empty. Stores via `secretStore.set`.

4. Per-cell translate: a small ✦ button on missing/empty cells.
   Click → fetch from base locale → open inline preview popover →
   user accepts → dispatch `setValue` with `source: 'ai'`,
   `aiProvider: 'deepl'`.

5. Per-row translate: row context-menu "Translate missing" — fills
   every locale where this key has no value.

6. Fill-missing-for-locale: top-bar action that takes a target
   locale (column dropdown), iterates missing/empty keys, queues
   DeepL calls with a small concurrency limit (3 in flight), shows
   a review modal listing all proposed translations as checkable
   rows; "Apply selected" lands them in the model in a single
   batch dispatch.

7. Loading / error UX: per-pending-cell spinner + dimmed value;
   request failures show inline as a red border + tooltip without
   dispatching, so the model never holds invalid IR. AbortError
   rolls back the pending entry.

8. State extension in `editor-state.ts`: `pendingTranslations`
   (Map<keyId+locale, 'pending' | 'error'>), and a `setValuesBatch`
   action so the review modal applies N translations in one tick.

9. ARCHITECTURE.md — new section "AI in the editor": where the API
   key lives, the request masking story end-to-end (collect → DeepL
   → reassemble), how concurrency is limited, how review-before-
   apply fits the no-silent-data-loss rule, what happens on
   `UnsupportedLocaleError`.

Edge cases I want test coverage for:
- Cancelled passphrase prompt → translate aborts cleanly, no banner.
- ICU tree with no text fragments at all → adapter short-circuits;
  UI must not show a fake "translation suggested" state.
- DeepL `UnsupportedLocaleError` → review modal lists the row as
  "skipped: unsupported locale", not a fatal error.
- Cell that already has a value when "Fill missing" runs → skipped
  (we only fill missing/empty, never overwrite).
- Concurrent translate of the same cell → second click is a no-op
  while the first is pending.

DoD:
- Open `packages/core/fixtures/arb/basic`, set DeepL key once,
  click ✦ on a missing pl cell → suggestion appears → accept → cell
  updates with `source: 'ai'`, `aiProvider: 'deepl'`.
- "Fill missing for pl" runs over a project with intentionally
  missing keys, opens the review modal, applying writes the model
  in one reducer dispatch.
- Vitest covers `ai-provider-host` with a mocked `secretStore` and
  a mocked `fetch` — no real DeepL calls during tests.
- Local `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
  && pnpm build` green; push; CI green.
- Atomic commits (host service, prompts, per-cell action, batch
  review modal, ARCHITECTURE update).
```

---

## Session 7 — Editor UX: search, key add/remove/rename, sort

The editor now has an AI button. The remaining v1 must-haves on the
key-list UX are search (by path or value), add/remove/rename keys,
and sort by status — all of which TanStack Table already supports
through row models we just don't use yet.

**Paste into a new Claude Code session in `polylocale`:**

```
Session 7 — editor UX: search, key add/remove/rename, sort.

Read CLAUDE.md, PROJECT.md, ARCHITECTURE.md. Check `git log` — by now
the editor opens folders, edits cells, saves back, and translates
through DeepL. TanStack Table is wired but no sort/filter is used
yet. Start in plan mode.

Goal: the editor lets the user find a key, add a new key with a
base-locale value, remove a key, rename a key, and sort the table
by key path or by status.

Scope:
1. Toolbar search input — filters the row model by case-insensitive
   substring match against `key.path` and against rendered values
   for any locale. Plug into TanStack Table's
   `getFilteredRowModel` + a global filter fn. Debounce input
   ~150 ms.

2. Add key: an "+ Add key" button next to the toolbar opens a
   small inline form — `path` (validated against existing paths
   and against nested-JSON-illegal characters when any source
   file is nested JSON) + `base-locale value` (parsed via
   `parseICU`). On commit dispatches `addKey`.

3. Remove key: row context menu "Delete" with a confirmation
   step; reducer action `removeKey`. Removed keys disappear from
   every locale on next save (the exporter already skips keys
   without a value for the requested locale).

4. Rename key: row context menu "Rename" inline-edits the key
   path cell; reducer action `renameKey` rebuilds the affected
   key with the new path. Validation: reject empty, reject
   duplicates, reject path-prefix collisions when any source
   file is nested JSON.

5. Sort: clicking a column header cycles asc / desc / none. The
   key column sorts by path; locale columns by rendered value;
   an implicit "Status" sort puts missing first, then
   placeholder-mismatch, then empty, then ok. Header gets a
   small sort-direction icon.

6. Reducer extensions in `editor-state.ts`: `addKey`,
   `removeKey`, `renameKey`. Each adds the affected keyId to
   `dirty` and recomputes status only on the affected key — no
   whole-project rebuild.

7. Tests:
   - Reducer unit tests for add/remove/rename, including
     duplicate detection and rename when no key has that path.
   - A Vitest+Testing-Library smoke test for the search filter
     against the basic fixture.

DoD:
- Search filters as you type; clearing the input restores the
  full row set.
- Add a new `appSubtitle` key in base-locale with an ICU
  placeholder; save; reload; the key sticks across locales.
- Rename `appTitle` → `appName` updates every locale's value
  (path changes, IR/raw stay) and writes back through the
  exporter (round-trip clean).
- Sort by status puts every "missing-translation" row at the
  top of the table.
- All previous tests green; pipeline green; CI green.
- Atomic commits (search, add, remove, rename, sort).
```

---

## Session 8 — Additional AI providers (OpenAI, Anthropic) + DeepL glossary

DeepL covers a lot of locales but not all, and LLM-backed providers
unlock context-aware translation (description, glossary, examples in
the prompt). The `AIProvider` surface is provider-agnostic by design;
this session proves it.

**Paste into a new Claude Code session in `polylocale`:**

```
Session 8 — OpenAI + Anthropic adapters, DeepL glossary.

Read CLAUDE.md, PROJECT.md, ARCHITECTURE.md. Check `git log`. Start
in plan mode. If you need API specifics, fetch them via Context7
(claude-api / openai docs) — don't rely on training data.

Goal: ship two LLM-backed `AIProvider` adapters (OpenAI, Anthropic)
that share a single text-fragment masking strategy, and wire DeepL's
glossary support behind the existing `glossary` field on the
provider input.

Decide upfront (in plan mode):
- Default models per provider — pick the cheapest currently-capable
  option at session time (don't hard-code today's name into
  ARCHITECTURE.md without a "current as of" date).
- Whether to batch many keys per LLM call (cheaper, slightly
  riskier on long contexts) or one call per key (simpler, default).
  Recommend batch with a max-fragments cap.

Scope:
1. `packages/ai/src/llm-translate.ts` — shared helper that takes a
   `collectTextNodes` result, an LLM `chat` callable, plus
   `from`/`to`/`glossary?`/`context?`. Builds a strict JSON-shaped
   prompt: "translate fragments[i] from <from> to <to>, return
   {translations: string[]} of identical length". Validates the
   response — array length matches request, each element is a
   string. Anything else throws `LLMResponseError`.

2. `packages/ai/src/openai.ts` — `createOpenAIProvider({ apiKey,
   model?, fetch? })`. Wraps `llm-translate` with an OpenAI call
   (Responses API or chat-completions, current best practice).

3. `packages/ai/src/anthropic.ts` — same shape, Anthropic Messages
   API. Use the latest Claude family (Haiku for speed/cost).

4. DeepL glossary: extend `createDeepLProvider` to:
   - accept a `glossary` argument in `translate()`;
   - if non-empty for the (from,to) pair, look up an existing
     `/v2/glossaries` entry matching the pair; create one if
     missing;
   - pass `glossary_id` on the translate request;
   - cache `glossary_id` keyed on
     (apiKey-hash, from, to, glossary-content-hash) so repeated
     calls don't recreate it.

5. apps/app:
   - provider dropdown in the AI flow;
   - per-locale default in `ProjectSettings.aiProviderPrefs`;
   - passphrase + API-key prompts now gate per-provider slots:
     `deepl-api-key`, `openai-api-key`, `anthropic-api-key`.

6. Tests:
   - Each adapter has its own unit test with a mocked fetch:
     placeholders/plurals/selects survive end-to-end, malformed
     responses throw `LLMResponseError`, glossary respected.
   - Cross-provider conformance test: a fixture of 5 translation
     cases runs through all three adapters with stubbed responses;
     output IR shape is identical, only leaf strings differ.

7. ARCHITECTURE.md: extend §4 with the LLM masking strategy
   (JSON-fragment prompt), how glossary mapping works, and where
   the per-provider key slots live. Note model defaults with a
   "current as of <date>" so future-us knows when to revisit.

DoD:
- Translate one ARB key with each provider via apps/app (mocked
  in tests, manual check in dev with a real key for at least one
  provider you control).
- DeepL glossary smoke test (mocked fetch) creates and reuses a
  glossary id.
- All previous tests green; pipeline green; push; CI green.
```

---

## Later sessions (templates)

Sketches — refine in plan mode when their turn arrives.

### Session 9 — Glossary UI

Editor-side surface for the `glossary` field on `LocalizationProject`.
Add / remove / edit terms; per-locale "translation" or "do not
translate" flag; persistence in the project file. AI providers
already accept the `glossary` argument from Session 8; this session
just gives the user a way to populate it.

### Session 10 — Diff view

Side-by-side comparison: pick locale A vs. B, see only keys where
values differ structurally (`icuEqual` returns false). Optional:
read a second project snapshot from a sibling folder for "what
changed since last export" — useful when reviewing inbound human
translations.

### Session 11 — CSV / XLSX export-import

Human-translator handoff. Brief flags this as nice-to-have. Pivot
points in the model are `TranslationValue.raw` per locale plus
`description` and `placeholders`. Export stays format-agnostic;
re-import merges by key path with conflict reporting.

### Session 12 — Phase 2 onset: i18next variants, FormatJS

First non-Flutter formats. Reuses everything except parser/exporter
pairs. Apply the format-addition checklist in CLAUDE.md verbatim;
the model already accommodates these without redesign per
ARCHITECTURE.md §1.

---

## Conventions for every prompt

- **Always start in plan mode.** Let Claude read the current docs,
  ask clarifying questions, propose an approach. Approve before
  implementation.
- **Atomic commits.** Each meaningful step (deps bump, parser,
  exporter, tests, fixtures, docs) gets its own commit when natural.
- **CI green is the DoD.** Local
  `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
&& pnpm build`, then push, then green CI.
- **No production code without tests.** Property-based + fixtures +
  snapshots — the format-addition checklist in CLAUDE.md is the spec.
- **Update the docs.** ARCHITECTURE.md grows with each non-trivial
  decision. PROJECT.md changes only when scope/quality bar shifts.
