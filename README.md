# polylocale

[![CI](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/ci.yml/badge.svg)](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/ci.yml)
[![Deploy](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/deploy.yml/badge.svg)](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/deploy.yml)

Open-source, web-based localization manager. Phase 1 is **Flutter-first** —
import, edit, AI-translate, and export `.arb` and JSON locale files, in your
browser, with your own AI keys, with your files staying on your machine.

**Try it:** <https://polilocale.buzzards-soft.com>

> Pre-alpha. Works in Chromium-based browsers (File System Access API).
> DeepL is **not** wired on the hosted version yet — use OpenAI or
> Anthropic providers instead. See [`docs/deployment-plan.md`](./docs/deployment-plan.md) §6 for why.

> **Status:** pre-alpha. The core layer ships flat-JSON and ARB
> parsers + exporters with structural ICU IR and round-trip property
> tests. UI, AI providers, and persistence are still ahead.

## Why

Flutter localization tooling is less mature than the React/web ecosystem,
and ARB is a Flutter-specific format underserved by existing SaaS. Indie
devs and small studios end up either editing `.arb` files by hand or paying
SaaS prices for things they don't need.

polylocale aims to be the **fast, dev-friendly, files-as-source-of-truth**
alternative — local first, no account, AI-assisted when you want it.

## Phase 1 scope

- Formats: `.arb` (with full ICU MessageFormat + `@key` metadata), flat JSON,
  nested JSON
- Tabular UI: rows = keys, columns = locales, inline editing, missing/review
  highlighting, placeholder mismatch detection
- AI translation via DeepL, Google Translate, OpenAI, Anthropic — your keys,
  encrypted locally, never sent to anyone but the provider you chose
- Round-trip lossless: import → edit → export must produce structurally
  identical files
- Local-only: open a folder, work, save back — no login, no cloud

What's **out of scope** for Phase 1: React/web formats (Phase 2),
iOS/Android native formats (Phase 3), multi-user collaboration, git
integration, cloud sync. See [`docs/PROJECT.md`](./docs/PROJECT.md) for the full scope.

## Stack

TypeScript · React 19 · Vite · pnpm monorepo (`packages/core`, `packages/ai`,
`packages/ui`, `apps/app`) · File System Access API + IndexedDB · WebCrypto
for API key encryption · Vitest + fast-check for tests · ESLint + Prettier.

Full architecture and decision rationale: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Getting started

> Nothing to run yet — placeholder Vite app prints a banner. Real features
> ship from Session 2 onward.

```bash
pnpm install
pnpm dev          # Vite dev server on :5173
pnpm test         # Vitest (no tests yet)
pnpm lint
pnpm typecheck
pnpm build
```

## Contributing

Please read [`CLAUDE.md`](./CLAUDE.md) (instructions for AI agents and an
honest summary of conventions for humans) and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
(the _why_ behind the architecture) before opening a PR. The original
kickoff brief is in [`doc/BRIEF.md`](./doc/BRIEF.md).

A new file format is always welcome — the addition checklist is in
`CLAUDE.md`. Quality bar: round-trip lossless, ICU/placeholder preservation,
no silent data loss.

## License

[AGPL-3.0-or-later](./LICENSE).

The license is final for Phase 1. Pick polylocale up, run it, modify it,
self-host it; if you offer modified versions over a network, share your
changes back.
