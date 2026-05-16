# Changelog

All notable changes to polylocale are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull-request templates.
- `CHANGELOG.md` (this file).
- CI: workflow-level `permissions: contents: read`, unified `pnpm/action-setup@v6`, blocking `pnpm audit` step.

### Known issues

- E2E `A2 — edit cell, save, downloaded blob matches golden` is marked `.fixme` due to a CI-only download-event timeout. Passes locally. Tracked in [#9](https://github.com/MariuszJendrzejczak/polylocale/issues/9).

## [0.1.0] — 2026-05-16

First hosted release. Live at <https://polilocale-9c242.web.app/>.

### Added

- **Core model & parsers/exporters**: ARB (with full ICU MessageFormat
  and `@key` metadata), flat JSON, nested JSON. All three with
  round-trip property tests via `fast-check`. Deterministic, byte-stable
  export.
- **ICU IR**: structural representation of ICU messages
  (plurals, selects, placeholders, nested), with parse / render / equal
  helpers. Lossless round-trip through the IR.
- **Locale handling**: BCP-47 detection and normalization, with
  format-aware conventions (`intl_pl.arb`, `pl-PL.json`, …).
- **Tabular editor**: rows = keys, columns = locales, inline editing,
  status badges (missing, review, mismatch), per-column sort, search by
  key or value, add / remove / rename keys with path validation,
  runtime base-locale switch.
- **AI translation**: provider abstraction with DeepL, OpenAI, and
  Anthropic adapters; per-cell, per-row, per-locale, and batch
  translation flows with a review step. ICU placeholders preserved
  across translation.
- **Glossary editor**: per-project glossary persisted alongside the
  project; forwarded to every translation site.
- **Diff view**: two-locale structural comparison
  (`icuStructuralEqual`) highlighting missing, empty, or mismatched
  values.
- **Translator handoff**: CSV export / import (RFC 4180) with a
  three-bucket plan (clean applies / conflicts / parse errors).
- **Encrypted secret store**: AES-GCM (PBKDF2) in IndexedDB, gated by a
  user passphrase. API keys never leave the browser except to the
  provider the user chose.
- **File System Access API integration**: open a folder, edit, save
  back to disk. IndexedDB caches the directory handle and resumes on
  reload (with a permission re-prompt).
- **Vite dev proxy** for DeepL (`/api/deepl/*`) to work around CORS in
  local development.
- **End-to-end test suite** (Playwright, Chromium): basic ARB flow,
  AI translate, diff, glossary, handoff, key CRUD, settings,
  lifecycle.
- **Tag-triggered Firebase Hosting deploy**: pushing `vMAJOR.MINOR.PATCH`
  to `main` ships `apps/app/dist` to the `live` channel.

### Known limitations

- **DeepL on the hosted build is disabled** — DeepL does not return
  CORS headers, so a browser request from the hosted origin is blocked
  at preflight. OpenAI and Anthropic work normally. A same-origin
  proxy (Cloudflare Worker) is planned. See
  [`docs/deployment-plan.md`](./docs/deployment-plan.md) §6.
- **Custom domain `polilocale.buzzards-soft.com` not yet wired** —
  the `*.web.app` URL is the production deploy until DNS is configured.
- **Chromium-first**: Firefox and Safari lack the File System Access
  API used for in-place save-back.

[Unreleased]: https://github.com/MariuszJendrzejczak/polylocale/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MariuszJendrzejczak/polylocale/releases/tag/v0.1.0
