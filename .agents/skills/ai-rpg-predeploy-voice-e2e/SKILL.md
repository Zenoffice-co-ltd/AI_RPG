---
name: ai-rpg-predeploy-voice-e2e
description: Use when validating Adecco Grok-first prompt quality with voice E2E before production deploy, especially v50-family prompt variants such as v50.4. Covers local/PR instructions, xAI Realtime voice input, workbook turn cases, forbidden phrase checks, sentence-count checks, STT-noise handling, and how to separate prompt-quality evidence from post-deploy relay/session evidence.
---

# AI RPG Predeploy Voice E2E

Use this skill when the operator wants to know whether a prompt change is good
enough before deploying App Hosting or Cloud Run.

## Boundary

Predeploy voice E2E answers prompt-quality questions only:

- Did the local/PR `instructions` produce the right customer response?
- Did xAI STT hear the sales utterance closely enough?
- Did the assistant avoid forbidden phrases, coaching, prompt leaks, and
  overlong answers?
- Did STT-noise inputs still land in the intended scenario context?

It does not prove production wiring:

- `/api/grok-first-v50-*/session` identity from `roleplay.mendan.biz`
- `voice.mendan.biz` relay ticket verification
- no browser `ephemeralToken`
- Cloud Run relay revision or `ticket.accepted`
- browser WebAudio playback

For those, use `ai-rpg-acceptance-verification` after merge/deploy.

## Preferred Workflow

1. Start from a clean worktree or branch containing the prompt under review.
2. Export workbook cases if the operator provided an `.xlsx`.
3. Run a direct xAI Realtime voice-input harness using the local prompt builder,
   not the production session route.
4. Run Smoke/P0 first. Stop Core/Full if P0 fails.
5. Save evidence under `out/`; do not commit audio, transcripts, screenshots,
   or raw logs.
6. Report prompt-quality results and explicitly say production relay/session
   verification is still pending until deploy.

## Harness Requirements

The harness must:

- build instructions from the local code under test, for example
  `buildGrokFirstV50Prompt("v50.4").instructions`
- open `wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0`
  server-side with `XAI_API_KEY` from the repo Secret Manager precedence
- synthesize or otherwise provide Japanese sales utterance WAV/PCM input
- stream PCM over time so server VAD observes a real voice turn
- capture `conversation.item.input_audio_transcription.completed`
- capture assistant audio transcript deltas and `response.done`
- evaluate workbook assertions: `Must_Include_All`, `Must_Include_Any`,
  `Must_Not_Include`, `Forbidden_Phrases`, and `Max_Sentences`

Do not call production `/api/grok-first-v50-*/session` for predeploy prompt
quality. That validates deployed code, not the local PR prompt.

## Workbook Run Plan

When the workbook contains run tiers:

```bash
# Export-only sanity check is cheap and safe.
corepack pnpm grok-first:v50:xlsx-voice-e2e -- \
  --xlsx "<path-to-workbook.xlsx>" \
  --export-only
```

Then run the predeploy/direct mode for Smoke/P0. If the current repo script does
not yet expose a direct local-prompt mode, add it or use a temporary `out/`
harness; do not pretend the production-relay harness is predeploy evidence.

Report:

- source workbook and git commit/branch
- prompt variant and `promptVersion`
- scenario count and turn count
- overall pass rate and P0 pass rate
- forbidden-hit count and top forbidden phrases
- sentence-count failures
- STT empty or STT drift cases
- first audio delta / response done latency if measured
- evidence directory

## Interpretation Rules

- A forbidden phrase in the assistant transcript is a prompt-quality failure
  even if the post-deploy negative guard might strip it.
- `専用システム` may trigger a naive `システム` forbidden check; call this out
  separately as assertion ambiguity unless the workbook explicitly forbids the
  business term too.
- First-turn greeting loops can indicate harness timing. Wait for
  `session.updated` before sending audio and stream audio with trailing silence.
- `ticket.rejected` is not a predeploy prompt-quality signal; it belongs to
  post-deploy relay verification.

## Closeout Language

Use clear separation in the final report:

```text
Predeploy prompt voice E2E: PASS/FAIL.
Production session/relay/browser verification: not run yet, required after deploy.
```

If the user asks for release readiness, switch to `ai-rpg-acceptance-verification`
after the predeploy prompt result.
