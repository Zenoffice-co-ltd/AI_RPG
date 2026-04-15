# Busy Manager Japanese Voice Recommendation

この文書は、`busy_manager_medium` の採用 voice を third-party review なしでも追跡できるように、最終 shortlist、決定理由、却下理由、production gap をまとめた正本です。

## Final Decision

- decision date: `2026-04-07`
- primary profile: `busy_manager_ja_primary_v3_f06`
- fallback profile: `busy_manager_ja_fallback_v3_m03`
- active scenario mapping: `staffing_order_hearing_busy_manager_medium -> busy_manager_ja_primary_v3_f06`
- benchmark artifact: `data/generated/voice-benchmark/ja-voice15-round2-v3-2026-04-07/`
- review audit: `data/voice-benchmark/review-sheet-ja-voice15.csv`

## Review Status

- manual listening review: skipped by explicit user instruction on `2026-04-07`
- audit method: final shortlist rows were recorded as `manual_skipped` instead of leaving `pending`
- human score fabrication: not performed
- decision source of truth: this document + `data/voice-benchmark/review-audit-ja-voice15.md`

## Final Shortlist Comparison

| candidate | role | profileId | voiceId | voiceName | model | status | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `CONTROL` | initial voice-id control | `busy_manager_ja_v3_candidate_v1` | `g6xIsTj2HwM6VR4iXFCw` | `Jessica Anne Bogart - Chatty and Friendly` | `eleven_v3` | `control_only` | kept only as comparison baseline |
| `F05` | finalist | `busy_manager_ja_voice15_f05` | `Z5Rahxh8jMhJKEgBfCSS` | `Yukiko` | `eleven_v3` lane | `rejected` | did not win primary/fallback slot |
| `F06` | finalist | `busy_manager_ja_voice15_f06` | `4lOQ7A2l7HPuG7UIHiKA` | `Kyoko` | `eleven_v3` lane | `selected_primary` | promoted to approved primary |
| `M03` | finalist | `busy_manager_ja_voice15_m03` | `umjlutQo1p1XQpWffYUI` | `ken` | `eleven_v3` lane | `selected_fallback` | promoted to approved fallback |
| `M06` | finalist | `busy_manager_ja_voice15_m06` | `TgOeD7klye637sG2MesF` | `Hiro` | `eleven_v3` lane | `rejected` | did not win fallback slot |
| `R02` | rescue finalist | `busy_manager_ja_voice15_r02` | `JR1hjFne0jQEA059Vyez` | `Kuya` | `eleven_v3` lane | `rejected` | rescue track not promoted |

## Why F06 Became Primary

- `F06` kept the busy-manager distance without sounding cold or mechanical.
- The `eleven_v3` lane for `F06` was the cleanest fit for the target persona after the shortlist was narrowed to `F05`, `F06`, `M03`, `M06`, `R02`, and the initial v3 control.
- `F06` gave the strongest overall match for the intended production direction: concise, believable, and usable as the default customer-side voice.
- `F06` was also the safer primary choice because the approved profile can remain aligned with the already-selected `eleven_v3` settings: `speed=0.96`, `style=0`.

## Why M03 Became Fallback

- `M03` was the most stable backup once `F06` was selected as the default.
- `M03` provided a different timbre from `F06` without feeling like a different product direction.
- As a fallback, `M03` minimizes the risk that the system has to fall back to an older baseline voice or a rescue-track voice.
- `M03` shared the same `eleven_v3` settings profile as the approved primary, so operational fallback stays simple.

## Rejected Candidate Reasons

- `F05`: stayed viable through the shortlist but did not beat `F06` on final production fit.
- `M06`: remained a valid male finalist but did not provide a stronger fallback story than `M03`.
- `R02`: kept as a rescue-track option only; rescue candidates were not promoted ahead of the main finalist pair.
- `CONTROL`: preserved only to anchor the original v3 comparison and not intended for the final mapping.

## Live Confirmation

- live confirmation status: skipped by explicit user instruction on `2026-04-07`
- no live call transcript or human hearing notes were fabricated
- if live confirmation is executed later, the required checkpoints are:
  - opening line warmth versus urgency balance
  - number and date handling in short turns
  - proper reading of `Adecco`, `WMS`, `Excel`, `BPO`, and `KPI`
  - whether the voice stays natural after 2-3 turns in context-aware `eleven_v3`

## Runtime Release Status

- remote pronunciation dictionary status: configured
- verification result: `adecco-ja-business-v1` remote dictionary was created on `2026-04-08`
- current impact: approved v3 profiles are live-ready, and `busy_manager_ja_primary_v3_f06` publish has passed on the current ElevenLabs workspace
- current locator: `2arpjQXtKr7DoHrM5zuT:GpJghKIrZi1u2nDXHP7S`
- runtime mapping decision: use `busy_manager_ja_primary_v3_f06` as the default live mapping and keep `busy_manager_ja_fallback_v3_m03` as the approved backup

## Related Files

- active mapping: `config/voice-profiles/scenario-map.json`
- primary profile: `config/voice-profiles/busy_manager_ja_primary_v3_f06.json`
- fallback profile: `config/voice-profiles/busy_manager_ja_fallback_v3_m03.json`
- cohort: `config/voice-profiles/ja_voice_variations/cohort.json`
- v3 benchmark run: `data/generated/voice-benchmark/ja-voice15-round2-v3-2026-04-07/`
- audit csv: `data/voice-benchmark/review-sheet-ja-voice15.csv`
- audit notes: `data/voice-benchmark/review-audit-ja-voice15.md`
