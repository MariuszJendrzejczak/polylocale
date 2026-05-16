# polylocale

[![CI](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/ci.yml/badge.svg)](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/ci.yml)
[![Deploy](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/deploy.yml/badge.svg)](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/deploy.yml)

Open-source, web-based localization manager. Phase 1 is **Flutter-first** —
import, edit, AI-translate, and export `.arb` and JSON locale files, in your
browser, with your own AI keys, with your files staying on your machine.

**Try the hosted build:** <https://polilocale-9c242.web.app/>

> Custom domain `polilocale.buzzards-soft.com` is planned but not wired yet —
> the `*.web.app` URL above is the production deploy.

> **Status:** pre-alpha. End-to-end flow works in Chromium-based browsers:
> open a folder of `.arb` or JSON files, edit inline, translate with your
> own AI keys (OpenAI / Anthropic / DeepL / Google), save back to disk.
> DeepL on the hosted build is blocked by CORS and is **disabled** there
> until a proxy is shipped — see
> [`docs/deployment-plan.md`](./docs/deployment-plan.md) §6.

## Why

Flutter localization tooling is less mature than the React/web ecosystem,
and ARB is a Flutter-specific format underserved by existing SaaS. Indie
devs and small studios end up either editing `.arb` files by hand or paying
SaaS prices for things they don't need.

polylocale aims to be the **fast, dev-friendly, files-as-source-of-truth**
alternative — local first, no account, AI-assisted when you want it.

## Phase 1 scope

- Formats: `.arb` (with full ICU MessageFormat + `@key` metadata), flat JSON,
  nested JSON — all three parsers + exporters shipped with round-trip
  property tests.
- Tabular UI: rows = keys, columns = locales, inline editing, missing /
  review highlighting, placeholder mismatch detection, structural diff
  view, glossary editor, translator-handoff CSV export/import.
- AI translation via DeepL, OpenAI, Anthropic — your keys, AES-GCM-encrypted
  in IndexedDB under a passphrase, never sent anywhere except the provider
  you chose.
- Round-trip lossless: import → edit → export produces structurally
  identical files (byte-stable, deterministic ordering).
- Local-only: open a folder, work, save back — no login, no cloud.

What's **out of scope** for Phase 1: React/web formats (Phase 2),
iOS/Android native formats (Phase 3), multi-user collaboration, git
integration, cloud sync. See [`docs/PROJECT.md`](./docs/PROJECT.md) for the
full scope.

## Stack

TypeScript · React 19 · Vite · pnpm monorepo (`packages/core`, `packages/ai`,
`packages/ui`, `apps/app`) · File System Access API + IndexedDB · WebCrypto
for API key encryption · Vitest + fast-check (unit) · Playwright (E2E) ·
ESLint + Prettier.

Full architecture and decision rationale: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Using the hosted app

1. Open <https://polilocale-9c242.web.app/> in Chrome, Edge, or any
   Chromium-based browser (Firefox / Safari lack the File System Access
   API used for in-place save-back).
2. Click **Open folder** and pick a directory containing your locale files
   (`.arb`, `.json`). Filenames carry the locale: `intl_en.arb`, `pl-PL.json`.
3. Edit cells inline. Missing translations are highlighted; rows with
   placeholder or ICU mismatches surface a warning badge.
4. To use AI translation: open **Settings → Providers**, set a passphrase
   for the local encrypted key store, paste an API key for the provider
   you want, and translate single cells, whole rows, or batches with a
   review step.
5. **Save** writes back to the original files in place. Reloading the
   tab restores the session from IndexedDB.

## Local development

Requirements: **Node 22+** and **pnpm 11+**. Clone, then:

```bash
pnpm install            # all 5 workspaces
pnpm dev                # Vite dev server on http://localhost:5173
pnpm test               # Vitest across every package
pnpm lint               # ESLint, monorepo-wide
pnpm typecheck          # tsc -b on all references
pnpm format:check       # Prettier check (write with `pnpm format`)
pnpm build              # Production build of every package
pnpm clean              # Remove dist + tsbuildinfo
```

Don't push without `pnpm lint && pnpm typecheck && pnpm test` clean — CI
runs the same and a red CI blocks merge.

### End-to-end tests

```bash
pnpm e2e:install        # once — downloads Chromium for Playwright
pnpm build              # E2E serves the production build
pnpm e2e                # ~1 min locally on 4 workers
```

See [`e2e/README.md`](./e2e/README.md) for the selector strategy, fixtures,
and how to add a new scenario.

## Releasing

Production deploy to Firebase Hosting is triggered by **pushing a SemVer
tag** to `main`:

```bash
# from a green main
git tag v0.2.0          # SemVer — no leading dot, no extras
git push origin v0.2.0
```

The `Deploy` workflow runs `pnpm build` and ships `apps/app/dist` to the
`live` channel. Watch it under
[GitHub → Actions → Deploy](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/deploy.yml).

> ⚠ Tag format must be `vMAJOR.MINOR.PATCH` (e.g. `v0.2.0`), **not**
> `v.0.2.0` — the workflow trigger `v*.*.*` matches a stray leading dot,
> but the tag sorts and reads wrong. If you push a malformed tag, delete
> it from origin (`git push origin :refs/tags/<bad>`) before retagging.

The full first-deploy recipe (Firebase project, service-account secret,
custom domain DNS) lives in
[`docs/deployment-plan.md`](./docs/deployment-plan.md). The repo already
has `firebase.json`, `.firebaserc`, and `.github/workflows/deploy.yml`
wired — for a routine release you only need to push a tag.

## Contributing

Please read [`CLAUDE.md`](./CLAUDE.md) (instructions for AI agents and an
honest summary of conventions for humans) and
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) (the _why_ behind the
architecture) before opening a PR. The original kickoff brief is in
[`docs/BRIEF.md`](./docs/BRIEF.md).

A new file format is always welcome — the addition checklist is in
`CLAUDE.md`. Quality bar: round-trip lossless, ICU/placeholder
preservation, no silent data loss.

## License

[AGPL-3.0-or-later](./LICENSE).

The license is final for Phase 1. Pick polylocale up, run it, modify it,
self-host it; if you offer modified versions over a network, share your
changes back.
