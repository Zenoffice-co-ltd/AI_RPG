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
- Adecco manufacturer Orb answers must spell out amounts, times, ranges, counts, and business abbreviations in spoken Japanese; avoid raw values like yen ranges, clock separators, slashes, and hour-per-month notation in live response text
- Adecco manufacturer live publish should include patient turn-taking so user utterances are not cut mid-sentence: `turn_timeout=7`, `turn_eagerness=patient`, `speculative_turn=false`, `retranscribe_on_turn_timeout=true`, `silence_end_call_timeout=-1`, and disabled soft timeout where supported
- accounting live publish strips square-bracket markup such as `[体制強化]` only at transport time so the agent does not speak the brackets
- accounting live publish can also tune turn-taking at transport time: use `turn_eagerness=eager` with a short `turn_timeout` only for the accounting lane when the goal is to reduce perceived dead air without changing staffing defaults
- when latency is still too high on accounting live, prefer tightening turn-taking and prompt brevity before swapping the publish LLM

Only change `packages/vendors/src/elevenlabs.ts` `buildConversationConfig()` for this fix. Do not change raw render model handling or v3 normalization payloads.

## Agents Turn-Taking Payload Guardrail

If a publish object contains `turn` but the live Agent ignores it, inspect
`packages/vendors/src/elevenlabs.ts` `buildConversationConfig()` first. The
vendor API expects `conversation_config.turn` with snake_case keys:

- `turn_timeout`
- `initial_wait_time`
- `silence_end_call_timeout`
- `soft_timeout_config.timeout_seconds`
- `soft_timeout_config.message`
- `turn_eagerness`
- `spelling_patience`
- `speculative_turn`
- `retranscribe_on_turn_timeout`
- `mode`

Do not rely on top-level camelCase publish fields being forwarded. Tests should
assert the exact snake_case payload in `packages/vendors/src/elevenlabs.test.ts`.
The API rejects an empty `soft_timeout_config.message`; use a safe Japanese
fallback such as `ご確認したい点からで大丈夫です。` if the config object must be
sent.

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

- Staffing default live mapping is `busy_manager_ja_primary_v3_f06`.
- Use `busy_manager_ja_fallback_v3_m03` as the approved backup when a staffing live comparison needs a fallback lane.
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

## `normalizeJaTextForTts` is NOT in the live orb path (manual orb v4 lesson, 2026-04-26)

**Critical fact**: `packages/scenario-engine/src/tts/jaTextNormalization.ts` is invoked ONLY from offline rendering paths (`packages/scenario-engine/src/benchmarkRenderer.ts` and `apps/web/server/use-cases/audioPreview.ts`). The live ElevenLabs ConvAI orb does NOT call it — that path relies on server-side `apply_text_normalization: "auto"` (`packages/vendors/src/elevenlabs.ts:393`).

**Implication**: extending `normalizeJaTextForTts` rules to fix what you heard in the live orb has **zero effect on the live orb**. It only changes benchmark CSVs and the in-app voice preview. To change what the live orb actually says, you MUST edit the prompt source itself (Disclosure Ledger `allowedAnswer` + rendered prompt sections in `compileStaffingReferenceScenario.ts`). Apply the 3-Layer Edit Rule from `ai-rpg-staffing-reference-scenario`.

When in doubt, search for callers of `normalizeJaTextForTts` before assuming any change you make there will affect live behavior.

## TTS pronunciation pitfalls (eleven_v3 + textNormalisationType=elevenlabs)

Vendor TTS (eleven_v3 with `textNormalisationType: "elevenlabs"`) misreads several patterns when written in source-text form. Prefer source-side rewrite over relying on dictionary lexemes alone:

- English brand/product names get phonetic-mangled: `Adecco` → 'アデッコ' (manual orb v4 P0). **Always use katakana in runtime utterances** (`アデコさん`); keep English form only in identifiers (scenario id, agent name, voice profile id, function names) where it never gets spoken.
- Compressed Japanese phrases read harshly: `月末月初` / `月曜午前` / `商材切替時` / `現場適合判断`. **Rewrite to natural Japanese in `allowedAnswer`** rather than fighting it at the dictionary layer (`月末と月の初め` / `月曜日の午前中` / `取り扱い商品が切り替わる時期` / `候補者が現場に合うかどうかの最終判断`).
- Number/time/amount ranges: server-side `apply_text_normalization: "auto"` handles most cases; but for deterministic offline rendering, add explicit rewrites to `normalizeJaTextForTts` (e.g. `8:45〜17:30` → `八時四十五分から十七時三十分`).

When you fix a TTS misread by editing the prompt source, also update the **LLM judge `success_condition` in `publishAgent.ts`** to accept BOTH the old and new forms (e.g., `"mentions Adecco OR アデコ"`), and **add a backwards-compat `success_examples` entry with the old form** so existing fixtures don't suddenly fail.

## Voice profile divergence pattern (manual orb v4 evolution of mirror rule)

The "mirror byte-for-byte" rule below was loosened on 2026-04-26 for `pronunciationDictionaryLocators`. Mirrored profiles MAY diverge on this single field when the secondary scenario has scenario-specific pronunciation needs (e.g. Adecco needs `Adecco → アデコ` lexemes that don't belong in the accounting dictionary). The DoD 3 mirror test (`packages/scenario-engine/src/voiceProfiles.test.ts`) now permits divergence and asserts that `metadata.notes` mentions the divergence rationale (must contain `Adecco|アデコ` if the locator differs).

When evolving a mirror profile to diverge:
1. Create a new dictionary on ElevenLabs via `pnpm tsx scripts/elevenlabs/upload-pronunciation-dictionary.ts --file <pls> --name <new-unique-name>`.
2. Update the mirror profile's `pronunciationDictionaryLocators` to the new `{pronunciationDictionaryId, versionId}`.
3. Update `metadata.notes` to include the rationale and mention `Adecco`/`アデコ` so the DoD 3 test passes.
4. The original (source) profile is unchanged.

All other fields (`voiceId`, `model`, `voiceSettings`, `textNormalisationType`, `firstMessageJa` per scenario) MUST still mirror per the byte-for-byte rule.

## Phase 2 handoff pattern for irreversible external actions

Creating an ElevenLabs pronunciation dictionary version is an **irreversible side effect** on the ElevenLabs workspace (the dictionary persists in the account, consumes a slot, and may be referenced by other agents). When an autonomous coding session reaches such an action:

1. Update local code/tests to be future-ready (e.g. loosen DoD 3 mirror test to permit the divergence the upload will introduce — safe because current locators still match).
2. Update local artifacts (`.pls` file, etc.) to reflect what the upload should contain.
3. Write a precise operator runbook with exact commands, expected output, and rollback path. Place it under `data/handoff/<topic>-handoff.md`.
4. Skip the actual external action; document the deferral in commit message and OPERATIONS.md log.

Reference: [data/handoff/manual-orb-v4-phase2-handoff.md](../../data/handoff/manual-orb-v4-phase2-handoff.md) is the canonical example for dictionary upload + voice profile locator update.

## Voice Reuse Across Scenarios (Mirror Pattern)

When a scenario needs to use the SAME voice that another scenario already uses in production (e.g. Adecco staffing reusing the accounting profile's voice), do NOT add the new scenario's id to the existing profile's `metadata.scenarioIds`. The voice profile resolver enforces a 1:1 binding between profile and scenario via `scenarioIds`, and overriding it from another scenario will be rejected.

Correct pattern (added 2026-04-26 with `staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v1`):

1. Create a NEW profile JSON under `config/voice-profiles/` with the target scenario id in `metadata.scenarioIds`.
2. Copy the source profile's runtime fields **byte-for-byte**: `voiceId`, `model`, `voiceSettings.speed`, `voiceSettings.style`, `textNormalisationType`, `pronunciationDictionaryLocators[].pronunciationDictionaryId`, `pronunciationDictionaryLocators[].versionId`.
3. Override only `firstMessageJa` to the target scenario's opening line.
4. Add provenance metadata so future agents can reason about the mirror:
   - `metadata.sourceVoiceProfileId`: the source profile id (e.g. `accounting_clerk_enterprise_ap_ja_v3_candidate_v1`)
   - `metadata.voiceReuseReason`: a short explanation (e.g. `Use the same published accounting roleplay voice per product requirement.`)
   - `metadata.notes`: optional; helpful for divergence audits.
5. Register the new profile in all three pools of `config/voice-profiles/scenario-map.json`: `activeProfiles`, `previewProfiles`, `benchmarkProfiles`.
6. Add a unit test in `voiceProfiles.test.ts` that asserts byte-equality of voiceId/model/voiceSettings/textNormalisationType/dictionary locator between source and mirror profile.

The schema for `voiceProfile.ts` already accepts `sourceVoiceProfileId` and `voiceReuseReason` under `metadata` (added 2026-04-26).

## Guardrails

- Approved does not automatically mean publish-ready.
- Keep transport fixes local to the Agents path; do not mutate profile SoT just to satisfy ConvAI payload differences.
- Confirm `pronunciationDictionaryLocators` readiness before finalizing an active mapping.
- Do not change `renderSpeech()` model handling when fixing Agents publish.
- Do not add automatic retry for `expressive_tts_not_allowed`.
- Prefer generated benchmark artifacts and review sheets over ad hoc notes.
- Do NOT extend `metadata.scenarioIds` of an existing profile to share voice across scenarios. Always mirror via a new profile (see Voice Reuse Across Scenarios above).
