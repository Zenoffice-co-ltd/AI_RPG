# Deploy: Adecco Roleplay (Firebase App Hosting)

Canonical runbook for deploying the `adecco-roleplay` App Hosting backend.
Replaces the legacy Cloud Run flow in `docs/deploy.md` for the production
roleplay UI.

> **Cross-tool Source of Truth:** repository-root [`AGENTS.md`](../AGENTS.md)
> `## Deploy (App Hosting)`. This runbook is the procedural detail; the
> AGENTS.md section is the contract. Tool-specific surfaces that re-state
> the same rules:
>
> - Agent-runnable form: [`.agents/skills/ai-rpg-app-hosting-deploy/SKILL.md`](../.agents/skills/ai-rpg-app-hosting-deploy/SKILL.md)
> - Codex command-approval guards: [`.codex/rules/deploy-app-hosting.rules`](../.codex/rules/deploy-app-hosting.rules)
> - Claude Code surface: [`.claude/rules/deploy-app-hosting.md`](../.claude/rules/deploy-app-hosting.md)
> - Cursor surface: [`.cursor/rules/deploy-app-hosting.mdc`](../.cursor/rules/deploy-app-hosting.mdc) (`alwaysApply: true`)
>
> **Any change to the deploy contract must update all six files in the
> same change** (this runbook + the AGENTS.md section + the four
> tool-specific surfaces above).

## Target

| Field | Value |
|---|---|
| GCP project | `adecco-mendan` |
| App Hosting backend | `adecco-roleplay` |
| Region | `asia-east1` |
| Live URL | `https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app` |
| Demo path | `/demo/adecco-roleplay-v3` |
| Compute SA | `firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com` |

App Hosting **auto-deploy on main push is NOT configured** for this backend.
Every deploy is a manual `pnpm deploy:adecco-roleplay` invocation. Merging a
PR to main does NOT make code live; see the deploy lag note below.

## Step 0 — Auth credential (the load-bearing gotcha)

Firebase CLI uses Application Default Credentials (ADC) when
`GOOGLE_APPLICATION_CREDENTIALS` is set, otherwise its own OAuth login
(`firebase login`) which is typically not configured in this repo's working
machines.

### Why the default ADC fails

`gcloud auth application-default login`'s default ADC at
`%APPDATA%/gcloud/application_default_credentials.json` is often signed in
as a **lower-privilege Google account** (e.g. a personal `@gmail.com`).
That account can read Secret Manager and list App Hosting rollouts, but
cannot:

- `firebaseapphosting.backends.get`
- `iam.serviceAccounts.actAs` on the App Hosting compute SA
- run `firebase deploy --only apphosting`

The first failure surfaces as a misleading message:

```
Failed to create backend due to missing delegation permissions for
firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com.
Make sure you have the iam.serviceAccounts.actAs permission.
```

(Misleading because the backend already exists — the actual cause is the
ADC identity not being the project owner.)

### The fix: point ADC at the owner credential

The owner-level credential (`iwase@zenoffice.co.jp`, `roles/owner` on
`adecco-mendan`) is stored separately under
`legacy_credentials/<account>/adc.json` in the `gcloud` config dir. On the
canonical operator workstation:

```
C:/Users/yukih/AppData/Roaming/gcloud/legacy_credentials/iwase@zenoffice.co.jp/adc.json
```

This is a valid `authorized_user` ADC file (refresh_token + client_id +
client_secret). On other machines the path is
`<gcloud-config-dir>/legacy_credentials/<owner-account>/adc.json`.

```bash
export GOOGLE_APPLICATION_CREDENTIALS="C:/Users/yukih/AppData/Roaming/gcloud/legacy_credentials/iwase@zenoffice.co.jp/adc.json"
```

**Do NOT** run `gcloud auth application-default login` to "fix" it —
that overwrites the default ADC for every other workflow on the machine.
Just point at the legacy_credentials file via env for the duration of the
deploy.

### Sanity checks before deploy

```bash
# Active gcloud account is owner-level on adecco-mendan
gcloud auth list                                                    # iwase@zenoffice.co.jp ACTIVE
gcloud projects get-iam-policy adecco-mendan \
  --flatten='bindings[].members' --format='table(bindings.role)' \
  --filter='bindings.members:iwase@zenoffice.co.jp'                 # roles/owner

# ADC token successfully reads the App Hosting backend
TOKEN=$(gcloud auth print-access-token) && curl -sf -H "Authorization: Bearer $TOKEN" \
  "https://firebaseapphosting.googleapis.com/v1/projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay" \
  | head -1
```

If the curl returns a JSON body with `"name": "projects/adecco-mendan/..."`,
the active gcloud token has the deploy permissions. Firebase CLI will use
the same identity once `GOOGLE_APPLICATION_CREDENTIALS` points at the
matching ADC file.

## Step 1 — Required env

```bash
export GOOGLE_APPLICATION_CREDENTIALS="C:/Users/yukih/AppData/Roaming/gcloud/legacy_credentials/iwase@zenoffice.co.jp/adc.json"
export GROK_VOICE_VOICE_ID=99c95cc8a177          # required by deploy wrapper's pre-deploy guard
export GOOGLE_CLOUD_PROJECT=adecco-mendan        # quota project for Adecco resources
```

The `GROK_VOICE_VOICE_ID` env is asserted by
`scripts/grok-voice-build-registered-speech.ts`, but the deploy wrapper
does not call that build path. It is included in the deploy env block by
convention so a fresh shell that may run a build later in the same
session does not have to re-export it.

`XAI_API_KEY` is fetched by the warm-cache step from Secret Manager
(`zapier-transfer` → `adecco-mendan` precedence per AGENTS.md `## Secrets`).

## Step 2 — Run the wrapper

```bash
pnpm deploy:adecco-roleplay
```

The wrapper (`scripts/deploy-adecco-roleplay.ts`) does five things in
order. Failures at any step abort with a non-zero exit code:

1. **Baseline snapshot** — reads the current rollout id and
   `guardrailVersion` from `/api/v3/session` so the operator can see
   what they are replacing.
2. **`firebase deploy --only apphosting --non-interactive`** — uploads
   `apps/web/` per `firebase.json` `rootDir`, registers a Build, then a
   Rollout. Cloud Build typically takes 4–6 minutes for a full
   `pnpm install` + `next build`. Idle baseline ~7 min total.
3. **Rollout polling** — waits for the new rollout to reach `SUCCEEDED`.
4. **Warm-cache** — `pnpm grok:warm-tts-cache` pre-creates every PR60
   canonical TTS entry so the first production request is a memory-cache
   hit. Without this step, the first ~25% of turns hit a 1.5–3s
   synthesis penalty.
5. **Post-deploy verification** — re-fetches `/api/v3/session` and prints
   the new `guardrailVersion`, `promptVersion`, and `strictSanitizedPlayback`.
   If `guardrailVersion` did NOT change, the wrapper logs a "red flag"
   note. **This is only a real flag when the deploy was supposed to bump
   guardrail.** Registered-speech artifact rebuilds (most Haruto-era PRs)
   leave `guardrailVersion` unchanged and the note is informational.

### Wrapper flags

```bash
pnpm deploy:adecco-roleplay -- --skip-warm     # rollout only (rare)
pnpm deploy:adecco-roleplay -- --skip-deploy   # warm only against existing rollout
pnpm deploy:adecco-roleplay -- --skip-verify   # rollout + warm only
```

Default = all three steps.

## Step 3 — Verify the live bundle

The wrapper's verification step only checks `guardrailVersion`. For
deploys that change registered-speech artifacts (most current work),
also check the bundle is the just-promoted one:

```bash
DEMO_TOKEN=$(gcloud secrets versions access latest --secret=demo-access-token --project=adecco-mendan)
SIG=$(python -c "import hmac,hashlib,sys; t=sys.argv[1]; print(hmac.new(t.encode(),t.encode(),hashlib.sha256).hexdigest())" "$DEMO_TOKEN")
curl -s "https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app/api/v3/session" \
  -X POST -H "content-type: application/json" \
  -H "origin: https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app" \
  -H "referer: https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-v3" \
  -H "cookie: roleplay_api_access=$SIG" \
  -d '{}' > /tmp/session-resp.json
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/session-resp.json','utf8'));
const rs = d.registeredSpeech || {};
console.log('manifestVersion:', rs.manifestVersion);
console.log('buildId:', rs.buildId);
console.log('voiceId:', rs.voiceId);
console.log('artifacts:', (rs.artifacts||[]).length);
"
rm -f /tmp/session-resp.json
```

Expected: `buildId` matches the buildId you just promoted via
`pnpm grok:promote-registered-speech`.

If the buildId is older, see the "deploy lag" note in the
[`adecco_apphosting_deploy_lag` memory](../memory/adecco_apphosting_deploy_lag.md)
and the [`feedback_pr_body_not_deployed_code` memory](../memory/feedback_pr_body_not_deployed_code.md)
on the user's `~/.claude/projects/.../memory/` index — main-merge does
NOT auto-deploy this backend.

## Step 4 — Browser smoke (manual)

The demo URL is gated by an HMAC-signed cookie of `DEMO_ACCESS_TOKEN`.
Cookies are issued by `/demo/adecco-roleplay-v3/access` (POST form):

| Cookie | Path | Set by |
|---|---|---|
| `roleplay_access` | `/demo` | UI gate |
| `roleplay_api_access` | `/api` | API gate (broad path covers `/api/v3/...`) |

Both are `HttpOnly + Secure + SameSite=Lax`, `maxAge` 8 hours.

### Browser flow

1. Open `https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-v3`
2. The `<AccessGate>` form renders ("MENDAN AIロープレ — デモを開始するにはアクセスコードを入力してください")
3. Paste the demo access token: `gcloud secrets versions access latest --secret=demo-access-token --project=adecco-mendan`
4. Submit "開始" → server sets both cookies, redirects back, shell renders, `/api/v3/session` POST succeeds (200)
5. Mic-enable + run the 16-turn smoke listed in
   [`docs/grok-voice-haruto-closeout-20260512.md`](grok-voice-haruto-closeout-20260512.md)
   §"Layer D — Production smoke + Cloud Logging assert"

### Common 401 cause

Symptom: page loads ok but JS shows `セッションの開始に失敗しました。時間をおいて再試行してください。`

Cause is almost always the API cookie missing:

- New browser / incognito window without the cookie
- 8-hour `maxAge` expired
- User cleared cookies for the domain
- Older deploy used a narrower API cookie path that doesn't cover `/api/v3`
  (NOT the case for `adecco-roleplay-v3` since 2026-04, but possible for
  older A/B routes)

Fix: re-enter the access token via the `<AccessGate>` form. Confirm via
DevTools → Application → Cookies that both `roleplay_access` and
`roleplay_api_access` are present on the App Hosting domain.

### CLI smoke (no browser, for CI / scripted check)

```bash
DEMO_TOKEN=$(gcloud secrets versions access latest --secret=demo-access-token --project=adecco-mendan)
SIG=$(python -c "import hmac,hashlib,sys; t=sys.argv[1]; print(hmac.new(t.encode(),t.encode(),hashlib.sha256).hexdigest())" "$DEMO_TOKEN")
BASE="https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app"
curl -s "$BASE/api/v3/session" -X POST \
  -H "content-type: application/json" \
  -H "origin: $BASE" \
  -H "referer: $BASE/demo/adecco-roleplay-v3" \
  -H "cookie: roleplay_api_access=$SIG" \
  -d '{}' | head -c 200; echo
```

Expected: JSON starting with `{"sessionId":"gv_sess_...","scenarioId":"...",...}`.
401 / 403 → re-check the cookie SIG vs the live `DEMO_ACCESS_TOKEN`.

## Step 5 — Production DOD assertion

```bash
pnpm grok:audio-e2e:prod-log-assert --minutes 30 --json out/<short-name>_prod_assert.json
```

Required `overallPass=true` plus all DOD metrics 0 (placeholder hits,
forbidden suffix, fallback business hits, etc.). See
[`docs/grok-voice-haruto-closeout-20260512.md`](grok-voice-haruto-closeout-20260512.md)
§"Production goal" for the full list.

This step requires a real production session to have completed at least
one turn within the `--minutes` window — without traffic the assert
returns `overallPass=false` because there are no entries to audit. Run
Step 4 manual smoke first, then this assert.

## Pitfalls

### `gh pr merge --delete-branch` may demote the source worktree

Observed 2026-05-12: after `gh pr merge 95 --squash --delete-branch` the
ephemeral worktree at `.claude/worktrees/adoring-poincare-*/` lost its
working tree files (only `node_modules` survived). `gh` swallowed the
"main is checked out in another worktree" error during local cleanup and
the worktree appears to have been demoted to a regular subdirectory of
the parent `git rev-parse --show-toplevel`.

**Mitigation:** when merging a Claude Code worktree branch, expect to
need a fresh worktree for follow-up work in the same session. The deploy
itself is unaffected (Firebase deploy uploads a tarball at deploy time;
the squashed merge commit on `origin/main` is content-identical to the
worktree's pre-merge HEAD).

### Cloud Build cache misses on dependency lockfile changes

If `pnpm-lock.yaml` changed in the deployed PR, Cloud Build re-runs
`pnpm install` from scratch (~3 min added). Plan for ~9–10 min total
deploy in that case.

### Cookie path narrowing on legacy A/B routes

The `adecco-roleplay-v3` access route uses `cookiePaths: { ui: "/demo",
api: "/api" }` (broad). Older `adecco-roleplay-haiku-fish` and
`adecco-roleplay` routes default to narrower paths (`/api/voice`). If
you A/B test against an older route, re-enter the access token there
specifically — cookies do not carry across path boundaries.

## Rollback

If the new rollout misbehaves and a clean revert is needed:

1. **Env-flag rollback** (preferred per AGENTS.md `## Working Defaults`):
   flip the offending env on the Firebase Console (e.g.
   `GROK_VOICE_PRODUCTION_DETERMINISTIC_ONLY=false`). The change is
   read on the next request via `/api/v3/session`. No redeploy needed.

2. **Rollout revert** (full code rollback):

   ```bash
   # List recent rollouts (most recent first)
   TOKEN=$(gcloud auth print-access-token)
   curl -sH "Authorization: Bearer $TOKEN" \
     "https://firebaseapphosting.googleapis.com/v1/projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay/rollouts?pageSize=10" \
     | python -c "import sys,json; [print(r['name'].split('/')[-1], r.get('state')) for r in json.load(sys.stdin).get('rollouts',[])]"

   # Promote a previous READY build via Firebase console (no REST shortcut yet).
   # Or git revert the merge commit and re-run pnpm deploy:adecco-roleplay.
   ```

`git revert` + redeploy is the simpler path for code defects; env-flag
is the simpler path for behavior toggles.

## Related docs

- Cross-tool Source of Truth (canonical contract): [`AGENTS.md`](../AGENTS.md) `## Deploy (App Hosting)`
- Agent-runnable form: [`.agents/skills/ai-rpg-app-hosting-deploy/SKILL.md`](../.agents/skills/ai-rpg-app-hosting-deploy/SKILL.md)
- Codex command-approval guards: [`.codex/rules/deploy-app-hosting.rules`](../.codex/rules/deploy-app-hosting.rules)
- Claude Code surface: [`.claude/rules/deploy-app-hosting.md`](../.claude/rules/deploy-app-hosting.md)
- Cursor surface: [`.cursor/rules/deploy-app-hosting.mdc`](../.cursor/rules/deploy-app-hosting.mdc) (`alwaysApply: true`)
- Legacy Cloud Run UI deploy (different service `roleplay-ui`, kept for historical reference): [`docs/deploy.md`](deploy.md)
- Manual smoke runbook (browser turns): [`docs/grok-voice-manual-smoke-runbook.md`](grok-voice-manual-smoke-runbook.md)
- Haruto closeout (the most recent end-to-end deploy reference): [`docs/grok-voice-haruto-closeout-20260512.md`](grok-voice-haruto-closeout-20260512.md)
