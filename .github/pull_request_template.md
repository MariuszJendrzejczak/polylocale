<!--
Thanks for the PR. The checklist below is the bar this repo holds itself to.
Tick what applies and delete what doesn't.
-->

## Summary

<!-- 1–3 sentences. What does this change and why? -->

## Type of change

- [ ] `feat` — new user-visible capability
- [ ] `fix` — bug fix
- [ ] `refactor` — internal restructure, no behaviour change
- [ ] `docs` — docs only
- [ ] `test` — test only
- [ ] `chore` / `ci` — tooling, dependencies, workflows
- [ ] new format (parser + exporter)

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` is green locally
- [ ] If parser / exporter / model changed: round-trip test added or updated
- [ ] If new format: full checklist in `CLAUDE.md` ("Adding a new format") satisfied
- [ ] If ICU / placeholders touched: preservation tested in both directions
- [ ] If cross-package boundary crossed (`core` ↔ `ai` ↔ `ui` ↔ `app`): called out below
- [ ] If user-visible: `CHANGELOG.md` entry added under `## [Unreleased]`
- [ ] If design decision made: `docs/ARCHITECTURE.md` or `docs/PROJECT.md` updated

## Boundary / scope notes

<!-- If this PR crosses package boundaries, weakens an invariant, or
otherwise has implications beyond the diff, say so here. -->

## Test plan

<!-- How did you verify this? Which test files cover it? For UI changes,
what did you click in the browser? -->

## Related issues

<!-- Fixes #123, refs #456 -->
