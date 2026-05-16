# E2E-TEST-PLAN.md — polylocale

> **Status: v1 complete on 2026-05-12.** All 20 scenarios across
> groups A–G are green on Chromium under `pnpm e2e`; the suite runs in
> well under the 6-minute budget. Future scenarios land as v2 sprints
> against the same harness.

> End-to-end test plan for polylocale. Companion to ARCHITECTURE.md
> (system contracts) and PROJECT.md (product scope). Targets the
> behaviour that the unit, property-based, and component-smoke layers
> cannot prove on their own.

---

## 1. Goals and non-goals

**Goal.** Give us confidence that a user journey from "open the app"
to "save changes to disk" survives any change — visual, state-layer,
service-layer, or core — without regression. E2E is the only layer
that exercises `apps/app` × `@polylocale/core` × `@polylocale/ai` ×
DOM × IndexedDB × network in one go.

**Non-goals.**

- Not a replacement for unit, property-based, or component-smoke
  tests. ICU edge cases, round-trip lossless guarantees, locale
  normalization, reducer logic — those stay where they are.
- Not a real-provider integration suite. Real DeepL / OpenAI /
  Anthropic calls are cost, flake, and a CI-secrets problem. The
  cross-provider IR contract is already pinned by
  `packages/ai/src/conformance.test.ts`.
- Not a vehicle for File System Access API conformance. That API is
  browser-owned; we exercise the fallback `<input type="file">`
  path, which goes through the same parsers / exporters / reducer.
- Not visual regression, not WCAG / a11y, not perf benchmarking.
  Those live in their own suites if and when they earn their slot.

---

## 2. Coverage philosophy

Test pyramid, top layer. ~20 scenarios. Every scenario represents a
full user journey from intent to outcome. None of them should be
replaceable by a unit + reducer integration test pair — if a
scenario fits that shape, it does not belong here.

Reason: E2E is the most expensive layer to maintain. We pay for
breadth and integration coverage, not for re-proving things the
spec layers already prove.

---

## 3. Environment

| Concern         | Choice                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Runner          | Playwright (Chromium primary; Firefox + WebKit nightly)                                                                  |
| Language        | TypeScript                                                                                                               |
| App under test  | `pnpm build && pnpm preview` via Playwright `webServer`                                                                  |
| Fixtures        | `e2e/fixtures/` — ARB and JSON projects copied from `packages/core/fixtures/` plus bespoke (CSV-conflict, mismatch)      |
| Network mocks   | `page.route` interceptors per provider. One `mockProviders(page, …)` helper for DeepL, OpenAI, Anthropic, DeepL glossary |
| State reset     | `clearCookies` + `indexedDB.deleteDatabase('polylocale')` + secret-store reset in `beforeEach`                           |
| Test passphrase | Constant `'e2e-test-passphrase'`; per-test override only in passphrase-flow scenarios                                    |
| FS Access API   | Skipped via `test.skip(!supportsFs)`. All other I/O via fallback `<input type="file">`                                   |
| CI              | Groups A + B + G on every PR; full suite nightly                                                                         |

---

## 4. Selector and POM strategy

Selector preference, in order:

1. `getByRole(role, { name })` — semantic markup + accessible name.
2. `getByLabel(name)` — for form controls with a `<label>` or `aria-label`.
3. `data-testid` — escape hatch when ARIA cannot express identity
   (table-cell coordinates, popover anchors).

CSS class selectors and raw text matchers are not allowed.

Page Object Model per view: `EditorPage`, `SettingsModal`,
`GlossaryModal`, `HandoffModal`, `BatchReviewModal`, `DiffView`.
The POM owns DOM details; scenarios express user intent. Visual
redesigns update the POM, not the scenarios.

Code change that lands once for stable selectors (~10 attributes):

- `data-testid="cell"` on each table cell, parameterized by key + locale
- `data-testid="ai-suggest-button"` on the per-cell ✦
- `data-testid="ai-suggest-popover"` on the suggestion popover
- `data-testid="batch-apply"` on Apply Selected in `BatchTranslateModal`
- `data-testid="row-menu"` per row in `KeyCell`
- `data-testid="handoff-row-{bucket}"` per row in `HandoffModal`

These are additive — they don't change behaviour, they pin identity.

---

## 5. Scenarios

20 scenarios in 7 groups. Each scenario: name, preconditions, steps,
acceptance.

### A. Project lifecycle (3)

**A1. Open files (fallback) and render table.**
Pre: 2 ARB files. Step: click "Open files…", `setInputFiles`.
Acceptance: table renders, row count matches fixture, base locale
auto-selected.

**A2. Edit cell → save → exported file matches expected.**
Pre: project loaded via fallback. Step: edit one cell, click Save
(download), capture the downloaded blob.
Acceptance: blob text deep-equals `fixtures/expected/A2.arb`.

**A3. FS Access reopen after reload.** _(Chromium-only,
`test.skip(!supportsFs)`)_
Pre: opened folder via picker with permission granted. Step:
reload page, assert "Reopen 'name'" button appears, click, grant
permission. Acceptance: table renders with the same project.

### B. Search, sort, key CRUD (5)

**B1. Search filters and clears.** Type "home" → only rows
containing it in path or rendered value remain. Clear input → full
set restored.

**B2. Sort by status surfaces missing first.** Toggle Status header
to asc. First N rows have at least one missing locale.

**B3. Add key with ICU placeholder.** Open + Add key, enter
`appSubtitle` + `Welcome, {name}`, submit. New row exists; base
locale has the value; other locales missing.

**B4. Rename key.** Open row menu → Rename → `appName`, submit.
Old path absent, new path present. Save → exported files use the
new path.

**B5. Delete key.** Open row menu → Delete → confirm. Row absent.
Save → exported files omit the path entirely.

### C. AI translation (5)

All scenarios mock DeepL / OpenAI / Anthropic at the network layer.

**C1. Per-cell ✦ accept.** Pre: DeepL key set, mock returns a
predictable suggestion. Click ✦, popover opens, click Accept.
Cell text matches suggestion; reducer write carries `source: 'ai'`,
`aiProvider: 'deepl'`.

**C2. Per-row "Translate missing" with partial accept.** Trigger
row menu → Translate missing. Batch review opens with 2 outcomes.
Uncheck one. Apply Selected. Only the checked one lands.

**C3. Fill missing for locale with abort.** Trigger "Fill missing
for pl". Progress modal opens. Click Cancel mid-flight.
`pendingTranslations` empty; no rows mutated.

**C4. UnsupportedLocaleError surfaces as skipped.** Mock returns
`mt-MT` unsupported. Trigger "Fill missing for mt-MT". Batch review
lists the row with the "skipped: unsupported locale" reason and no
checkbox.

**C5. Passphrase cancel is silent.** Cold state. Click ✦.
Passphrase prompt opens. Press Escape. No banner, no popover, no
`pendingTranslations` entry.

### D. Settings and secret store (3)

**D1. Add key via Settings → translate uses it without re-prompt.**
Open Settings, Add key for OpenAI, enter mock-valid key. Slot flips
to Configured. Close. Trigger an OpenAI-targeted translate.
No API-key prompt opens.

**D2. Delete key → translate re-prompts.** Same path; delete the
OpenAI slot. Trigger OpenAI translate. ApiKeyPrompt opens.

**D3. Passphrase rotation survives reload.** Three slots configured.
Settings → Change passphrase. Reload. Unlock with the new
passphrase. Trigger one translation per provider; each succeeds
without re-prompting for the key.

### E. Glossary (2)

**E1. Glossary flows into translate.** Open Glossary. Add
`polylocale → keep verbatim` for the target locale. Trigger a
translation. Network mock asserts the request carries the glossary
(DeepL: `glossary_id`; LLM: term in system prompt).

**E2. Glossary survives reload.** _(FS Access path, Chromium-only.)_
Add 2 entries. Reload. Open Glossary. Both entries present.

### F. Diff view (1)

**F1. Structural mismatch detected and click-through works.**
Pre: project with `{count}` in `en` and `{n}` in `pl`. Toggle Diff
tab. Row appears with "structural mismatch" badge. Click row.
Editor tab is active and the table has scrolled to that row.

### G. Translator handoff (2)

**G1. CSV export → modify → import → three buckets.** Click Export
CSV, capture blob. Modify in the test (one clean change, one
conflicting change, one malformed ICU). Import via `setInputFiles`.
HandoffModal renders three buckets with the right counts. Apply
selected → `setValuesBatch` dispatch. Save → exported files reflect
only the applied changes.

**G2. Cleared-cell conflict renders inert.** Translator emptied a
previously-set cell. Import. Conflicts bucket contains the row, no
checkbox, hint text matches ARCHITECTURE §6.4.

---

## 6. What we deliberately do not cover in E2E

| Area                                       | Why not                                 | Where it lives                   |
| ------------------------------------------ | --------------------------------------- | -------------------------------- |
| ICU edge cases (pound, plural offsets, …)  | Combinatorial — property tests own this | `core/icu/*.property.test.ts`    |
| Round-trip lossless per format             | Same                                    | `exporters/*.test.ts` + property |
| Cross-format equivalence flat ↔ nested     | Independent of UI                       | `json-cross-format.test.ts`      |
| Provider conformance (IR-shape parity)     | UI not involved                         | `ai/conformance.test.ts`         |
| WebCrypto internals (PBKDF2, AES-GCM, AAD) | Pure unit                               | `secret-store.test.ts`           |
| TanStack row models                        | Third-party library                     | Covered indirectly via B1 / B2   |
| Real DeepL / OpenAI / Anthropic calls      | Cost, flake, secrets                    | Manual smoke per release         |
| File System Access API semantics           | Browser-owned API                       | A3 only touches persistence      |
| Visual styling, dark mode                  | Separate problem class                  | Visual regression (deferred)     |
| WCAG / a11y violations                     | Separate tooling                        | `@axe-core/playwright` (later)   |
| Performance at 10k+ keys                   | Different methodology                   | `vitest bench`                   |

---

## 7. Maintenance strategy

- POM is the only layer that knows the DOM. Refactor visually →
  update the POM. The scenarios stay.
- Selectors: roles + accessible names first, `data-testid` as
  escape hatch. CSS classes and raw text are not allowed.
- CI: PR runs A + B + G (8 scenarios, ~2 min). Nightly runs the
  full suite.
- Flaky-test policy: one retry free, second flake → quarantine
  (skip + open issue), fix within 7 days or delete. A consciously
  skipped test is better than a test nobody reads.
- A red E2E means "user-journey regression". Triage by walking up
  the stack, not by suspecting one component.

---

## 8. Out of scope for v1 of this suite

- Multi-user / collab (Phase 1 explicit out).
- Git integration (future).
- Cross-browser parity on day one (start Chromium, broaden after
  2–3 stable sprints).
- Mobile viewport (desktop tool, no mobile UI intent).
- Project-snapshot diff (Session 11 explicitly deferred it).

---

## 9. Bootstrap checklist

What must exist before the first scenario runs:

1. `e2e/playwright.config.ts` — Chromium project, fixtures dir,
   baseURL bound to `webServer`.
2. `e2e/fixtures/` — 3 fixture projects (basic ARB, structural
   mismatch, CSV conflict).
3. `e2e/mocks/ai.ts` — single `mockProviders(page, { … })` helper.
4. `e2e/pages/` — six POMs: `EditorPage`, `SettingsModal`,
   `GlossaryModal`, `HandoffModal`, `BatchReviewModal`, `DiffView`.
5. `e2e/utils/idb.ts` — IndexedDB reset.
6. CI workflow: `pnpm build` → `pnpm preview` background → `pnpm
playwright test`.

Estimated effort: ~1.5 days for the bootstrap, ~30 min per scenario
on top of stable POMs.
