# PROJECT.md — polylocale

> Living product reference. Source of truth for _what we're building and for whom_.
> Update this file whenever a product decision changes (scope, target user, quality bar).
> The original kickoff brief is preserved verbatim in [`BRIEF.md`](./BRIEF.md).

---

## What we're building

**polylocale** — an open-source, web-based localization manager.

Core value: **import → edit → translate → export** for translation files,
with AI-assisted translation built in. Files-as-source-of-truth: developers
keep their workflow, we never become the gatekeeper.

The app runs entirely in the browser (client-only SPA). User opens a folder,
edits, translates with their own AI keys, saves back to disk. No backend, no
account, no cloud sync.

---

## Primary user (Phase 1)

Flutter developers — particularly indie devs and small studios — who:

- Maintain multi-language Flutter apps
- Currently edit `.arb` or JSON files by hand or pay for SaaS (Localizely, Lokalise)
- Want a fast, dev-friendly tool that respects their files-as-source-of-truth workflow
- Don't want to send their strings to a third-party SaaS

**Why this user first:** Flutter localization tooling is less mature than the
React/web ecosystem; ARB is Flutter-specific and underserved; and this gives
us a focused MVP scope rather than "all formats day one".

---

## Phase 1 scope (Flutter-focused MVP)

### Must have

**File format support:**

- `.arb` (Application Resource Bundle) — Flutter native, including ICU
  MessageFormat (plurals, selects, placeholders) and `@key` metadata blocks
- Flat JSON (`pl-PL.json`, `en-US.json`) — common Flutter pattern with
  `easy_localization` etc.
- Nested JSON — same as above, but hierarchical keys

**Core features:**

- Import one or many locale files at once, auto-detect locale from filename or content
- Tabular UI: rows = translation keys, columns = locales, cells = values
- Edit values inline
- Add / remove / rename keys
- Mark keys as needing review, missing translations highlighted
- Export back to original format(s) — round-trip must be **lossless**
- Detect inconsistencies: missing keys per locale, empty values, placeholder
  mismatches between locales

**AI translation:**

- Connect to at least: DeepL, Google Translate, OpenAI, Anthropic (Claude)
- User provides their own API keys (stored locally, encrypted, never sent to
  any backend of ours)
- Translate single cell, selected cells, or fill all missing for a locale
- Batch translation with **review step before applying**
- Preserve ICU syntax and placeholders during translation (don't translate
  `{count}`, `{name}` etc.)

**Project handling:**

- Local project = a folder of locale files the user opens
- Save/load project state (which files belong together, glossary, settings)
- No login required — runs locally, files stay on user's machine

### Nice to have (Phase 1, if time permits)

- Glossary (terms that should always translate the same way or not at all)
- Translation memory (suggest based on previously translated similar strings)
- Diff view between two locales or two versions
- Export to CSV/XLSX for handoff to human translators, re-import with merged changes

### Explicitly out of scope (Phase 1)

- React/web formats (i18next JSON variants, FormatJS) — Phase 2
- iOS/Android native formats (`.strings`, `.xml`, `.stringsdict`) — Phase 3
- Multi-user collaboration, accounts, cloud sync — future
- Git integration — future
- Self-hosted deployment story — future
- In-context overlay editing — future

---

## Phase 2 (after Flutter MVP ships)

### React/web addition

- i18next JSON (flat + nested + namespace files)
- FormatJS / react-intl JSON
- Possibly: Lingui catalogs

This phase reuses the parser/exporter architecture from Phase 1. The internal
model already accommodates these without redesign.

### Other potential additions (priority TBD)

- `.po` / `.pot` (gettext)
- `.xliff` 1.2 and 2.0
- Android `strings.xml`
- iOS `.strings` and `.stringsdict`
- CSV / XLSX import-export for translator handoff

---

## Long-term horizon (informing decisions, not scoping)

Possible monetization path **if the OSS project finds traction**:

- Open-core or OSS-Cloud model: free self-hosted + paid managed cloud version
- Cloud version adds: multi-user, Git integration, cross-project translation
  memory, audit log, SSO

Phase 1 must be built so this path stays open — but **no premature complexity
for it now**.

---

## Quality bar (non-negotiable)

- **Round-trip lossless.** Parse → export → parse must produce identical
  internal model. Tested with snapshots and property-based fuzzing per format.
- **ICU and placeholder preservation.** A broken `{count, plural, ...}` after
  translation is a regression that breaks user trust. Dedicated tests in every
  format.
- **No silent data loss.** Anything we can't represent in the internal model
  is preserved verbatim in `formatMetadata` so the exporter can reconstruct it.
- **Edge cases as fixtures, not inline tests.** Real-world files and minimal
  repros live in `fixtures/`, are version-controlled, and travel with the
  format-addition checklist.

---

## License & repository

- **License:** AGPL-3.0-or-later (final for Phase 1).
  Allows OSS use and contribution; prevents closed-SaaS reuse without
  contributing back; leaves dual-licensing / open-core open later.
- **Repository:** public on GitHub from day one (currently private through
  Phase 1 setup; flips to public when foundation is ready to show).
- **Repo name:** `polylocale` (the original working name was
  `flutter_localization_manager`; renamed once it became clear the app is a TS
  web tool _for_ Flutter devs, not a Flutter app).
