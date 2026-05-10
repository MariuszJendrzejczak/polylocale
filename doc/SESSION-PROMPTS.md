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

## Session 9 — Settings panel: API keys & passphrase management

The encrypted secret store, passphrase prompt and per-provider key
prompt all exist (Sessions 5a / 7 / 8) but they only surface
just-in-time, when a translation needs them. There is no way today
to inspect which provider keys are configured, rotate one, drop one,
or change the passphrase without going through the IndexedDB
DevTools panel. This session builds that surface.

The whole feature lives in `apps/app`; `core` and `ai` don't change.
The secret store gains one new method (`changePassphrase`); everything
else is React + the existing services.

**Paste into a new Claude Code session in `polylocale`:**

```
Session 9 — Settings panel for API keys & passphrase.

Read CLAUDE.md, PROJECT.md, ARCHITECTURE.md (§3.10, §4.5). Check
`git log`. Start in plan mode.

Goal: a Settings panel reachable from the topbar that lets the user
(a) see at a glance which provider keys are configured, (b) add /
update / delete a key per provider slot, and (c) change the
passphrase that protects the encrypted secret store. Nothing in
`packages/core` or `packages/ai` changes — the AIProvider surface,
the secret store crypto, and the lazy-prompt flow stay as they are.
This session is purely apps/app.

Decide upfront (in plan mode):
- Settings surface — modal vs side drawer vs separate route. Default
  to a modal (consistent with existing PassphrasePrompt /
  ApiKeyPrompt aesthetics; no router yet in the app). Spell out the
  reason in the plan.
- "Key configured" indicator — never reveal the key value. Show
  presence + length (`••••••••12`-style) and the slot's provider
  label. The store has no read-by-prefix API; rely on
  `secretStore.list()` plus the slot constants from
  `services/ai-provider-host.ts`.
- Passphrase change flow — must re-encrypt every existing slot
  under the new key. Either (a) extend SecretStore with
  `changePassphrase(oldPp, newPp)` that walks every slot once, or
  (b) push the read-decrypt-encrypt loop into apps/app. (a) keeps
  the WebCrypto code in the same module — recommend (a).

Scope:

1. `packages/ai`, `packages/core`: NO CHANGES.

2. `apps/app/src/services/secret-store.ts`:
   - Add `changePassphrase(oldPassphrase: string, newPassphrase:
     string): Promise<void>`. Verifies `oldPassphrase` against the
     verifier; reads every existing slot's plaintext under the old
     key; generates a fresh salt, derives a new key, re-writes the
     verifier under the new key; re-encrypts every slot under the
     new key (preserving slot names and AAD binding); commits
     transactionally where IDB allows. On any decryption failure
     mid-rotation, abort without mutating IDB and rethrow.
   - Update `secret-store.test.ts`: round-trip through a passphrase
     change; `changePassphrase` with the wrong old passphrase
     throws `InvalidPassphraseError`; previously stored slots
     decrypt under the new passphrase; the verifier matches the
     new passphrase, not the old one.

3. `apps/app/src/services/ai-provider-host.ts`:
   - Export a small helper `getProviderRegistry()` (or extend the
     existing `__test.PROVIDER_SLOTS`) so the Settings view can map
     `slot → providerId → label` without hard-coding strings.
   - The host itself does not change behaviourally.

4. `apps/app/src/views/SettingsModal.tsx` (new) +
   `SettingsModal.module.css`:
   - Header: "Settings". Close button.
   - Section "AI provider keys": one row per `ProviderId` (DeepL,
     OpenAI, Anthropic). Row shows: provider label, slot status
     (`Not configured` / `Configured · ••••••••<last 4>`), and an
     action button (`Add key` / `Replace` / `Delete`).
   - "Add key" / "Replace" reuses the existing `ApiKeyPrompt` (the
     prompt component already takes `slot` + `providerLabel`).
   - "Delete" prompts a confirm step inline (no extra modal —
     a tiny "Are you sure? Cancel | Delete" row replacing the
     button) then dispatches `secretStore.delete(slot)` and
     re-reads `list()`.
   - Section "Passphrase": one button "Change passphrase…" that
     opens a small inline form (current passphrase + new + confirm
     new). On submit calls `secretStore.changePassphrase`. Errors
     surface inline; success closes the form and shows a transient
     "Passphrase updated" notice in the modal.
   - Empty-store states are explicit ("No keys configured yet —
     translation flows will prompt as needed").
   - The whole modal reads `secretStore.list()` once on open, then
     re-reads after every mutation; nothing is cached longer.

5. `apps/app/src/views/EditorView.tsx`:
   - Add a "⚙ Settings" button to the topbar (next to "+ Add key"
     or in a small kebab — your call in plan mode). Clicking it
     opens the modal.
   - Open requires the store to be unlocked. If locked, route
     through the existing `requestUnlock` gate first (same pattern
     `aiHost.getProvider` uses); cancel = no-op.
   - On any provider-slot mutation from the modal, call
     `aiHost.reset(providerId)` so the cached AIProvider rebuilds
     against the new key on next use.

6. Tests:
   - `secret-store.test.ts` — passphrase rotation round-trip plus
     wrong-old-passphrase failure (above).
   - New `SettingsModal.test.tsx` (Testing Library smoke):
     opens with two configured slots → renders both as
     "Configured" with the right label; clicking Delete then
     confirming removes the slot from the rendered list and
     calls `secretStore.delete`.
   - Smoke test for the EditorView "⚙ Settings" button: click
     opens the modal when the store is unlocked.

7. ARCHITECTURE.md:
   - Extend §3.10 with the `changePassphrase` lifecycle (verify
     old → re-derive → re-encrypt every slot → swap verifier),
     and the failure model (abort without mutation on
     decryption failure).
   - One-line pointer in §4.5 to the Settings modal as the
     canonical "where do I see / rotate keys" surface.

DoD:
- Open the dev server, open Settings, see DeepL / OpenAI /
  Anthropic rows with their current slot status.
- Add a key for one provider via the modal, see it become
  "Configured", trigger a translation in the editor — host uses
  it without re-prompting.
- Delete that key, see the row flip to "Not configured", trigger
  a translation — the editor re-prompts via the existing
  ApiKeyPrompt.
- Change the passphrase, lock the store (close + reopen the
  app), unlock with the new passphrase, every previously-stored
  slot still decrypts cleanly.
- All previous tests green; pipeline green; push; CI green.
```

---

## Session 10 — Glossary UI

Editor-side surface for the `glossary` field on `LocalizationProject`.
The AI providers already accept `glossary` as of Session 8; this
session gives the user a way to populate, edit, and persist the
terms. Glossary entries flow into the LLM system prompt as advisory
hints and into DeepL as a real `glossary_id` (see ARCHITECTURE.md
§4.6 / §4.7).

**Paste into a new Claude Code session in `polylocale`:**

```
Session 10 — Glossary editor + per-project persistence.

Read CLAUDE.md, PROJECT.md, ARCHITECTURE.md. Check `git log`. Start
in plan mode.

Goal: ship a small editor surface for `LocalizationProject.glossary`
— add / edit / remove `GlossaryEntry`s with per-locale `translation`
or `doNotTranslate: true`. Persist alongside project state so the
glossary survives a reload. The AI side is already wired; this
session just feeds it.

Decide upfront (in plan mode):
- Storage: where does the glossary live across reloads? Today
  `apps/app/src/services/persistence.ts` only stashes a directory
  handle and a small `EditorMeta`. Two options:
  (a) extend `EditorMeta` with `glossary`,
  (b) write a sibling project file (e.g. `.polylocale.json`) into
  the user's project directory.
  Recommend (a) for this session — keep persistence minimal; (b)
  becomes the right place once the project file exists for real.
- Editor surface: a dedicated route is overkill. Use a modal-style
  panel reachable from the topbar (consistent with Session 9's
  Settings).
- Rendering rule: glossary entries with no usable target for the
  current base locale should NOT be silently dropped — show them
  with a "(no entry for <baseLocale>)" hint. The UI never edits
  away data the user can't see.

Scope:

1. `packages/core/src/model/types.ts`: NO SHAPE CHANGE.
   `GlossaryEntry` already carries `term`, `perLocale`, `notes?`.

2. `apps/app/src/state/editor-state.ts`:
   - Add reducer actions: `addGlossaryEntry`, `removeGlossaryEntry`,
     `updateGlossaryEntry` (term, perLocale, notes).
   - The dispatch from the modal mutates `state.project.glossary`
     immutably and does NOT touch `dirty` (glossary lives at the
     project level, not the key level).

3. `apps/app/src/services/persistence.ts`:
   - Extend `EditorMeta` with `glossary?: readonly GlossaryEntry[]`.
     Writers (`saveEditorMeta`) include it; readers
     (`loadEditorMeta`) hydrate it; the `loaded` action threads
     it into `project.glossary`.
   - DO NOT touch the directory-handle store.

4. `apps/app/src/views/GlossaryModal.tsx` (new) +
   `GlossaryModal.module.css`:
   - List of terms with inline edit (term + per-locale rows; one
     row per `project.locales`, with `translation` text input or
     `Don't translate` toggle).
   - "Add term" button at the top.
   - Delete button per row with inline confirm (same pattern as
     Session 9 Settings).
   - Search/filter by term substring.
   - Empty state: "No glossary terms yet — they'll be passed to
     OpenAI/Anthropic as hints and to DeepL via /v2/glossaries
     when configured."

5. `apps/app/src/views/EditorView.tsx`:
   - Add "📖 Glossary" button to the topbar near Settings.
   - Pass `state.project.glossary` and dispatch handlers to
     `GlossaryModal`.
   - When triggering a translation (per-cell, per-row,
     per-locale), thread `glossary: project.glossary` through the
     `provider.translate` call (currently we don't pass it).

6. Tests:
   - `editor-state.test.ts` — add/update/remove reducer coverage,
     and that glossary changes don't dirty individual keys.
   - `GlossaryModal.test.tsx` — Testing Library smoke: list a
     fixture project's terms, add one, edit one, delete one;
     each fires the right dispatch.
   - `persistence.ts` — round-trip including glossary.
   - One end-to-end-ish test: a translation request from the
     editor passes the current glossary to `provider.translate`.

7. ARCHITECTURE.md:
   - Short note in §4 that the glossary now actually flows into
     `provider.translate({ glossary })` from the editor (the
     wire was there since Session 8; this connects it).

DoD:
- Open Glossary, add a term `polylocale → keep verbatim`,
  trigger a translation that contains "polylocale" — the LLM
  prompt visibly includes the term as a hint (verify via the
  test mock); the DeepL adapter creates / reuses a glossary id
  if the language pair is supported.
- Reload the app, glossary terms still appear.
- Removing the last term leaves the project clean — no dangling
  empty `glossary: []` in `EditorMeta`.
- All previous tests green; pipeline green; push; CI green.
```

---

## Session 11 — Diff view

A side-by-side comparison surface to spot meaningful translation
divergence: pick two locales (or two project snapshots) and see
only the keys where the values differ structurally. Critical for
reviewing inbound human translations and catching placeholder
mismatches before they land in production.

**Paste into a new Claude Code session in `polylocale`:**

```
Session 11 — Diff view for translations.

Read CLAUDE.md, PROJECT.md, ARCHITECTURE.md. Check `git log`. Start
in plan mode.

Goal: a diff view that shows, for a project, only the keys where
two locales differ in a way that matters — placeholder mismatch,
plural/select case key drift, missing translations, or
structurally different IR. Pure surface and `core`-side helper —
no AI, no persistence changes.

Decide upfront (in plan mode):
- Diff primitive: write `icuStructuralEqual(a, b)` in
  `packages/core/src/icu/` that compares two `ICUNode[]` ignoring
  text content but enforcing identical placeholder names, plural
  selector keys, tag names, and offsets. This is the "do these
  two messages have the same skeleton" check.
- Surface: separate route or a tab inside EditorView? Default to
  a top-level tab toggle in the existing topbar ("Editor | Diff")
  since there's still no router. State stays in `EditorState`
  via a small `view: 'editor' | 'diff'` field.
- Two-locale vs project-snapshot: scope only two-locale diff for
  this session. Project-snapshot diff (compare against the last
  saved version) is a Session-N+1 feature — don't smuggle it in.

Scope:

1. `packages/core/src/icu/structural-equal.ts` (new) +
   `structural-equal.test.ts`:
   - `icuStructuralEqual(a: readonly ICUNode[], b: readonly
     ICUNode[]): boolean`.
   - Recursive walk: same kind ordering; placeholder names match
     exactly; plural/select cases must have identical key sets and
     identical offsets; tag names match; text content ignored.
   - Property-based test with `fast-check`: any tree is
     structurally-equal to itself; swapping text leaves keeps
     structural equality; renaming a placeholder breaks it;
     dropping a plural case breaks it.

2. `packages/core/src/index.ts`: re-export the helper.

3. `apps/app/src/state/editor-state.ts`:
   - Add `view: 'editor' | 'diff'` (default `'editor'`) and a
     `setView` action.
   - Add `diffSelection: { left: LocaleCode; right: LocaleCode }
     | null` and a `setDiffSelection` action.

4. `apps/app/src/views/DiffView.tsx` (new) +
   `DiffView.module.css`:
   - Top: two `<select>`s for left/right locale, defaulted to
     base locale + the first non-base.
   - List of rows where:
     • either side is missing,
     • either side is empty,
     • `icuStructuralEqual(left.ir, right.ir)` is false.
   - Each row shows: key path, left rendered text, right rendered
     text, and a small badge for the divergence reason
     ("missing", "structural mismatch", "empty").
   - Click on a row → switches back to Editor with the row
     scrolled into view (use the existing TanStack table API or
     plain `scrollIntoView`; whichever is least invasive).

5. `apps/app/src/views/EditorView.tsx`:
   - Add a topbar tab toggle ("Editor | Diff") that flips
     `state.view`.
   - When `state.view === 'diff'`, render `DiffView` instead of
     the table.

6. Tests:
   - `structural-equal.test.ts` — placeholder rename, plural
     case drop, select key drop, nested tag name change,
     identical-with-different-text → covered.
   - `editor-state.test.ts` — `setView` and `setDiffSelection`
     reducers.
   - `DiffView.test.tsx` — Testing Library smoke: a fixture
     project with one missing, one structurally-different key
     renders both with the right reason badge.

7. ARCHITECTURE.md:
   - One sub-section under §2 documenting `icuStructuralEqual`
     as the canonical "did the meaning of this message change"
     primitive (vs. byte equality of `raw`).

DoD:
- Switch to Diff tab in dev: pick `en` vs `pl`, only the rows
  that actually need attention show.
- Renaming `{count}` to `{n}` in one locale puts the row in the
  diff list with a "structural mismatch" badge.
- All previous tests green; pipeline green; push; CI green.
```

---

## Session 12 — CSV / XLSX export-import for translator handoff

Sometimes the right next step isn't AI — it's a human translator
agency that wants a spreadsheet. This session adds round-trip CSV /
XLSX support that re-merges by key path with conflict reporting,
without touching the source-of-truth ARB / JSON files.

**Paste into a new Claude Code session in `polylocale`:**

```
Session 12 — CSV / XLSX export and import.

Read CLAUDE.md, PROJECT.md, ARCHITECTURE.md. Check `git log`. Start
in plan mode.

Goal: export the current project to a CSV (and optionally XLSX)
the user hands to a human translator; re-import the modified file
and merge translations back into the project, surfacing every
conflict instead of silently overwriting. CSV / XLSX are NOT
"formats" in the parser/exporter sense — they're a transport over
the existing model.

Decide upfront (in plan mode):
- Library: CSV first via a tiny hand-rolled writer/parser (no
  dep). XLSX via a library — `xlsx` (sheetjs) is mature and OSS
  but huge; `exceljs` is leaner. Start with CSV only;
  XLSX-the-library question lives in a follow-up unless you can
  justify the bundle cost in the plan.
- Sheet shape: rows = translation keys, columns = `key | description
  | <locale 1> | <locale 2> | …`. The key column is the join
  key on re-import. Use `value.raw ?? renderICU(value.ir)` for
  cell text — same trade-off the editor already makes for search.
- Conflict policy on import: never silently overwrite. Compute
  per-cell: was-empty → now-set is a clean apply; was-set → still
  same is a no-op; was-set → now-different is a CONFLICT requiring
  the user's review (modal listing every conflict before the
  reducer dispatches `setValuesBatch`).
- Placeholder safety: re-import strings go through `parseICU` so
  malformed ICU surfaces as a parse error (per-row, not whole
  batch).

Scope:

1. `packages/core/src/transport/csv.ts` (new) +
   `csv.test.ts`:
   - `exportProjectToCsv(project): string`. Stable column order:
     `key`, `description`, then locales in `project.locales`
     order. Quote-escape per RFC 4180.
   - `parseCsvRows(text): readonly { key: string; description?:
     string; values: Record<LocaleCode, string> }[]`. Strict on
     the header row; surfaces the column → locale mapping based
     on header names that match an existing locale code.
   - Property-based round-trip: arbitrary projects export then
     parse back to the same row set (raw text, not IR).

2. `apps/app/src/services/translator-handoff.ts` (new):
   - `exportProjectAsCsv(project): { filename, blob }`.
   - `importCsvAndPlan(text, project): { applies: BatchValueEntry[];
     conflicts: ConflictReport[]; parseErrors: ImportError[] }`.
     `applies` is what would land cleanly; `conflicts` lists rows
     where the spreadsheet value disagrees with current state;
     `parseErrors` flag malformed ICU per row.

3. `apps/app/src/views/HandoffModal.tsx` (new) + CSS:
   - "Export CSV" button → triggers download.
   - "Import CSV" file input → runs `importCsvAndPlan` → renders
     three sections (clean applies, conflicts, parse errors) with
     per-row checkboxes. Apply button funnels through the
     existing `setValuesBatch` reducer (the same path used by
     `BatchTranslateModal`).

4. `apps/app/src/views/EditorView.tsx`:
   - "📤 Translator handoff" button in the topbar (or fold it
     into the Settings/Glossary kebab — your call).
   - Opens HandoffModal.

5. Tests:
   - `csv.test.ts` — round-trip on the tiny ARB fixture; quotes;
     newlines inside cells; missing columns; extra columns
     (ignored with a warning).
   - `translator-handoff.test.ts` — clean apply, conflict
     reporting, parse error per row.
   - `HandoffModal.test.tsx` — Testing Library smoke: import a
     CSV, see clean applies and conflicts in the right
     sections, apply selected → reducer fires.

6. ARCHITECTURE.md:
   - New §6 "Translator handoff" describing CSV as a transport
     (not a format), the clean-apply / conflict / parse-error
     triage, and why XLSX is deferred.

DoD:
- Export the fixture project as CSV, edit a few rows in
  LibreOffice / Numbers, re-import → clean rows land via
  setValuesBatch, conflicts surface in the modal.
- A row with malformed ICU shows up as a parse error and is
  NOT applied.
- All previous tests green; pipeline green; push; CI green.
```

---

## Later sessions (templates)

Sketches — refine in plan mode when their turn arrives.

### Session 13 — Phase 2 onset: i18next variants, FormatJS

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
