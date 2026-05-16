# Contributing to polylocale

Thanks for your interest. polylocale is a solo side project in
pre-alpha — small, focused contributions are the easiest to land. This
file covers the practical bits; design rationale lives in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and project scope in
[`docs/PROJECT.md`](./docs/PROJECT.md).

## Before you open a PR

1. **Read [`CLAUDE.md`](./CLAUDE.md)** — it documents conventions for AI
   agents _and_ is the most honest summary of how the repo is organised.
2. **Check the roadmap** in `docs/PROJECT.md`. Phase 1 is Flutter
   formats only (ARB, flat JSON, nested JSON). Phase 2 is web formats
   (i18next, FormatJS). Phase 3 is native (iOS strings, Android XML).
   Proposals outside the current phase are welcome as issues, but PRs
   should target the current phase.
3. **Open an issue first** for non-trivial changes. We can save you
   work by flagging design conflicts early.

## Setting up

Requirements: **Node 22+**, **pnpm 11+**.

```bash
pnpm install
pnpm dev                # http://localhost:5173
pnpm test               # Vitest, all packages
pnpm lint               # ESLint
pnpm typecheck          # tsc -b
pnpm format:check       # Prettier
pnpm build              # production build
```

End-to-end (Playwright) tests:

```bash
pnpm e2e:install        # once — downloads Chromium
pnpm build              # E2E serves the production build
pnpm e2e
```

## Commit messages

We use **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`,
`test:`, `refactor:`, `ci:`, `style:`). Scope is the affected package
or area: `feat(core):`, `feat(app):`, `fix(ui):`, `ci:`. Examples from
real history:

- `feat(core): add ARB parser with @@ and @key metadata handling`
- `fix(ui): drop overflow:hidden on body cells so popovers can escape`
- `test(core): add fast-check property-based round-trip tests`

Subject line stays under ~72 chars. Body explains _why_ when the change
is not obvious from the diff.

## Pull requests

- **Squash-merge only.** PRs land as a single commit on `main`. Write
  the commit message you want to see in `git log` as the PR title.
- **Small and focused.** One concern per PR. A refactor + a feature is
  two PRs.
- **Green CI is a blocker.** Lint, typecheck, test, build, E2E must
  pass.
- **Keep `main` shippable.** Production deploys are cut from `main` by
  pushing a `vMAJOR.MINOR.PATCH` tag — see [README → Releasing](./README.md#releasing).

The repo ships a [pull-request template](./.github/pull_request_template.md)
with a checklist; please fill it out.

## Adding a new format

A new file format is the most common substantive contribution. The
full checklist lives in [`CLAUDE.md`](./CLAUDE.md) under _"Adding a new
format"_. In short:

- Parser → exporter → round-trip test → property-based test
  (`fast-check`) → realistic fixtures → edge-case fixtures → locale
  detection → `SupportedFormat` union update → docs.

A new format is **not done** until all of the above are green and CI
is green.

## Quality bar

These are non-negotiable for `packages/core`:

- **Round-trip lossless.** `parse → export → parse` must be deep-equal
  for every supported input.
- **ICU / placeholder preservation.** Placeholders must survive an AI
  translation cycle in both directions.
- **No silent data loss.** Unknown fields survive via `formatMetadata`.
- **Deterministic exports.** Byte-stable output for the same model
  input.

`packages/core` has zero UI / AI / storage / DOM dependencies. If a
change crosses package boundaries (`core` → `ai`, `ai` → `ui`, etc.),
call it out in the PR description.

## Security

Security issues go to the private channels in
[`SECURITY.md`](./SECURITY.md), not the public issue tracker.

## Code of conduct

This project follows the
[Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you
agree to abide by it.

## License

Contributions land under the same license as the project —
[AGPL-3.0-or-later](./LICENSE). By opening a PR you confirm you have
the right to contribute the code under that license.
