# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in polylocale,
please **do not open a public GitHub issue**. Instead, use one of the
private channels below:

- **GitHub Security Advisories** (preferred):
  <https://github.com/MariuszJendrzejczak/polylocale/security/advisories/new>
- **Email:** `jendrzejczak.mariusz@gmail.com` with subject
  `[polylocale security]` — please include a clear description, a
  minimal reproduction, and the impact you observed.

You should receive an acknowledgement within **5 business days**. If
you do not, please follow up — assume the first mail did not arrive.

This project is a one-person side project, so response times are
best-effort. There is no bug bounty program.

## What is in scope

- The polylocale web SPA hosted at `https://polilocale-9c242.web.app/`
  (or any future custom domain).
- All code in this repository: `packages/core`, `packages/ai`,
  `packages/ui`, `apps/app`, the `e2e/` test harness, and CI / deploy
  workflows.
- Issues that could lead to:
  - Disclosure or exfiltration of user-provided API keys (DeepL, OpenAI,
    Anthropic) from the encrypted IndexedDB store.
  - Disclosure or modification of user-opened localization files via the
    File System Access API beyond what the user explicitly authorised.
  - Persistent XSS or HTML injection in the editor surface.
  - Compromise of the build, release, or deploy pipeline.

## What is out of scope

- Bugs that require the user to install a malicious browser extension,
  paste arbitrary code into devtools, or otherwise act against
  themselves.
- Denial of service via excessively large files — the app is
  client-side and the user controls input.
- Missing security hardening that is not exploitable on its own (we
  welcome hardening suggestions as regular issues / PRs).
- Issues affecting unsupported browsers (the app requires the File
  System Access API and is Chromium-first).

## Coordinated disclosure

We will:

1. Acknowledge your report and start triage.
2. Confirm the issue and assess severity.
3. Prepare a fix on a private branch.
4. Coordinate a release date with you. By default we aim to ship a
   fix within **30 days** of confirmation, sooner for critical
   severity.
5. Credit you in the release notes and the GitHub Security Advisory
   unless you ask us not to.

Please give us a reasonable window before public disclosure.

## Supported versions

Only the latest tagged release on `main` is supported. There are no
backports. Users on the hosted build always get the latest release;
self-hosters should track tags published in this repository.
