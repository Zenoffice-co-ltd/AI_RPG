# Deploy (App Hosting) — Claude Code rule

**Source of Truth:** repository-root [`AGENTS.md`](../../AGENTS.md) `## Deploy (App Hosting)`. This file is the Claude-side surface of that SoT and intentionally re-states the contract so Claude Code instances can find it without parsing AGENTS.md.

## Scope

The production roleplay UI is the Firebase **App Hosting** backend:

| Field | Value |
|---|---|
| Backend | `adecco-roleplay` |
| Project | `adecco-mendan` |
| Region | `asia-east1` |
| Customer-facing live URL | `https://roleplay.mendan.biz` |
| App Hosting default URL | `https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app` (internal verification / rollback only) |
| Demo path | `/demo/adecco-roleplay-v3` |
| Compute SA | `firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com` |

The legacy Cloud Run service `roleplay-ui` covered in [`docs/deploy.md`](../../docs/deploy.md) is kept for older A/B routes only. **Do NOT run `gcloud run deploy roleplay-ui` for Grok Voice or registered-speech changes** — they will not reach the live App Hosting URL.

## Default deployment model

Expected production path:

```text
merge to main
  -> Firebase App Hosting native automatic rollout
  -> App Hosting GitHub check / Firebase Console rollout status
  -> route/session smoke
  -> targeted voice sentinel when needed
```

Keep deploy status separate from quality status. `deploy success` and
`route/session smoke success` do not mean `human test allowed`.

For v50 remediation, do not use production deploy as the normal test loop.
Convert production failures into deterministic local fixtures / hook tests,
patch in batches, and use targeted `--case-ids` reruns before broad DoD.

Manual App Hosting deploys for this repo must run from
`C:\dev\AI_RPG\_worktrees\deploy_clean`, not from the root `C:\dev\AI_RPG`,
unless the operator explicitly overrides this for a one-off emergency. If the
implementation happened in another worktree, sync/PR the diff before uploading
from `deploy_clean`.

## Manual fallback command

```bash
pnpm deploy:adecco-roleplay
```

Wraps:

1. Baseline rollout snapshot (current rollout id + `guardrailVersion`)
2. `firebase deploy --only apphosting --non-interactive`
3. Rollout polling until `SUCCEEDED`
4. `pnpm grok:warm-tts-cache` (load-bearing — production measured 25 % cache miss without it, 1.5–3 s synth penalty per affected turn)
5. Post-deploy `/api/v3/session` verification (prints new `guardrailVersion` / `promptVersion`)

Bare `firebase deploy` is acceptable for Cloud Build debugging only. Use this
wrapper when the native App Hosting GitHub check is absent, skipped, stuck, or
disabled, or when the operator explicitly requests a manual rollout.

For Firebase CLI auth blockers or explicit gcloud requests, use:

```bash
pnpm deploy:adecco-roleplay:gcloud -- --variant v50-7 --skip-tts-warm
```

For v50-family behavior changes, pass `--variant v50-7` or `--variant v50-8`
so the post-check verifies `/api/grok-first-v50*/session` identity rather than
only `/api/v3/session`. Batch router/guard/runtime fixes and deploy once per
targeted remediation batch; runner-only, docs-only, and unit-test-only edits do
not need App Hosting deploy.

If the gcloud wrapper times out while polling, do not immediately redeploy.
Inspect the exact App Hosting build/rollout in Firebase Console or via the App
Hosting API. If the build is `READY` and the rollout is `SUCCEEDED`, record the
wrapper timeout as a warning and continue with route/session smoke for that
deployed commit.

## Production source of truth

Customer-facing closeout deploys must come from the intended merged
`origin/main` commit. Before deploy, compare `git rev-parse HEAD` with
`git rev-parse origin/main`. If an unmerged local commit is deployed for
emergency validation, treat production as drifted until the diff is PR'd,
merged, verified with `git show origin/main:<path>`, and redeployed from
`origin/main`.

## Auth credential gotcha (load-bearing)

Firebase CLI uses Application Default Credentials. The default ADC at `<gcloud-config-dir>/application_default_credentials.json` is often signed in as a **lower-privilege account** that can read Secret Manager + list rollouts but **cannot** `firebaseapphosting.backends.get` or run `firebase deploy`.

The first failure surfaces as a misleading message:

```
Failed to create backend due to missing delegation permissions for
firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com.
Make sure you have the iam.serviceAccounts.actAs permission.
```

(The backend already exists — this is the owner-vs-non-owner identity problem.)

### Fix

Point `GOOGLE_APPLICATION_CREDENTIALS` at the owner-level ADC file at `<gcloud-config-dir>/legacy_credentials/<owner-account>/adc.json`. Canonical operator-workstation path:

```
C:/Users/yukih/AppData/Roaming/gcloud/legacy_credentials/iwase@zenoffice.co.jp/adc.json
```

**Do NOT** run `gcloud auth application-default login` to "fix" it — that overwrites the default ADC for every other workflow on the machine.

## Required env block (every deploy session)

```bash
export GOOGLE_APPLICATION_CREDENTIALS="<gcloud-config-dir>/legacy_credentials/<owner-account>/adc.json"
export GROK_VOICE_VOICE_ID=99c95cc8a177
export GOOGLE_CLOUD_PROJECT=adecco-mendan
pnpm deploy:adecco-roleplay
```

## Post-deploy verification

The wrapper's verify step only checks `guardrailVersion`. For deploys that change registered-speech artifacts (most current work), also fetch `/api/v3/session` and confirm `registeredSpeech.buildId` matches the just-promoted buildId. Snippet in [`docs/deploy-app-hosting.md`](../../docs/deploy-app-hosting.md) §Step 3.

For enterprise relay routes (`v25`, `v50`, `v50.1`), verify summarized
session/browser evidence from `https://roleplay.mendan.biz`: relay transport,
`wss://voice.mendan.biz/api/v3/realtime-relay`, no browser ephemeral token, and
no direct `wss://api.x.ai`. Cloud Logging structured relay assertions use
`jsonPayload.scope="grokVoice.realtimeRelay"` and `jsonPayload.phase`.

## AccessGate (browser smoke 401)

The demo URL `https://roleplay.mendan.biz/demo/<slug>` is gated by an
HMAC-signed cookie of `DEMO_ACCESS_TOKEN`:

| Cookie | Path | Notes |
|---|---|---|
| `roleplay_access` | `/demo` | UI gate |
| `roleplay_api_access` | `/api` | API gate (broad path covers `/api/v3/...`) |

Both `HttpOnly + Secure + SameSite=Lax`, `maxAge` 8 hours.

`セッションの開始に失敗しました。時間をおいて再試行してください。` ≈ API cookie missing or expired. Re-enter the demo access token via the AccessGate form ("MENDAN AIロープレ — デモを開始するにはアクセスコードを入力してください"). Token via `gcloud secrets versions access latest --secret=demo-access-token --project=adecco-mendan`.

## Rollback

In order of preference:

1. **Env-flag flip** (immediate, no redeploy) — flip the rollback flag the PR shipped on the Firebase Console. Read on next request via `/api/v3/session`.
2. **`git revert <merge-sha>` + `pnpm deploy:adecco-roleplay`** — full code rollback.
3. **Promote a previous READY rollout via Firebase Console** — when `git revert` would also revert intentional changes.

## Failure modes Claude must NOT silently retry

- `Failed to create backend due to missing delegation permissions` — wrong ADC identity. Fix `GOOGLE_APPLICATION_CREDENTIALS`, do NOT loop.
- `Permission 'firebaseapphosting.backends.get' denied` — same root cause.
- Cloud Build failure during `pnpm install` or `next build` — surface the build log URL and stop. Do NOT modify `pnpm-lock.yaml` or `apphosting.yaml` to "make it work" without explicit operator approval.

## Worktree pitfall

`gh pr merge --delete-branch` may demote the source ephemeral worktree, leaving only `node_modules` in `.claude/worktrees/<name>/`. Plan for needing a fresh worktree (`git worktree add`) for any post-merge follow-up work in the same session. The deploy itself is unaffected (Firebase uploads a tarball at deploy time).

## Cross-tool surfaces

This `## Deploy (App Hosting)` rule is the cross-tool **Source of Truth** in [`AGENTS.md`](../../AGENTS.md). Tool-specific surfaces re-state it without owning the contract:

- Full runbook: [`docs/deploy-app-hosting.md`](../../docs/deploy-app-hosting.md)
- Agent-runnable form: [`.agents/skills/ai-rpg-app-hosting-deploy/SKILL.md`](../../.agents/skills/ai-rpg-app-hosting-deploy/SKILL.md)
- Codex command-approval guards: [`.codex/rules/deploy-app-hosting.rules`](../../.codex/rules/deploy-app-hosting.rules)
- Claude Code surface: this file
- Cursor surface: [`.cursor/rules/deploy-app-hosting.mdc`](../../.cursor/rules/deploy-app-hosting.mdc) (`alwaysApply: true`)

Any change to the deploy contract above must update **all six** files in the same change.
