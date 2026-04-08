# ElevenLabs Voice Selection Workflow

This document is the long-form reference behind the repo-scoped Codex skill at `.agents/skills/ai-rpg-repo-elevenlabs-voice/SKILL.md`.

This doc is the repo-local, reusable version of the Japanese ElevenLabs voice-selection workflow. It is intended to be usable without any dependency on `CODEX_HOME` or the local skill store.

## Use This When

- You need to review the current Japanese voice inventory.
- You need to run the 15-voice cohort selection loop.
- You need to compare `eleven_multilingual_v2` against `eleven_v3`.
- You need to generate rescue previews for fallback slots.
- You need to promote shared voices before final mapping.
- You need to update the final profile and scenario mapping after approval.

## Canonical References

- `docs/ELEVENLABS_VOICE_SPEC.md`
- `docs/VOICE_PROFILE_SCHEMA.md`
- `docs/VOICE_TUNING_RUNBOOK.md`
- `docs/VOICE_SELECTION_JA_15_RUNBOOK.md`
- `docs/VOICE_RECOMMENDATION_BUSY_MANAGER_JA.md`
- `config/voice-profiles/ja_voice_variations/cohort.json`
- `config/voice-profiles/scenario-map.json`

## Canonical Commands

```bash
pnpm voices:list
pnpm voices:collect:ja
pnpm voices:promote:shared
pnpm voices:design:ja
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-sanity
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-full
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round2-v3 --include-profile busy_manager_ja_v3_candidate_v1
pnpm review:summarize:ja -- --csv data/generated/voice-benchmark/<runId>/review-sheet.csv
```

## Workflow

### 1. Inventory

Start with `pnpm voices:list` and `pnpm voices:collect:ja` to gather workspace, shared, and rescue candidates. Keep the 15-voice cohort boundaries aligned with `config/voice-profiles/ja_voice_variations/cohort.json`.

The working set is:

- control profiles: baseline, multilingual candidate, and v3 candidate
- round 1 finalists: `F01` to `F06` and `M01` to `M06`
- rescue slots: `R01` to `R03`

### 2. Shortlist

Run the sanity pass first, then mark finalists in `cohort.json`.

```bash
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-sanity
```

After the first pass, set `finalist: true` on the shortlisted voices, typically the Top 6, and then run the full pass.

```bash
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-full
```

Generated benchmark artifacts live under:

- `data/generated/voice-benchmark/<runId>/manifest.json`
- `data/generated/voice-benchmark/<runId>/summary.csv`
- `data/generated/voice-benchmark/<runId>/review-sheet.csv`
- `data/generated/voice-benchmark/<runId>/index.html`
- `data/generated/voice-benchmark/<runId>/audio/*.mp3`

### 3. Finalist Flow

Use the generated `review-sheet.csv` and the rendered audio to decide the final shortlist. The repo tracks final approval separately from the round 1 shortlist, so keep the cohort file and the recommendation doc in sync.

```bash
pnpm review:summarize:ja -- --csv data/generated/voice-benchmark/<runId>/review-sheet.csv
```

If the final decision is a shared voice or needs shared fallback cleanup, promote the shared voice first so the later publish snapshot is stable.

```bash
pnpm voices:promote:shared
```

### 4. Rescue Preview Flow

Rescue slots are not final until they are explicitly designed and re-reviewed. Preview them with the dedicated design flow:

```bash
pnpm voices:design:ja
```

This is the step that replaces shared fallback rescue slots with explicit Voice Design candidates before final approval.

### 5. Final Mapping Flow

After the approved voice is selected, update the relevant profile JSON and the active scenario mapping.

1. Update the chosen profile in `config/voice-profiles/*.json`.
2. Update `config/voice-profiles/scenario-map.json`.
3. Record the shortlist outcome in `data/voice-benchmark/review-sheet-ja-voice15.csv` and, if manual review is skipped, close the trace in `data/voice-benchmark/review-audit-ja-voice15.md`.
4. Verify the generated publish snapshot and the benchmark outputs.
5. Treat the publish artifact and the active mapping as the final source of truth.

The final verification should confirm:

- the profile ID matches the approved selection
- the publish snapshot reflects the intended voice
- the benchmark outputs still match the selected profile
- approved profiles are not treated as publish-ready until `pronunciationDictionaryLocators` are configured

## Guardrails

- Keep voice IDs, model IDs, and profile mappings consistent with the repo docs.
- Do not treat rescue slots as approved until explicit Voice Design has been run.
- Prefer generated artifacts and recorded review sheets over memory or ad hoc notes.
- If the active mapping changes, verify the publish snapshot before calling the result final.
- Treat approved profiles as non-publish-ready until dictionary readiness is confirmed.
- Hooks are not a required part of this workflow on Windows Codex sessions; follow the commands and guardrails here directly.
