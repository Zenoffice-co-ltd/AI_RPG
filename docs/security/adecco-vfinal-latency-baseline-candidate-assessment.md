# Adecco vFinal Latency Baseline Candidate Assessment

Status as of 2026-05-17 JST: **no approved strict pre-vFinal baseline found**.

This note supports issue #140. It does not change the customer submission DoD
verdict. The formal latency gate remains blocked until an approved
same-environment, same-scenario, >=20-session pre-vFinal baseline is compared
against the current-vFinal 20-session evidence, or an authorized approver waives
or replaces that strict baseline requirement.

## Strict Baseline Requirement

The current vFinal comparison rule requires:

- pre-vFinal sample denominator >=20 sessions;
- same scenario and comparable browser/voice path;
- comparable environment;
- `sessionApiMs`, `firstAudioDeltaMs`, and `firstAudibleAudioMs` metrics;
- close code 1006 and `relay.error` comparison evidence.

The PASS thresholds are:

- current `sessionApiMs` p95 <= baseline p95 + 50ms;
- current `firstAudioDeltaMs` p95 <= baseline p95 + 100ms;
- current `firstAudibleAudioMs` p95 <= baseline p95 + 100ms;
- no close code 1006 increase;
- no `relay.error` increase.

## Eligible Current-vFinal Evidence

These are current-vFinal samples, not pre-vFinal baselines:

| Artifact | Runs | Result | `sessionApiMs` p95 | `firstAudioDeltaMs` p95 | `firstAudibleAudioMs` p95 | Assessment |
|---|---:|---|---:|---:|---:|---|
| `out/grok_first_vfinal_latency/2026-05-16T14-24-44-995Z/summary.json` | 20 | 20/20 pass | 544 | 5516 | 5531 | Current-vFinal sample only. Cannot serve as pre-vFinal baseline. |
| `out/grok_first_vfinal_latency/2026-05-16T14-32-01-504Z/summary.json` | 20 | 20/20 pass | 301 | 5529 | 5743 | Current-vFinal sample recorded in closeout. Cannot serve as pre-vFinal baseline. |

## Rejected Baseline Candidates

| Candidate family | Example artifact | Runs | Reason it is not a strict baseline |
|---|---|---:|---|
| v50.5 local voice E2E smoke | `C:\dev\AI_RPG\out\grok_first_v50_5_voice_e2e\smoke_full_20260515\summary.json` | 35 | Local `http://127.0.0.1:3115`, different demo slug/prompt version, failing quality run, and no `sessionApiMs` p95 metric. |
| v50.5 local P0 guard E2E | `C:\dev\AI_RPG\out\grok_first_v50_5_voice_e2e\p0_guards_20260515\summary.json` | 30 | Local guard-focused test set, failing quality run, different demo slug/prompt version, and no `sessionApiMs` p95 metric. |
| v50.8 fixed-guard E2E | `C:\dev\AI_RPG\out\grok_first_v50_8_fixed_guard_e2e\*\summary.json` | varies | Fixed-guard scope rather than same scenario latency sample; missing required `sessionApiMs` p95 metric and denominator is not consistently a 20-session comparable latency set. |
| older Grok Voice browser audio E2E | `C:\dev\AI_RPG\out\grok_voice_browser_audio_e2e\*\summary.json` | varies | Different route/version families and missing required `sessionApiMs` p95 metric. |
| Adecco v6/v7 log reports | `C:\dev\AI_RPG\out\adecco_roleplay_v*_log_report\*\summary.json` | n/a | Log report format does not provide the required three comparable p95 metrics and denominator. |

## Current Decision

Issue #140 remains blocked. The repository evidence supports only this narrow
statement:

> Current-vFinal 20-session latency evidence exists and passes its own scoped
> checks, but no approved strict pre-vFinal >=20-session baseline artifact is
> available for the formal comparison gate.

The next valid paths are:

1. Obtain approval for a specific pre-existing baseline source and document its
   denominator and three required p95 metrics.
2. Obtain approval to collect a new baseline in a separate equivalent
   environment or approved rollback window.
3. Obtain explicit customer/operator approval to waive or replace the strict
   pre-vFinal baseline requirement for this submission.

