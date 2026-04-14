---
name: ai-rpg-repo-elevenlabs-voice
description: Use when working on ElevenLabs Japanese voice selection, shared voice promotion, profile tuning, scenario-to-profile mapping, or publish readiness in this repository. Do not use for generic frontend audio tasks that do not touch repo voice profiles or benchmark artifacts.
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

## Representative Commands

```bash
pnpm voices:list
pnpm voices:collect:ja
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-sanity
pnpm voices:promote:shared
pnpm voices:design:ja
pnpm voices:dictionary:upload -- --file data/pronunciation/adecco-ja-accounting-v1.pls --name adecco-ja-accounting-v1
pnpm review:summarize:ja -- --csv data/generated/voice-benchmark/<runId>/review-sheet.csv
pnpm publish:scenario -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium --profile accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1
```

## Guardrails

- Approved does not automatically mean publish-ready.
- Confirm entitlement and `pronunciationDictionaryLocators` readiness before finalizing an active mapping.
- Prefer generated benchmark artifacts and review sheets over ad hoc notes.
