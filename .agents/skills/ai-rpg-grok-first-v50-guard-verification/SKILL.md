---
name: ai-rpg-grok-first-v50-guard-verification
description: Use when verifying or reporting Grok-first v50 fixed guard behavior, guard smoke, v50.8 assistant-only drain, spreadsheet-defined guard test plans, or browser E2E evidence for `/demo/adecco-roleplay-v50*` and `/api/grok-first-v50*`.
---

# AI RPG Grok-first v50 Guard Verification

Use this skill for v50 fixed guard verification and evidence. Keep the v50.6
prompt and fixed guard text/audio identity separate from runtime guard changes.

## Canonical Sources

- `AGENTS.md` `## Secrets` and `## Working Defaults`
- `docs/GROK_VOICE_ROLEPLAY.md`
- `.agents/skills/ai-rpg-acceptance-verification/SKILL.md`
- `scripts/grok-first-v50-prod-smoke.mjs`
- `scripts/grok-first-v50-prod-logs.mjs`
- `scripts/grok-first-v50-voice-e2e.mjs`

## Preflight First

Before any long-running run:

1. State the denominator: `5-case harness`, `13/13 guard smoke`, `69 P0 guards`,
   or `93-turn full`.
2. If the plan is Excel/Sheets, inspect sheets and confirm a runner exists for
   every required case set. Missing runner is a blocker; do not call a narrower
   harness final DoD.
3. Confirm the runner/package script exists. For production smoke and logs:
   `pnpm grok:first-v50:prod-smoke` and `pnpm grok:first-v50:prod-logs`.
   For spreadsheet or case-set voice E2E:
   `pnpm grok:first-v50:voice-e2e` or the existing
   `pnpm grok-first:v50:xlsx-voice-e2e`.
4. Confirm secrets without printing values:
   - `DEMO_ACCESS_TOKEN` env or Secret Manager `demo-access-token`
   - `XAI_RELAY_TICKET_SECRET` for relay-ticket v50/v25 routes
   - `XAI_API_KEY` for normal Grok realtime/voice paths
5. Check stale local Next dev servers and target ports before starting. Reuse an
   existing server only after one target event route capture succeeds.

## Production Diagnostic Ladder

Before redeploying or broadening the run:

1. Check `/api/grok-first-v50*/session` first. It must return the expected
   `demoSlug`, `backend`, `promptVersion`, `guardrailVersion`,
   `realtimeTransport=mendan_cloud_run_relay_wss`,
   `wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay`,
   `registeredSpeechPayloadIncluded=false`, and
   `lockedResponseAudioBundleIncluded=false`.
2. If the session API fails, investigate App Hosting, AccessGate cookies,
   rollout/build logs, and env/secret bindings. Do not start with relay logs.
3. If the session API succeeds but WebSocket startup fails, check
   `https://voice.mendan.biz/healthz`, then relay Cloud Logging for
   `client.connected`, `ticket.accepted`, `upstream.connected`, and
   `first.upstream.audio.delta`.
4. If browser E2E fails, immediately pull Cloud Logging for the same
   `sessionId`. `stt.completed` without `turn.completed` is a turn lifecycle
   failure, not a session-start failure.

Useful commands:

```bash
pnpm grok:first-v50:prod-smoke -- --variant v50-7 --mode start
pnpm grok:first-v50:prod-smoke -- --variant v50-7 --mode voice-turn
pnpm grok:first-v50:prod-logs -- --session gfv50_...
```

## v50.7 Identity Checks

For `/demo/adecco-roleplay-v50-7`:

- `promptVersion=grok-first-v50.6-2026-05-15`
- `guardrailVersion=grok-first-v50.7-guard-2026-05-15`
- `demoSlug=adecco-roleplay-v50-7`
- `backend=grok-first-v50-7`
- fixed external text: `その話は今回の商談では扱いません。`
- fixed exit text: `本日はここまでで大丈夫です。`
- first message must be visible in the browser after call start.

Do not report prompt improvement if only guard runtime changed.

## Browser E2E Rules

- Start Next dev from `apps/web`, not the repo root, so workspace package links
  resolve consistently.
- On Windows, stop the whole child process tree for a dev server you started.
  Do not kill arbitrary Node processes; check PID/port first.
- Capture `/api/grok-first-v50*/event` directly. v50-family routes do not emit
  through `/api/v3/event`. Do not use evidence from one v50 variant as final DoD
  for another unless the script is parameterized and the evidence names the
  target variant.
- For fixed guard turns, require:
  `guard.detected`, `fixed_guard.playback.started`,
  `fixed_guard.playback.completed`, and `turn.completed`.
- Require `routePath=fixed_guard`, expected `guardAction`,
  `audioSource=static_guard_pcm_base64`, `audioBytes > 0`,
  `firstAudibleAudioMs != null`, fixed text exact match, no `<missing>`, and no
  LLM response displayed.
- For ordinary voice turns, require `stt.completed`, `turn.completed`,
  `audioBytes > 0`, and `error=null`. If the transcript shows an empty agent
  bubble or repeated STT without `turn.completed`, inspect mic gating and
  response lifecycle before editing the prompt.

## Cloud Logging

v50-family logs use `jsonPayload.scope="grokFirstV50"` and route-specific event
endpoints. Relay logs use `jsonPayload.scope="grokVoice.realtimeRelay"`.

Interpret common patterns as follows:

| Pattern | Meaning |
|---|---|
| no `session.created` | Browser did not reach the session route or App Hosting failed before logging |
| `session.created` but no `ws.connected` | Browser/CSP/DNS/LB or client startup issue |
| relay `ticket.rejected` | relay ticket audience/path/secret mismatch |
| relay `upstream.connected` missing | relay `XAI_API_KEY`, IAM, or xAI upstream issue |
| `stt.completed` but no `turn.completed` | turn lifecycle / response creation / mic overlap issue |
| `fixed_guard.playback.started` but no `turn.completed` | fixed audio playback path or completion metric issue |

Latency note: `firstAudibleAudioMs` is turn-start based and includes STT time.
For fixed guard audio path health, prefer `sttCompletedToGuardDetectedMs`,
`guardDetectedToPlaybackStartedMs`, `fixedPlaybackDurationMs`, and
`fixedAudioBytes`.

## Reporting

Always distinguish:

- scoped harness evidence, e.g. `5/5 x3 back-to-back fixed_external`
- Excel guard smoke evidence, e.g. `13/13 x3`
- P0 guard evidence, e.g. `69/69`
- full E2E evidence, e.g. `93 turns`

If a broader runner is missing, report `NOT COMPLETE: runner missing` and list
the implemented narrower evidence separately.
