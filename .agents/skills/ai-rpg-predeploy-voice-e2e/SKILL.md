---
name: ai-rpg-predeploy-voice-e2e
description: Use when validating Adecco Grok-first prompt quality with voice E2E before production deploy, especially v50-family prompt variants such as v50.4, v50.5, and v50.6. Covers local/PR instructions, xAI Realtime voice input, workbook turn cases, forbidden phrase checks, sentence-count checks, STT-noise handling, local relay/session-route checks, and how to separate prompt-quality evidence from post-deploy relay/session evidence.
---

# AI RPG Predeploy Voice E2E

Use this skill when the operator wants to know whether a Grok-first prompt
change is good enough before deploying App Hosting or Cloud Run.

## Boundary

Predeploy voice E2E answers prompt-quality questions first:

- Did the local/PR `instructions` produce the right customer response?
- Did xAI STT hear the sales utterance closely enough?
- Did the assistant avoid forbidden phrases, coaching, prompt leaks, reverse
  questions, and overlong answers?
- Did STT-noise inputs still land in the intended scenario context?

It can also exercise the local browser/session route when the prompt variant is
already wired in the PR, but this is still not production proof:

- local `/api/grok-first-v50-*/session` identity is checked
- a local MENDAN relay may be used for localhost origin compatibility
- browser fake-mic and WebSocket behavior are checked against local code

It does not prove production wiring:

- `roleplay.mendan.biz` route availability
- Cloud Run relay revision or `ticket.accepted` in production logs
- Firebase App Hosting env/secret binding
- production browser WebAudio playback

For those, use `ai-rpg-acceptance-verification` after merge/deploy.

## v50 Variant Contracts

Keep the assertion profile tied to `promptVersion` instead of hard-coding one
contract for all v50-family runs.

| Variant | Prompt version                | Main output contract                                 | Guard response                                               |
| ------- | ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| v50.4   | `grok-first-v50.4-2026-05-15` | short customer answers, stronger boundary than v50.1 | v50.4 workbook expectations                                  |
| v50.5   | `grok-first-v50.5-2026-05-15` | one or two sentences, no third sentence              | ending/off-role fixed responses from the v50.5 workbook      |
| v50.6   | `grok-first-v50.6-2026-05-15` | default one sentence, two only when clearly needed   | `今回のご相談内容に戻らせていただいてもよろしいでしょうか？` |

v50.6 additionally forbids customer-side reverse questions such as candidate
supply questions at closing. Treat any such question in a normal business turn
as a prompt-quality failure unless the workbook explicitly marks it allowed.

## Workbook Run Plan

When the operator provides an `.xlsx`, inspect these sheets first:

- `00_Dashboard`: total scenario/turn counts and intended gate scope
- `01_RunPlan`: execution order and stop rules
- `03_Turn_Cases`: Smoke/Core/Full turn cases
- `04_P0_Guards`: guard-only P0 cases
- `05_Assertion_Rules` and `06_Forbidden_Phrases`: assertion semantics

Use the workbook stop rule from the v50.5 run as the default for v50-family
prompt gates:

1. Run Smoke from `03_Turn_Cases`.
2. Run P0 Guards from `04_P0_Guards`.
3. If Smoke or P0 Guards fails, stop and do not run Core/Full to save API cost.
4. Run Core/Full only after Smoke and P0 Guards pass.

Report skipped Core/Full as `not run due stop rule`, not as pass.

## Preferred Workflow

1. Start from a clean worktree or branch containing the prompt under review.
2. Identify the variant, API namespace, demo slug, and expected `promptVersion`.
3. Export workbook cases if the operator provided an `.xlsx`.
4. Run Smoke/P0 first with the matching variant assertion profile.
5. Save evidence under `out/`; do not commit audio, transcripts, screenshots,
   or raw logs.
6. Report prompt-quality results and explicitly say production relay/session
   verification is still pending until deploy.

## Harness Modes

### Direct Prompt Mode

Use this when the route is not yet wired or the task is strictly prompt quality.
The harness should:

- build instructions from local code, for example
  `buildGrokFirstV50Prompt("v50.6").instructions`
- open `wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0`
  server-side with `XAI_API_KEY` resolved through the repo Secret Manager
  precedence
- synthesize or otherwise provide Japanese sales utterance WAV/PCM input
- stream PCM over time so server VAD observes a real voice turn
- capture `conversation.item.input_audio_transcription.completed`
- capture assistant audio transcript deltas and `response.done`
- evaluate workbook assertions: `Must_Include_All`, `Must_Include_Any`,
  `Must_Not_Include`, `Forbidden_Phrases`, `Max_Sentences`, and any exact guard
  response fields

### Local Route + Relay Mode

Use this when the prompt variant is wired into `/demo/adecco-roleplay-v50-*` and
local browser/session behavior is part of the predeploy question. This was the
mode used for the v50.5 workbook run.

The harness should:

- start a fresh local Next server for the PR code
- start a local `@top-performer/xai-realtime-relay` instance when testing from
  localhost, because the production relay rejects localhost origins
- set `GROK_VOICE_RELAY_WS_URL=ws://127.0.0.1:<relayPort>/api/v3/realtime-relay`
  for the local app
- authenticate the demo page with the local demo cookie
- drive Chromium with `--use-file-for-fake-audio-capture=<case.wav>`
- capture `/api/grok-first-v50-*/event` posts and assert session/turn metadata

Required local-route assertions:

- `demoSlug` and `backend` match the route under test
- `promptVersion` matches the variant contract
- `realtimeTransport=mendan_cloud_run_relay_wss`
- `realtimeAuth.mode=mendan_relay_subprotocol`
- no browser-facing `ephemeralToken` or `ephemeralExpiresAt`
- `registeredSpeechPayloadIncluded=false`
- `lockedResponseAudioBundleIncluded=false`
- `stt.completed` observed for voice cases
- `turn.completed` observed unless the expected behavior is no response
- `audioBytes > 0` for normal spoken-response cases

## Evidence Layout

Prefer a stable directory shape:

```text
out/grok_first_v50_voice_e2e/<variant>/<run-id>/
  summary.json
  results.csv
  report.md
  partial-results.json
  fixtures/
  screenshots/
```

If an older temporary harness writes a different directory such as
`out/grok_first_v50_5_voice_e2e/<run-id>/`, keep the evidence and report the
actual path; do not move large audio evidence into git.

`summary.json` should include at least:

- source workbook path
- git branch and commit
- variant, demo slug, API namespace, `promptVersion`, and prompt hash
- total/passed/failed/passRate
- P0 total/passed/failed when applicable
- top failure tag counts
- first audio delta / done latency when measured

## Failure Tags

Use stable tags so v50.5/v50.6 reports are comparable:

- `sentence_count`: assistant exceeded the variant max sentence contract
- `fixed_guard_response_mismatch`: guard response was not exactly expected
- `forbidden`: assistant transcript contained a forbidden phrase
- `missing_all`: a required all-of phrase was absent
- `missing_any`: no allowed any-of phrase was present
- `missing_turn_completed`: local route did not produce a completed turn event
- `missing_stt_completed`: voice input did not produce STT completion
- `audio_empty`: normal spoken turn completed with no audio bytes
- `reverse_question_leak`: customer asked an unallowed closing/reverse question

A forbidden phrase in the assistant transcript is a prompt-quality failure even
if the post-deploy negative guard might strip it.

## Interpretation Rules

- v50.5 Smoke/P0 failures were dominated by third-sentence additions and fixed
  guard mismatches; treat those as primary regressions for future variants.
- v50.6 is expected to improve by making normal turns one sentence and by
  replacing all off-role/ending requests with the single guard question.
- `専用システム` may trigger a naive `システム` forbidden check; call this out
  separately as assertion ambiguity unless the workbook explicitly forbids the
  business term too. v50.5+ prompts prefer `社内の受注ツール` to avoid this.
- First-turn greeting loops can indicate harness timing. Wait for
  `session.updated` before sending audio and stream audio with trailing silence.
- `ticket.rejected` from the production relay is not a predeploy prompt-quality
  signal; use a local relay for localhost route tests or move the check to
  post-deploy verification.

## Closeout Language

Use clear separation in the final report:

```text
Predeploy prompt voice E2E: PASS/FAIL.
Production session/relay/browser verification: not run yet, required after deploy.
```

If the user asks for release readiness, switch to `ai-rpg-acceptance-verification`
after the predeploy prompt result.
