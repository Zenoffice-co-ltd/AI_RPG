---
name: ai-rpg-repo-elevenlabs-voice
description: Use when working on ElevenLabs Japanese voice selection, shared voice promotion, profile tuning, scenario-to-profile mapping, publish readiness, or Agents v3 publish failures in this repository. Especially use for `expressive_tts_not_allowed`, pronunciation-dictionary readiness, and transport-level model-id fixes that affect ConvAI Agents but must not change raw TTS behavior. Do not use for generic frontend audio tasks that do not touch repo voice profiles or benchmark artifacts.
---

# AI RPG Repo ElevenLabs Voice

Use this skill for the repo-local ElevenLabs voice workflow.

## Canonical Sources

- `docs/skills/elevenlabs_voice_selection.md`
- `docs/ELEVENLABS_VOICE_SPEC.md`
- `docs/VOICE_PROFILE_SCHEMA.md`
- `docs/VOICE_TUNING_RUNBOOK.md`
- `config/voice-profiles/scenario-map.json`

## Default Workflow

1. Start with the repo-local skill doc in `docs/skills/elevenlabs_voice_selection.md`.
2. Read the schema or runbook only when the task needs that extra detail.
3. Keep profile JSON, scenario map, and benchmark evidence aligned.
4. Treat dictionary-locator readiness as part of the publish decision, not as an afterthought.
5. For live comparison, prefer an explicit `--profile` publish override over changing `activeProfiles` prematurely.

## Agents V3 Publish Triage

When ConvAI / Agents publish fails with `expressive_tts_not_allowed`, use this sequence before assuming plan or entitlement issues:

1. Confirm the current saved agent config with `GET /v1/convai/agents/{agentId}?branch_id=...`.
2. Confirm `agent_output_audio_format` is not the blocker. `pcm_24000` is safe on Creator; do not lower it unless docs change.
3. Confirm write-path health with a no-op PATCH to the same branch.
4. Confirm dictionary locators are not the blocker with a dictionary-only PATCH if needed.
5. If changing only `conversation_config.tts.model_id` from `eleven_v3_conversational` to `eleven_v3` reproduces the error, fix the vendor transport.

Current repo rule:

- repo SoT profile model stays `eleven_v3`
- Agents / ConvAI payload normalizes `eleven_v3 -> eleven_v3_conversational`
- raw TTS `/v1/text-to-speech` keeps `eleven_v3`

Only change `packages/vendors/src/elevenlabs.ts` `buildConversationConfig()` for this fix. Do not change raw render model handling or v3 normalization payloads.

## Publish Diagnostics

For Agents publish failures, capture:

- `branch_id`
- request path
- original model
- normalized model actually sent
- `agent_output_audio_format`
- vendor request id
- vendor error code and message

Treat `expressive_tts_not_allowed` as non-retryable unless a future task explicitly redesigns retry policy for retryable errors like `429`, `5xx`, or timeouts.

## Publish Execution Notes

- Run accounting publish lanes sequentially, not in parallel. Parallel runs can race at `mergeBranch` and produce `branch_already_merged`.
- Re-verify both:
  - `accounting_clerk_enterprise_ap_ja_v3_candidate_v1`
  - `accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1`
- Do not promote `activeProfiles` until publish succeeds and the generated publish snapshot is reviewed.

## Representative Commands

```bash
pnpm voices:list
pnpm voices:collect:ja
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-sanity
pnpm voices:promote:shared
pnpm voices:design:ja
pnpm voices:dictionary:upload -- --file data/pronunciation/adecco-ja-accounting-v1.pls --name adecco-ja-accounting-v1
pnpm review:summarize:ja -- --csv data/generated/voice-benchmark/<runId>/review-sheet.csv
pnpm vitest run packages/vendors/src/elevenlabs.test.ts
pnpm typecheck
pnpm publish:scenario -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium --profile accounting_clerk_enterprise_ap_ja_v3_candidate_v1
pnpm publish:scenario -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium --profile accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1
```

## Guardrails

- Approved does not automatically mean publish-ready.
- Keep transport fixes local to the Agents path; do not mutate profile SoT just to satisfy ConvAI payload differences.
- Confirm `pronunciationDictionaryLocators` readiness before finalizing an active mapping.
- Do not change `renderSpeech()` model handling when fixing Agents publish.
- Do not add automatic retry for `expressive_tts_not_allowed`.
- Prefer generated benchmark artifacts and review sheets over ad hoc notes.
