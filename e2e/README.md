# E2E suite

Playwright end-to-end tests for the polylocale SPA. The suite drives a
production build through Playwright's bundled Chromium. Scenarios are
catalogued in [`docs/E2E-TEST-PLAN.md`](../docs/E2E-TEST-PLAN.md) — that
file is the source of truth for what we cover and what we deliberately
don't.

## Status

| Group              | Scenarios | Owned by sprint | Status |
| ------------------ | --------- | --------------- | ------ |
| A — Lifecycle      | A1–A3     | e2e-suite / 1   | green  |
| B — Search / CRUD  | B1–B5     | e2e-suite / 1   | green  |
| C — AI translation | C1–C5     | e2e-suite / 2   | green  |
| D — Settings       | D1–D3     | e2e-suite / 2   | green  |
| E — Glossary       | E1–E2     | e2e-suite / 3   | green  |
| F — Diff view      | F1        | e2e-suite / 3   | green  |
| G — Translator h.  | G1–G2     | e2e-suite / 3   | green  |

**20 scenarios green on Chromium.** Full local run ~1 min on 4 workers,
well under the 6-minute budget the v1 plan declared. CI uses 1 worker
for deterministic timing and lands at ~3 min.

## Running locally

```bash
pnpm install
pnpm e2e:install        # once — downloads Chromium for Playwright
pnpm build              # SPA is served by `vite preview`
pnpm e2e                # 8 scenarios, ~6s on a modern laptop
```

`pnpm e2e` will spawn `vite preview` on `127.0.0.1:4173` via Playwright's
`webServer` config. `reuseExistingServer: !CI` means a long-running
`pnpm dev` or `pnpm preview` you already have open will be reused
locally; CI always boots its own instance. If port 4173 is busy, set
`POLYLOCALE_E2E_PORT` to any free port and re-run.

Useful flags:

```bash
pnpm e2e --headed                       # see the browser
pnpm e2e --debug                        # step through with the inspector
pnpm e2e --grep "B3"                    # run one scenario
pnpm e2e --workers=1                    # serialize for noisy failures
pnpm exec playwright show-report        # open the last HTML report
```

## Selector strategy

Selector preference, in order:

1. **`getByRole(role, { name })`** — every interactive control gets an
   accessible name. The POM does the role lookup; scenarios talk in
   user intent.
2. **`getByLabel(name)`** — for form fields with `<label>` /
   `aria-label`.
3. **`data-testid`** — escape hatch when ARIA cannot express identity.
   Currently used for:
   - `cell` — every table cell (parameterised by `data-key-path` and
     `data-locale`)
   - `row-menu` — the `⋯` trigger inside a key cell
   - `ai-suggest-button` / `ai-suggest-popover` — per-cell ✦ flow
   - `batch-apply` — apply button in the batch-translate review modal
     (the button's accessible name flips with the selected row count,
     e.g. `Apply 3 selected`, so ARIA alone is brittle)
   - `batch-cancel` — cancel button on the in-flight batch progress
     modal (the cancel button on the review modal carries the same
     accessible name)
   - `handoff-row-{clean|conflict|parseError}` — translator-handoff
     buckets

The Diff view's row badge carries `data-reason="missing|empty|structural
mismatch"` for the same reason — the badge text is part of an inline
button whose accessible name aggregates the key path and both
locale values, so an ARIA-only filter for "this row has a mismatch
badge" would be very loose.

CSS class selectors are not allowed. Raw text matches without a role
qualifier are not allowed. Visual redesigns should never touch the
spec files — they update the POM.

## Page Object Model

Each modal / view gets its own POM under `e2e/pages/`. A POM:

- Exposes named `Locator` getters and `async` interaction methods.
- Owns every DOM detail (selectors, waits, click-then-poll patterns).
- Speaks in user-intent verbs: `openFiles`, `editCell`, `deleteKey`.

### Adding a POM

1. Create `e2e/pages/<View>.ts`.
2. Expose `Locator` getters by ARIA role first. Reach for `data-testid`
   only after asking: "could this control carry an accessible name?"
3. Keep waits / retries inside the POM. Scenarios should rarely call
   `waitFor` directly.
4. If a new DOM hook is unavoidable, add the corresponding
   `data-testid` in `apps/app` as an additive, behaviour-neutral
   change and document the new id in this README.

## Fixtures

Fixtures live in `e2e/fixtures/`:

- `basic-arb/` — `en` + `pl` ARB files, no missing keys. Used by A1,
  A2, B1, B3, B4, B5.
- `with-missing/` — `en` complete, `pl` with 3 missing keys. Used by
  B2, C1–C3, C5, D1–D3, E1.
- `with-unsupported/` — `en` + `mt-MT` ARB files; `mt-MT` is empty so
  every row is missing, and DeepL rejects the locale pair client-side.
  Used by C4.
- `with-mismatch/` — `en` + `pl` ARBs where `pl` uses `{n}` instead of
  `{count}` on exactly one key. Used by F1.
- `handoff/source/` — source project for the translator handoff
  round-trip (G1, G2). `home/pl` is missing on purpose so the
  pre-baked CSV can land a clean apply onto it.
- `handoff/edit.csv` — CRLF CSV with one clean, one conflict, and
  one malformed-ICU row, committed next to `handoff/source/` so the
  round-trip is reviewable side-by-side.
- `expected/A2.*.arb` — byte-exact goldens for the A2 download
  comparison.

### Adding a fixture

1. Drop the files under `e2e/fixtures/<name>/`. Locale detection is
   handled by `@polylocale/core` — the filename must end in `.arb` or
   `.json` and carry the locale code (e.g. `pl.arb`, `en-US.json`).
2. If your scenario does a byte-exact save-back comparison, add a
   golden under `e2e/fixtures/expected/`. The easiest path is to run
   the exporter once and commit the output — see
   `e2e/scripts/build-expected.mjs` for the recipe.
3. Use absolute, single-key paths in the fixture (no nested folders).
   The fallback path expects flat input from `<input type="file">`.

## State reset

`utils/idb.ts:resetAppState(page)` wipes the two IndexedDB databases
(`polylocale-editor`, `polylocale-secrets`) and clears storage. Call
it inside `beforeEach` _after_ a `page.goto('/')` — IDB is per-origin
and requires an active document to delete. Tests that need a clean
slate sandwich the reset between two navigations:

```ts
await page.goto('/');
await resetAppState(page);
await page.goto('/');
```

## Mocks

`e2e/mocks/ai.ts` exports a single `mockProviders(page, opts)` helper
that intercepts every AI-provider URL via `page.route`:

- **DeepL** — `POST **/v2/translate` (the same path the Vite dev proxy
  rewrites to). Glossary endpoints (`/v2/glossary-language-pairs`,
  `/v2/glossaries`) are answered with empty results by default; turn
  `glossary: true` on for the E1 path.
- **OpenAI** — `POST **/v1/chat/completions`, wrapping the JSON-strict
  response in the SDK shape (`choices[0].message.content` as a JSON
  string of `{translations: string[]}`).
- **Anthropic** — `POST **/v1/messages`, with `content[0].text` carrying
  the same JSON envelope.

The deterministic transformation: every non-blank fragment `s` becomes
`s [<targetLocale>]`. Whitespace fragments pass through unchanged.
Tests compare against the exact rendered text — `Hello` → `Hello [pl]`
for an OpenAI/Anthropic round-trip, `Hello` → `Hello [PL]` for DeepL
(which uppercases the target). The suffix is the response of the
deterministic transformation and is meant to be visible during a
manual trace inspection.

The helper returns a handle with `.deepl()`, `.openai()`,
`.anthropic()`, and `.lastTranslate()` getters that expose the
recorded requests for post-hoc assertions (E1 uses this to confirm a
glossary_id was attached to a `/v2/translate` request).

### Test passphrase

`e2e/utils/passphrase.ts` exports `TEST_PASSPHRASE =
'e2e-test-passphrase'`. Every C / D scenario unlocks the secret store
with this constant. D3 also imports `TEST_PASSPHRASE_ROTATED` so the
rotation assertion is symmetric.

## CI

The `e2e` job runs on every push and PR after the lint / typecheck /
test / build job is green. Playwright browsers are cached by version
between runs. The job uploads `playwright-report/` and
`test-results/` on failure for triage.

Total runtime budget for the v1 suite is **~6 minutes** (20 scenarios).
The full suite currently lands in ~1 min locally on 4 workers and
~3 min in CI on 1 worker.

## Flaky-test policy

One retry free, second flake → quarantine (`test.skip` plus an issue
referencing the spec name). Fix within 7 days or delete the spec.
A consciously skipped test is better than a test nobody reads.
