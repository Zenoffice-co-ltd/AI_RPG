---
name: ai-rpg-app-hosting-deploy
description: Use when the task requires deploying the adecco-roleplay App Hosting backend (Firebase App Hosting in adecco-mendan, asia-east1). Triggers include "デプロイして", "deploy this PR to production", "run pnpm deploy:adecco-roleplay", "ship the registered-speech rebuild", post-merge productionization. Do NOT use for the legacy Cloud Run roleplay-ui service (see docs/deploy.md).
---

# AI RPG — Adecco Roleplay App Hosting Deploy

**Cross-tool Source of Truth:** repository-root [`AGENTS.md`](../../../AGENTS.md) `## Deploy (App Hosting)`. This skill is the agent-runnable form. When in doubt, prefer the runbook at [`docs/deploy-app-hosting.md`](../../../docs/deploy-app-hosting.md).

Tool-specific surfaces (re-state the same rules):
- Codex command-approval guards: [`.codex/rules/deploy-app-hosting.rules`](../../../.codex/rules/deploy-app-hosting.rules)
- Claude Code surface: [`.claude/rules/deploy-app-hosting.md`](../../../.claude/rules/deploy-app-hosting.md)
- Cursor surface: [`.cursor/rules/deploy-app-hosting.mdc`](../../../.cursor/rules/deploy-app-hosting.mdc) (`alwaysApply: true`)

Any change to the deploy contract must update **all six** files in the same change.

## Pre-flight checks (do these BEFORE running any deploy command)

1. **Confirm what is being deployed.** Normal customer-facing deploys must be from the intended merged `origin/main` commit. Run `git fetch origin`, `git status --short`, `git rev-parse HEAD`, and `git rev-parse origin/main`. If an unmerged local commit was deployed for emergency validation, treat production as drifted until the diff is PR'd, merged, verified with `git show origin/main:<path>`, and redeployed from `origin/main`. For registered-speech deploys, read the promoted `buildId` and `voiceId` so you can later verify the live `/api/v3/session` returns the same values.

2. **Confirm the active gcloud account is project owner.**
   ```bash
   gcloud auth list                                                    # iwase@zenoffice.co.jp ACTIVE
   ```
   If not, ask the operator to switch — do NOT proceed under a non-owner identity.

3. **Confirm the owner ADC file exists.**
   The default ADC at `%APPDATA%/gcloud/application_default_credentials.json` is typically a different (lower-privilege) account that fails Firebase deploy with a misleading "Failed to create backend" error. The owner credential lives at `<gcloud-config-dir>/legacy_credentials/<owner-account>/adc.json`. On the canonical operator workstation:
   ```
   C:/Users/yukih/AppData/Roaming/gcloud/legacy_credentials/iwase@zenoffice.co.jp/adc.json
   ```

## Default deployment model

The expected production path is Firebase App Hosting native automatic rollout:

```text
merge to main
  -> App Hosting live-branch rollout
  -> App Hosting GitHub check / Firebase Console rollout status
  -> route/session smoke
  -> targeted voice sentinel when needed
```

Keep deploy status separate from quality gates. `deploy success` and
`route/session smoke success` do not mean `human test allowed`.

For v50 remediation, keep deploy out of the inner test loop: create local
deterministic fixtures or hook/unit tests for production failures, patch in a
batch, and use `--case-ids` targeted reruns before any broad DoD rerun.

The repo-side post-merge workflow is
`.github/workflows/apphosting-main-post-merge.yml`. It waits for the native
rollout and runs route/session smoke when `DEMO_ACCESS_TOKEN` is configured.
It can run the targeted production voice sentinel through manual
`workflow_dispatch`.

## Manual fallback deploy

```bash
export GOOGLE_APPLICATION_CREDENTIALS="C:/Users/yukih/AppData/Roaming/gcloud/legacy_credentials/iwase@zenoffice.co.jp/adc.json"
export GROK_VOICE_VOICE_ID=99c95cc8a177
export GOOGLE_CLOUD_PROJECT=adecco-mendan
pnpm deploy:adecco-roleplay
```

Use the wrapper when the App Hosting GitHub check is absent, skipped, stuck, or
disabled, or when the operator explicitly requests a manual rollout.

The wrapper does:

1. Baseline snapshot (current rollout id + guardrailVersion)
2. `firebase deploy --only apphosting --non-interactive`
3. Poll until rollout `SUCCEEDED`
4. `pnpm grok:warm-tts-cache` (16 PR60 canonicals; without this the first ~25% of turns hit a 1.5–3s synth penalty)
5. Re-fetch `/api/v3/session` and print new guardrailVersion / promptVersion

Expected total time: **~6–7 minutes**. **~9–10 minutes** if `pnpm-lock.yaml` changed.

The "guardrailVersion did not change" note at the end is **only a real flag when the deploy was supposed to bump guardrail**. Registered-speech artifact rebuilds (most Haruto-era PRs) leave it unchanged and the note is informational.

### gcloud wrapper and v50 variants

When Firebase CLI auth is blocked or the operator asks for the gcloud path, use:

```bash
pnpm deploy:adecco-roleplay:gcloud -- --variant v50-7 --skip-tts-warm
```

For v50-family behavior changes, pass `--variant v50-7` or `--variant v50-8`
so the post-check verifies `/api/grok-first-v50*/session` identity
(`backend`, `promptVersion`, `guardrailVersion`) instead of only
`/api/v3/session`. Use `--skip-tts-warm` only when the change does not affect
registered-speech/TTS artifacts.

To shorten deploy cycles, batch router/guard/runtime fixes and deploy once per
targeted remediation batch. Do not deploy for runner-only, docs-only, or
unit-test-only edits; do deploy before claiming production voice evidence for
changes under `apps/web/lib/grok-first-roleplay/**`, v50 route/session APIs, or
client runtime behavior.

## Post-deploy verification (REQUIRED)

The wrapper only checks `guardrailVersion`. For every deploy, also confirm the live bundle:

```bash
DEMO_TOKEN=$(gcloud secrets versions access latest --secret=demo-access-token --project=adecco-mendan)
SIG=$(python -c "import hmac,hashlib,sys; t=sys.argv[1]; print(hmac.new(t.encode(),t.encode(),hashlib.sha256).hexdigest())" "$DEMO_TOKEN")
curl -s "https://roleplay.mendan.biz/api/v3/session" \
  -X POST -H "content-type: application/json" \
  -H "origin: https://roleplay.mendan.biz" \
  -H "referer: https://roleplay.mendan.biz/demo/adecco-roleplay-v3" \
  -H "cookie: roleplay_api_access=$SIG" \
  -d '{}' > out/post-deploy-session.json
node -e "const d=JSON.parse(require('fs').readFileSync('out/post-deploy-session.json','utf8'));const rs=d.registeredSpeech||{};console.log('manifestVersion:',rs.manifestVersion);console.log('buildId:',rs.buildId);console.log('voiceId:',rs.voiceId);console.log('artifacts:',(rs.artifacts||[]).length);"
rm -f out/post-deploy-session.json
```

Assert: `buildId` matches the buildId you just promoted. If it lags, inspect
the App Hosting GitHub check / Firebase Console rollout first. If native
auto-rollout did not run, use the manual fallback wrapper from the intended
`origin/main` commit.

For relay routes (`v25`, `v50`, `v50.1`), also assert the summarized session/browser contract: `realtimeTransport=mendan_cloud_run_relay_wss`, `wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay`, `realtimeAuth.mode=mendan_relay_subprotocol`, no browser `ephemeralToken`, and no direct browser `wss://api.x.ai`. Use Cloud Logging structured relay logs with `jsonPayload.scope="grokVoice.realtimeRelay"` and `jsonPayload.phase` for `client.connected`, `ticket.accepted`, and `upstream.connected`; do not store raw JSON in git.

## Pre-deploy commit hygiene

If the PR also rebuilt registered-speech artifacts, ensure these are staged and pushed BEFORE deploy (Firebase App Hosting uploads the **local** working tree per `firebase.json` `alwaysDeployFromSource: true`):

- `data/generated/registered-speech/v1/manifest.json`
- `data/generated/registered-speech/v1/artifacts/*.pcm`
- `data/generated/registered-speech/APPROVALS.md`
- `apps/web/lib/roleplay/registered-speech/manifest-constant.ts`

Otherwise the deploy ships a stale bundle even if the schema check is happy.

## Manual smoke (operator)

After verification, drive the 16-turn smoke listed in [`docs/grok-voice-haruto-closeout-20260512.md`](../../docs/grok-voice-haruto-closeout-20260512.md) §"Layer D — Production smoke + Cloud Logging assert". This requires real microphone interaction and cannot be agent-automated.

The agent's role here is to:

- Surface the live URL
- Surface the access token retrieval command (do not log the token value itself)
- Wait for the operator's confirmation
- Run `pnpm grok:audio-e2e:prod-log-assert --minutes 30 --json out/<short-name>_prod_assert.json` after smoke

## Browser AccessGate (if operator reports `セッションの開始に失敗しました`)

Almost always = `roleplay_api_access` cookie missing.

Fix path:

1. Operator opens `https://roleplay.mendan.biz/demo/adecco-roleplay-v3`
2. AccessGate form renders ("MENDAN AIロープレ — デモを開始するにはアクセスコードを入力してください")
3. Operator pastes `gcloud secrets versions access latest --secret=demo-access-token --project=adecco-mendan` output
4. Submit "開始" → both `roleplay_access` (path=/demo) and `roleplay_api_access` (path=/api) cookies set, redirected to roleplay shell

Cookies have `maxAge` 8 hours. Re-entry needed after that.

## Failure modes the agent must NOT silently retry

- `Failed to create backend due to missing delegation permissions for firebase-app-hosting-compute@adecco-mendan...` — wrong ADC identity. Fix `GOOGLE_APPLICATION_CREDENTIALS` env, do NOT loop. The backend exists; this is the misleading owner-vs-non-owner error.
- `Permission 'firebaseapphosting.backends.get' denied` — same root cause as above.
- Cloud Build failure during `pnpm install` or `next build` — surface the build log URL and stop. Do not modify `pnpm-lock.yaml` or `apphosting.yaml` to "make it work" without explicit operator approval.

## Worktree pitfall (Claude Code only)

`gh pr merge --delete-branch` may demote the source ephemeral worktree, leaving only `node_modules` in `.claude/worktrees/<name>/`. Plan for needing a fresh worktree (`git worktree add`) for any post-merge follow-up work in the same session. The deploy itself is unaffected because Firebase uploads a tarball at deploy time.

## Rollback options

In order of preference:

1. **Env-flag flip** (immediate, no redeploy) — use the rollback flag the PR shipped. Reads on next request via `/api/v3/session`.
2. **`git revert <merge-sha>` + `pnpm deploy:adecco-roleplay`** — full code rollback.
3. **Promote a previous READY rollout via Firebase Console** — when the offending change is in source.json / artifacts and `git revert` would also revert intentional changes.

## DOD

- `pnpm deploy:adecco-roleplay` exit 0
- Rollout state SUCCEEDED
- Deployed commit is the intended merged `origin/main`
- `/api/v3/session` returns the just-promoted `buildId` / `voiceId`
- Operator manual smoke (16 turns) confirms greeting / business intents / repeat / fallback all behave
- `pnpm grok:audio-e2e:prod-log-assert` returns `overallPass=true` (see closeout doc §"Production goal")
