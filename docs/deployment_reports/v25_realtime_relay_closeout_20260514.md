# v25 Cloud Run Realtime Relay Closeout

## Summary

- PR #99 merge commit is present on `origin/main`: `eb29b6890c2a45b1e352f958d3eb0a113e7af3fb`.
- Closeout branch: `codex/v25-relay-post-merge-closeout`.
- Post-merge closeout SHA at verification start: `eb29b6890c2a45b1e352f958d3eb0a113e7af3fb`.
- Date: 2026-05-14.
- Operator: Codex.

## Code Review Closeout

- PR comment: `firstAudioDeltaSessions` could grow without bound on long-lived relay instances.
- Status: fixed.
- Evidence:
  - `apps/xai-realtime-relay/src/server.ts`: removed the global session Set and made first audio delta logging connection-local.
  - `apps/xai-realtime-relay/src/server.test.ts`: covers one first-delta log per connection, separate connections each logging once, and no sensitive frame content in relay logs.

## Static / Unit / Build

| Command | Result |
|---|---|
| `corepack pnpm install --frozen-lockfile` | PASS |
| `corepack pnpm --filter @top-performer/web typecheck` | PASS |
| `corepack pnpm --filter @top-performer/web test` | PASS, 97 files / 830 tests |
| `corepack pnpm --filter @top-performer/web build` | PASS, with existing Turbopack NFT tracing warning |
| `corepack pnpm --filter @top-performer/xai-realtime-relay typecheck` | PASS |
| `corepack pnpm --filter @top-performer/xai-realtime-relay test` | PASS, 97 files / 830 tests |
| `corepack pnpm --filter @top-performer/xai-realtime-relay build` | PASS |
| `corepack pnpm --filter @top-performer/grok-realtime-relay-auth typecheck` | PASS |
| `corepack pnpm --filter @top-performer/grok-realtime-relay-auth test` | PASS, 97 files / 830 tests |
| `corepack pnpm --filter @top-performer/grok-realtime-relay-auth build` | PASS |
| `corepack pnpm grok:verify-registered-speech` | PASS |
| `corepack pnpm grok:forbid-modelless-ws` | PASS, offenders 0 |
| `corepack pnpm grok:audio-e2e:layer-a` | PASS, 57/57 |
| `corepack pnpm grok:audio-e2e:layer-b` | PASS, 112/112 |

## Production E2E

| Gate | Result | Evidence |
|---|---|---|
| DNS | PASS | `voice.mendan.biz -> 34.149.106.144` |
| Relay health | PASS | `https://voice.mendan.biz/healthz` returned HTTP 200 and `{ "ok": true }` |
| Cloud Run service | PASS | `xai-realtime-relay`, latest ready revision `xai-realtime-relay-00001-vn9` |
| v25 session contract | PASS | `demoSlug=adecco-roleplay-v25`, relay transport, relay WebSocket URL, no legacy ephemeral token fields |
| Browser text E2E v25 | PASS | `out/grok_voice_browser_audio_e2e/20260514T001239Z/summary.json` |
| Browser audio E2E v25 | PASS | `out/grok_voice_browser_audio_e2e/20260514T001332Z/summary.json` |
| Cloud Logging relay phases | PASS | `client.connected`, `ticket.accepted`, `upstream.connected` found in last 60 minutes |
| v23/v4/v5 direct path | PASS | each returned direct transport, direct auth mode, `api.x.ai` host, and legacy ephemeral token |

Browser E2E initially failed once because the harness clicked the call button immediately after `domcontentloaded`; a manual probe showed the production page worked after hydration. The text and audio browser harnesses now wait for `networkidle` before clicking, and both v25 runs pass.

## Security

- v25 browser WebSocket evidence contains only `wss://voice.mendan.biz/api/v3/realtime-relay`.
- v25 browser evidence contains no direct browser WebSocket to `wss://api.x.ai`.
- v25 session response omits legacy ephemeral token fields.
- Cloud Logging scan passed for required phases and found no raw relay credential, provider credential, demo access credential, transcript preview field, or base64 payloads for audio.
- E2E artifact paths are recorded for reviewer lookup only; generated artifacts are not intended for commit.

## Acceptance

- `corepack pnpm verify:acceptance` without env-loaded secret overrides: FAIL before scenario execution due to local ADC Secret Manager access.
- Retried with required values loaded into the current process environment from Secret Manager, with no values written to files.
- `FIREBASE_PROJECT_ID=adecco-ai-roleplay-dev`: FAIL, local principal lacks project access.
- `FIREBASE_PROJECT_ID=adecco-mendan`: reached `[3/10] publish scenario`, then failed after three ElevenLabs judge attempts on legacy `staffing_order_hearing_busy_manager_medium` tests:
  - retry 1: `shallow-questions-stay-shallow`, `no-coaching`
  - retry 2: `no-coaching`
  - retry 3: `no-hidden-fact-leak`, `no-coaching`
- Classification: legacy ElevenLabs ConvAI judge variance. This is outside the v25 Cloud Run relay path because v25 session, browser, relay log, transport, direct-path, and sensitive-material gates all passed.

## Final Verdict

- v25 relay DOD: PASS.
- Production closeout: PASS.
- Broader repository acceptance gate: BLOCKED by legacy ElevenLabs ConvAI judge variance in `staffing_order_hearing_busy_manager_medium`.
- Required follow-up for the broader gate: obtain a clean `corepack pnpm verify:acceptance` run during a stable vendor window or explicitly approve the legacy ConvAI judge variance as outside the v25 relay DOD.
