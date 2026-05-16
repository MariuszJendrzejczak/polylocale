# deployment-plan.md — polylocale

> Step-by-step deployment recipe for hosting polylocale at
> `polilocale.buzzards-soft.com` via Firebase Hosting.
>
> Split into **Mariusz tasks** (console / DNS / billing — actions outside
> the repo) and **Claude tasks** (repo files / CI / docs — actions inside
> the repo). Order matters: most Mariusz steps must finish before Claude
> can wire the repo, because the workflow needs the GitHub secret and the
> Firebase project id.

---

## 0. Decisions locked in

| Decision                  | Value                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| Hosting provider          | Firebase Hosting (Spark / free plan)                                 |
| Firebase project          | **New, dedicated project** — isolated from `buzzards-soft.com`       |
| Public URL                | `https://polilocale.buzzards-soft.com`                               |
| Deploy trigger            | Push of a git tag matching `v*.*.*` (+ manual `workflow_dispatch`)   |
| Build command             | `pnpm -F @polylocale/app build` → `apps/app/dist`                    |
| GitHub Action             | `FirebaseExtended/action-hosting-deploy@v0`                          |
| DeepL on production       | **Not wired in this iteration** — see §6 "Known limitations"         |
| OpenAI / Anthropic on prod| Works out of the box (CORS-friendly endpoints, see ARCHITECTURE §4.6)|
| Cloud organization        | **None** — standalone project; org migration + WIF deferred (see §6) |
| Firebase project id       | `polilocale-9c242`                                                   |

---

## 1. Prerequisites

Before starting, confirm:

- [ ] You have owner access on the `buzzards-soft.com` DNS zone (registrar
      or DNS provider — wherever NS records point).
- [ ] You have a Google account with rights to create Firebase projects.
      If the account is at the project-count cap, see §2.1.
- [ ] You have repo admin rights on `MariuszJendrzejczak/polylocale` (or
      whatever the GitHub slug ends up being) to add Actions secrets.

---

## 2. Mariusz tasks — one-time setup

These run **before** Claude wires the repo. Approximate total wall-clock:
~30 min of clicking, plus DNS propagation waiting (minutes to hours) and
TLS provisioning (up to 24h after domain verification).

### 2.1 Firebase project quota (only if blocked)

Google enforces a project-count limit per account (the "Quota exceeded"
dialog will appear when you try to create a new project).

1. Open the dialog → click "Request a quota increase" → fill the short form
   (project name `polilocale`, reason: "open-source localization manager,
   client-only SPA").
2. Approval usually arrives within hours. If urgent and you want to bypass
   the wait, you can also delete an unused old Firebase project to free a
   slot.

### 2.2 Create the Firebase project

1. <https://console.firebase.google.com> → **Add project**.
2. Project name: `polilocale`. Firebase generates an id; **the actual id
   for this deploy is `polilocale-9c242`** (already baked into
   `.firebaserc` and the workflow).
3. **Do NOT attach the project to any Google Cloud organization.** Leave it
   as standalone ("no organization"). Reason: new Google Cloud orgs ship
   with `iam.disableServiceAccountKeyCreation` enforced by default, which
   blocks §2.3. When a target organization later exists, migrate the
   project into it and switch CI auth to Workload Identity Federation
   (tracked in §6 "Cloud organization & WIF migration").
4. Decline Google Analytics for now (we don't want analytics on user files).
5. Stay on the **Spark plan** (free). Do not upgrade to Blaze — Hosting
   alone does not require it.
6. In the new project: left nav → **Build → Hosting → Get started**. Skip
   the CLI walkthrough Firebase suggests — Claude handles the repo side.

### 2.3 Generate a service-account key for CI

> Only works when the project is **outside** a Google Cloud organization
> that enforces `iam.disableServiceAccountKeyCreation`. If you see
> *"Key creation is not allowed on this service account"*, the project
> was attached to an org — either detach and recreate (§2.2 step 3) or
> follow the WIF path described in §6.

1. In Firebase Console → ⚙ → **Project settings → Service accounts**.
2. Click **Generate new private key** → confirm → a JSON file downloads.
   Keep it locally; never commit it.
3. Verify the service account has the roles needed by
   `action-hosting-deploy`:
   - `Firebase Hosting Admin` (default for the generated key)
   - `Cloud Run Viewer` (the action lists Cloud Run revisions even when
     none exist; missing it gives a noisy warning, not a failure)

   If a role is missing, add it via Google Cloud Console → IAM → find the
   service-account principal → **Edit permissions**.

### 2.4 Add the service-account JSON to GitHub Secrets

1. GitHub repo → **Settings → Secrets and variables → Actions → New
   repository secret**.
2. Name: `FIREBASE_SERVICE_ACCOUNT_POLILOCALE`
3. Value: paste the **full JSON file contents** (including the curly
   braces, no extra whitespace).
4. Save.

### 2.5 Add the custom domain in Firebase Hosting

1. Firebase Console → **Hosting → Custom domains → Add custom domain**.
2. Domain: `polilocale.buzzards-soft.com`.
3. Firebase shows a **TXT record** for domain verification — copy it.
4. After verification it shows two **A records** with Firebase's IPs —
   copy both.

### 2.6 DNS records on `buzzards-soft.com`

In your DNS provider for `buzzards-soft.com`:

1. Add the **TXT record** Firebase printed in §2.5 step 3.
   - Host: `polilocale` (provider may want `polilocale.buzzards-soft.com`
     fully qualified — follow its convention)
   - Value: the long string Firebase gave you (starts with
     `firebase=` or `google-site-verification=`).
2. Wait for verification — refresh the Firebase Custom Domain dialog until
   the green check appears. Usually 5–30 min.
3. Add both **A records** Firebase printed in §2.5 step 4.
   - Host: `polilocale`
   - Value: each Firebase IP, one A record per IP.
4. Wait for DNS propagation (15 min – 2h typical). Firebase will start
   provisioning a Let's Encrypt cert automatically once the A records
   resolve. SSL "Connected" status can take up to 24h after that — don't
   panic if you see `ERR_SSL_PROTOCOL_ERROR` for a few hours.

### 2.7 Trigger the first deploy

Wait until §3 is done (Claude has merged the repo wiring). Then:

```bash
git checkout main
git pull
git tag v0.0.1-deploy-test
git push origin v0.0.1-deploy-test
```

Open the repo on GitHub → Actions tab → watch the `Deploy` workflow run.

---

## 3. Claude tasks — repo wiring

These changes land in **one PR**, merged to `main` before the first tag
push in §2.7. The PR is intentionally small; review surface is the four
files below plus README and `.gitignore` deltas.

### 3.1 `firebase.json` (new, repo root)

```json
{
  "hosting": {
    "public": "apps/app/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "/assets/**",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "public, max-age=31536000, immutable"
          }
        ]
      },
      {
        "source": "/index.html",
        "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
      }
    ]
  }
}
```

Notes:
- `public` is the Vite output, not the workspace root.
- `rewrites` is forward-compat for adding a router later. With the current
  single-page UI it is a no-op.
- Long cache on `/assets/**` is safe because Vite hashes filenames; new
  builds get fresh URLs.

### 3.2 `.firebaserc` (new, repo root, committed)

```json
{
  "projects": {
    "default": "polilocale-9c242"
  }
}
```

This file is **not a secret** — it just pins which Firebase project
`firebase deploy` and the Action target by default.

### 3.3 `.github/workflows/deploy.yml` (new)

```yaml
name: Deploy

on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:

jobs:
  deploy:
    name: Build + Deploy to Firebase Hosting (live)
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build app
        run: pnpm -F @polylocale/app build

      - name: Deploy to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_POLILOCALE }}
          channelId: live
          projectId: polilocale-9c242
```

Deliberate choices:
- **No `needs: ci`.** Tags are only cut from green main, so the CI run
  on the merge commit already protects us. Re-running lint/typecheck/test
  on a deploy adds 3+ minutes for no extra signal.
- **`-F @polylocale/app`**, not `pnpm -r build`. We only need the SPA.
- **`channelId: live`** = production channel. PR preview channels are a
  separate, deferred feature.

### 3.4 README badge + "Try it" section

Add near the top of `README.md`:

```markdown
[![CI](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/ci.yml/badge.svg)](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/ci.yml)
[![Deploy](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/deploy.yml/badge.svg)](https://github.com/MariuszJendrzejczak/polylocale/actions/workflows/deploy.yml)

**Try it:** <https://polilocale.buzzards-soft.com>

> Pre-alpha. Works in Chromium-based browsers (File System Access API).
> DeepL is **not** wired on the hosted version yet — use OpenAI or
> Anthropic providers instead. See §6 below for why.
```

### 3.5 `.gitignore` deltas

Confirm these patterns are present (add if missing):

```
.firebase/
firebase-debug.log
*.env.local
```

The service-account JSON should never be in the repo — it lives only in
GitHub Secrets.

---

## 4. First deploy (joint)

1. Claude opens the PR with §3.1–§3.5.
2. CI green → Mariusz merges to `main`.
3. Mariusz performs §2.7.
4. Workflow run completes → check that the "Deploy to Firebase Hosting"
   step prints a hosting URL ending in `web.app` (the auto-generated
   default channel URL).
5. Confirm the same content is at `https://polilocale.buzzards-soft.com`
   (once DNS + TLS are live from §2.6).

---

## 5. Verification checklist

After the first deploy, in this order:

1. **Workflow run green** — no red steps in the GitHub Actions log.
2. **Direct hosting URL** — visit the `*.web.app` URL the workflow
   printed. App loads, no console errors.
3. **Custom domain** — visit `https://polilocale.buzzards-soft.com`. Cert
   valid (padlock in browser). Same content as step 2.
4. **Cache headers** —
   - `curl -I https://polilocale.buzzards-soft.com/index.html` →
     `cache-control: no-cache`.
   - `curl -I https://polilocale.buzzards-soft.com/assets/<any>.js` →
     `cache-control: public, max-age=31536000, immutable`.
5. **App smoke test in Chrome / Edge** —
   - Open a folder of `.arb` or flat JSON files → picker appears, files
     load into the editor.
   - Edit a cell, save → file on disk changes.
   - Reload the tab → state restores from IndexedDB cache.
   - Enter an OpenAI key in Settings → translate a cell → succeeds.
   - Try DeepL → expect a clear error message, not a hang. (Proves the
     known limitation surfaces cleanly.)
6. **Re-deploy** — push a `v0.0.2-deploy-test` tag, watch the workflow
   trigger, verify the new build is live.

If any of 1–6 fails, see §7 troubleshooting.

---

## 6. Known limitations & follow-ups

### DeepL on production — deferred

**Why:** DeepL does not return CORS headers, so a browser request from
`polilocale.buzzards-soft.com` to `api-free.deepl.com` is blocked at
preflight. The dev environment uses Vite's dev proxy on `/api/deepl/*`
(see `apps/app/vite.config.ts`); production needs an equivalent
same-origin proxy. ARCHITECTURE.md §4.3 has the full reasoning.

**Resolution path** (separate session): add a **Cloudflare Worker** at
`/api/deepl/*` proxying to DeepL Free/Pro based on the API key suffix.
Cloudflare Workers' free tier (100k requests/day) is more than enough
for indie use. The worker lives in its own repo (or `tools/deepl-proxy/`)
because deploying it does not gate the SPA deployment.

**User-visible behaviour until then:** opening the DeepL provider in
Settings is fine; trying to translate via DeepL surfaces a fetch error.
OpenAI and Anthropic work normally.

### PWA installability — Phase 2

Not in this iteration. Once we add a `manifest.webmanifest` and a
service worker (offline cache for the SPA shell), the same Firebase
deployment will start showing the install prompt automatically.

### Cloud organization & WIF migration — later

**Why deferred:** The deploy project (`polilocale-9c242`) currently lives
outside any Google Cloud organization. New orgs default to
`iam.disableServiceAccountKeyCreation = Enforced`, which blocks §2.3 and
forces a migration to Workload Identity Federation. Doing both
(create-org + WIF) at the same time as the first deploy was too much
moving surface for the initial smoke test.

**Resolution path** (separate session, when a target organization exists):

1. Migrate `polilocale-9c242` into the target org via GCP Console →
   **IAM & Admin → Migrate**, or
   `gcloud beta projects move polilocale-9c242 --organization=<ORG_ID>`.
2. Create a dedicated service account in the project
   (`github-deploy@polilocale-9c242.iam.gserviceaccount.com`) with role
   `roles/firebasehosting.admin`. Do **not** generate a key.
3. Set up a Workload Identity Pool `github-pool` with OIDC provider
   pointing at `https://token.actions.githubusercontent.com`, with an
   attribute condition pinning `assertion.repository == 'MariuszJendrzejczak/polylocale'`.
4. Bind the WIF identity to impersonate the SA:
   `roles/iam.workloadIdentityUser` on
   `principalSet://iam.googleapis.com/projects/<NUM>/locations/global/workloadIdentityPools/github-pool/attribute.repository/MariuszJendrzejczak/polylocale`.
5. Swap `.github/workflows/deploy.yml`: drop the `firebaseServiceAccount`
   input on `action-hosting-deploy`, add `google-github-actions/auth@v2`
   with the WIF provider + service account, add the workflow-level
   `id-token: write` permission. Or switch the deploy step to
   `npx firebase-tools deploy --only hosting --non-interactive`
   (ADC-based).
6. Delete the `FIREBASE_SERVICE_ACCOUNT_POLILOCALE` GitHub secret.

After this, the project is org-managed, no long-lived keys exist, and the
deployment pipeline still triggers on `v*.*.*` tags.

### PR preview channels — easy add later

`FirebaseExtended/action-hosting-deploy@v0` supports
`channelId: pr-${{ github.event.number }}` on `pull_request` events to
spin up isolated preview URLs. Skipped now to keep the workflow short.

---

## 7. Troubleshooting

| Symptom                                        | Likely cause                                        | Fix                                                                                              |
| ---------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Workflow fails at "Deploy" with `auth/...`     | Wrong / malformed JSON in `FIREBASE_SERVICE_ACCOUNT_POLILOCALE` | Regenerate the key in §2.3, paste the full JSON again.                                           |
| Workflow succeeds, but `*.web.app` shows 404   | `firebase.json` `public` path wrong                 | Confirm it is `apps/app/dist` (Vite default), not `dist` or `public`.                            |
| Workflow succeeds, custom domain shows old build | DNS cached / Firebase CDN edge cache               | Hard-refresh; wait 1–5 min; check Hosting → Release history shows the new release as Active.    |
| `ERR_SSL_PROTOCOL_ERROR` on custom domain      | TLS cert not yet provisioned by Firebase            | Wait up to 24h after DNS verification. Firebase shows "Provisioning" state during this window.   |
| Build fails locally but not in CI (or vice versa) | Lockfile drift                                    | `pnpm install --frozen-lockfile` locally; commit any `pnpm-lock.yaml` diff.                      |
| `Cache-Control` missing on assets              | `firebase.json` `headers` glob did not match        | Verify file path under `dist/` matches `/assets/**`; Vite outputs there by default.              |

---

## 8. What this plan does NOT cover

- Migrating or touching the existing `buzzards-soft.com` Firebase project.
- DeepL proxy infrastructure (separate session).
- Multi-environment setup (staging vs production) — current scope is one
  channel: `live`.
- Releases / GitHub Releases automation — the `v*` tag is the source of
  truth; release notes are out of scope here.
