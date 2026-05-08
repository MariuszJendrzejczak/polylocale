# flutter_localization_manager — Project Brief

## Context for Claude Code

This is the kickoff brief for an open-source web-based localization management tool. The project is starting Flutter-first, with React/web support planned as a follow-up phase. This document captures decisions made during planning so we can dive into architecture and implementation.

---

## What we're building

A web application (used locally by developers, optionally self-hostable later) for managing translation files across projects. Core value: **import → edit → translate → export** for localization files, with AI-assisted translation built in.

### Primary user (phase 1)

Flutter developers — particularly indie devs and small studios — who:

- Maintain multi-language Flutter apps
- Currently edit `.arb` or JSON files by hand or use expensive SaaS (Localizely, Lokalise)
- Want a fast, dev-friendly tool that respects their files-as-source-of-truth workflow
- Don't want to send their strings to a third-party SaaS

### Why this user first

- Flutter localization tooling is less mature than React/web ecosystem
- ARB format is Flutter-specific and underserved
- Smaller, more focused MVP scope than "all formats day one"

---

## Phase 1 scope (Flutter-focused MVP)

### Must have

**File format support:**

- `.arb` (Application Resource Bundle) — Flutter native, including ICU MessageFormat (plurals, selects, placeholders) and `@key` metadata blocks
- Flat JSON (`pl-PL.json`, `en-US.json` etc.) — common Flutter pattern with `easy_localization` etc.
- Nested JSON — same as above, but hierarchical keys

**Core features:**

- Import one or many locale files at once, auto-detect locale from filename or content
- Tabular UI: rows = translation keys, columns = locales, cells = values
- Edit values inline
- Add / remove / rename keys
- Mark keys as needing review, missing translations highlighted
- Export back to original format(s) — round-trip must be lossless (preserve ICU syntax, metadata, ordering where possible)
- Detect inconsistencies: missing keys per locale, empty values, placeholder mismatches between locales

**AI translation:**

- Connect to at least: DeepL, Google Translate, OpenAI, Anthropic (Claude)
- User provides their own API keys (stored locally, never sent to our backend if there is one)
- Translate single cell, selected cells, or fill all missing for a locale
- Batch translation with review step before applying
- Preserve ICU syntax and placeholders during translation (don't translate `{count}`, `{name}` etc.)

**Project handling:**

- Local project = a folder of locale files the user opens
- Save/load project state (which files belong together, glossary, settings)
- No login required for MVP — runs locally, files stay on user's machine

### Nice to have (phase 1, if time permits)

- Glossary (terms that should always translate the same way or not at all)
- Translation memory (suggest based on previously translated similar strings)
- Diff view between two locales or two versions
- Export to CSV/XLSX for handoff to human translators, re-import with merged changes

### Explicitly out of scope (phase 1)

- React/web formats (i18next JSON variants, FormatJS) — phase 2
- iOS/Android native formats (.strings, .xml, .stringsdict) — phase 3
- Multi-user collaboration, accounts, cloud sync — future
- Git integration — future
- Self-hosted deployment story — future
- In-context overlay editing — future

---

## Technical decisions made

### Architecture

Three-layer model:

1. **Parsers** — one per format, file → internal model
2. **Internal data model** — single source of truth, format-agnostic
3. **Exporters** — one per format, internal model → file (round-trip safe)

Each format is **independently testable**. Adding a format = parser + exporter + test fixtures + docs.

Internal model concept (to be refined in first session):

- A `LocalizationProject` containing keys
- Each key has: identifier, per-locale values, metadata (description, placeholders, ICU info), status flags
- Metadata preserved separately so we can reconstruct format-specific quirks on export

### Stack — to decide in first session

Open questions for kickoff discussion:

- **Frontend framework:** React + Vite (fastest), Next.js (overkill for now?), SvelteKit, or other
- **Local-first storage:** IndexedDB (Dexie?) or filesystem via File System Access API
- **Backend:** none for MVP (pure client-side) vs. lightweight backend (Node/Bun) for AI proxy
- **Language:** TypeScript (assumed)

Bias toward: **client-only, no backend, run from a static host or locally.** Simplest to ship, easiest to self-host later, no server costs. AI calls go directly from browser to provider APIs using user's own keys.

### Licensing

**AGPL-3.0** — chosen to:

- Allow open source community use and contributions
- Prevent competitors from running our code as a closed SaaS without contributing back
- Leave door open for dual-licensing or open-core monetization later

License decision is final for phase 1.

### Repository

- **Public on GitHub** from day one
- Repo name: `flutter_localization_manager` (working name, may evolve)
- Branding/positioning: "Flutter-first, format-faithful, AI-assisted localization tool"

---

## Phase 2 (after Flutter MVP ships and gets feedback)

### React/web addition

- i18next JSON (flat + nested + namespace files)
- FormatJS / react-intl JSON
- Possibly: Lingui catalogs

This phase reuses the parser/exporter architecture from phase 1. The internal model should already accommodate these without redesign.

### Other potential additions (priority TBD)

- `.po` / `.pot` (gettext) — large potential audience
- `.xliff` 1.2 and 2.0 — industry standard, opens enterprise door
- Android `strings.xml`
- iOS `.strings` and `.stringsdict`
- CSV / XLSX import-export for translator handoff

---

## Long-term (not scoping yet, but informing decisions)

Possible monetization path **if the OSS project finds traction**:

- Open-core or OSS-Cloud model: free self-hosted + paid managed cloud version
- Cloud version adds: multi-user, Git integration, translation memory across projects, audit log, SSO

Phase 1 should be built so this path remains open — but no premature complexity for it now.

---

## Working style with Claude Code

### Expected workflow

1. **Session 1:** architecture and data model. No code yet — produce `ARCHITECTURE.md`, `CLAUDE.md`, finalized internal data model, finalize stack choice.
2. **Session 2:** project skeleton, stack setup, first parser+exporter (recommend starting with flat JSON as simplest), basic test harness, sample fixtures.
3. **Subsequent sessions:** one format per session (ARB next, then nested JSON), each with parser + exporter + round-trip tests + fixtures.
4. **Parallel track:** UI (tabular editor) once data model is stable.
5. **Parallel track:** AI integrations once at least one format works end-to-end.
6. **Periodic:** architecture review, refactor passes, dependency audits.

### Conventions to establish in `CLAUDE.md`

- Folder structure
- Naming conventions for parsers/exporters
- Test fixture organization (real-world sample files per format, including edge cases)
- How to add a new format (checklist)
- Code style and lint rules

### Quality bar

- Every parser must be **round-trip tested** — parse, export, parse again, results must match
- Edge cases documented as test fixtures, not just inline tests
- ICU syntax and placeholder preservation is **non-negotiable** — broken `{count, plural, ...}` after a translation is a regression that breaks user trust
- No silent data loss on import or export

---

## First session goals

When we kick off, the deliverables are:

1. **Stack decision** with brief justification (frontend, storage, backend-or-not)
2. **Internal data model** drafted (TypeScript types or schema)
3. **Repo structure** proposed
4. **`CLAUDE.md`** written with conventions and the format-addition checklist
5. **`ARCHITECTURE.md`** written for human readers (contributors and future-me)
6. **License file** (AGPL-3.0) and skeleton README

No production code in session 1. Goal is a solid foundation so subsequent sessions can move fast and stay consistent.

---

## Questions to discuss in session 1

1. File System Access API vs. IndexedDB vs. both — what's the best UX for "open a project folder"?
2. How do we represent ICU MessageFormat in the internal model so it survives round-trip across ARB ↔ JSON?
3. How do we handle locale detection from filenames given inconsistent conventions (`pl.json`, `pl-PL.json`, `pl_PL.arb`, `intl_pl.arb`)?
4. AI provider abstraction — single interface, swappable backends; how to handle their differences in batch sizes, rate limits, prompt construction?
5. Where do API keys live? IndexedDB encrypted with a user-chosen passphrase? Plain localStorage? OS keychain via a thin desktop wrapper later?
6. Test strategy: snapshot tests for round-trips? Property-based tests for parser edge cases?

---

## TL;DR for Claude Code

We're building an open-source, AGPL-3.0, web-based localization manager. Phase 1 = Flutter-first (ARB + flat/nested JSON), with AI translation via user-provided API keys (DeepL, Google, OpenAI, Anthropic). Architecture is parser → internal model → exporter, each format independently testable, round-trip lossless. Stack is to be decided in session 1, biased toward client-only TypeScript app. Public GitHub from day one. Phase 2 adds React/web formats; other formats follow.

Session 1 deliverables: stack decision, data model draft, repo structure, `CLAUDE.md`, `ARCHITECTURE.md`, license, README skeleton — no production code yet.
