# Adecco vFinal Latency Baseline Candidate Assessment

Status as of 2026-05-17 JST: **no approved strict pre-vFinal baseline found**.

This note supports issue #140. It does not change the customer submission DoD
verdict. The formal latency gate remains blocked until an approved
same-environment, same-scenario, >=20-session pre-vFinal baseline is compared
against the current-vFinal 20-session evidence and the comparison is within the
thresholds below.

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

2026-05-17 04:40 JST local artifact rescan:

| Artifact | Runs | Result | `sessionApiMs` p95 | `firstAudioDeltaMs` p95 | `firstAudibleAudioMs` p95 | Assessment |
|---|---:|---|---:|---:|---:|---|
| `out/grok_first_vfinal_latency/2026-05-16T14-24-18-471Z/summary.json` | 1 | 1/1 pass | 123 | 1432 | 1597 | Current-vFinal latency artifact with denominator below 20. Not a strict baseline. |
| `out/grok_first_vfinal_latency/2026-05-16T14-24-44-995Z/summary.json` | 20 | 20/20 pass | 544 | 5516 | 5531 | Current-vFinal sample only. Cannot serve as pre-vFinal baseline. |
| `out/grok_first_vfinal_latency/2026-05-16T14-30-36-907Z/summary.json` | 5 | 5/5 pass | 145 | 4742 | 4967 | Current-vFinal latency artifact with denominator below 20. Not a strict baseline. |
| `out/grok_first_vfinal_latency/2026-05-16T14-32-01-504Z/summary.json` | 20 | 20/20 pass | 301 | 5529 | 5743 | Current-vFinal sample recorded in closeout. Cannot serve as pre-vFinal baseline. |

No local `out/` artifact found in this rescan was both pre-vFinal and a
same-environment, same-scenario, >=20-session baseline with the required
metrics.

2026-05-17 04:52 JST cross-worktree artifact search:

- Searched `C:\dev\AI_RPG*\out\**\summary.json` across local worktrees for
  `sessionApiMs`, `firstAudioDeltaMs`, and `firstAudibleAudioMs`.
- Many v50, v25, older Grok Voice, and browser audio E2E summaries mentioned
  one or more latency/event fields, but only the four
  `C:\dev\AI_RPG_vfinal_pr\out\grok_first_vfinal_latency\*\summary.json`
  artifacts contained all three required vFinal comparison metrics.
- Those four artifacts are the same current-vFinal sampler outputs listed
  above: 1/1, 5/5, and two 20/20 current-vFinal samples. None is a
  pre-vFinal same-environment, same-scenario, >=20-session baseline.

2026-05-17 05:34 JST scoped latency artifact inventory guard:

- Added `corepack pnpm grok:first-vfinal:latency-artifact-inventory` so #140
  can be rechecked without an unbounded `C:\dev\AI_RPG*\out\**\summary.json`
  scan.
- Command:
  `corepack pnpm grok:first-vfinal:latency-artifact-inventory -- --expect=blocked --root out\grok_first_vfinal_latency`.
- Result: PASS for expected BLOCKED state.
- The scoped inventory visited 4 `summary.json` files, found 4 artifacts with
  the three required latency metrics, found 2 artifacts with denominator >=20
  and zero failed runs, found 2 current-vFinal-only candidates, and found 0
  explicit pre-vFinal baseline candidates.
- This guard is an inventory helper only. It does not approve a baseline and
  does not replace `corepack pnpm grok:first-vfinal:latency-compare` once an
  approved pre-vFinal baseline exists.

2026-05-17 05:54 JST operational-counter inventory tightening:

- Tightened `corepack pnpm grok:first-vfinal:latency-artifact-inventory` so a
  comparison-ready explicit pre-vFinal artifact must include closeCode1006 and
  `relay.error` counters. A p95-only summary can still be useful inventory, but
  it is not enough for #140 PASS.
- Command:
  `corepack pnpm grok:first-vfinal:latency-artifact-inventory -- --expect=blocked --root out\grok_first_vfinal_latency`.
- Result: PASS for expected BLOCKED state.
- The scoped inventory visited 4 `summary.json` files, found 4 strict metric
  candidates, found 2 denominator >=20 current-vFinal-only candidates, found 0
  artifacts with both operational counters embedded, and found 0
  comparison-ready explicit pre-vFinal baseline candidates.

2026-05-17 06:24 JST comparison identity guard:

- Tightened `corepack pnpm grok:first-vfinal:latency-compare` so comparison
  PASS now requires identity markers on both artifacts:
  - the baseline artifact/path must identify itself as pre-vFinal or baseline
    evidence; and
  - the current artifact/path must identify itself as current vFinal evidence.
- The existing same-artifact path check remains in place. This extra guard
  prevents a copied or renamed current-vFinal artifact from being used as the
  pre-vFinal baseline merely because the p95 thresholds and operational
  counters are present.
- `corepack pnpm grok:first-vfinal:latency-compare -- --self-test` passed with
  negative fixtures for missing baseline identity, missing current identity,
  missing operational counters, weak denominator, and same-artifact comparison.

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
   denominator, three required p95 metrics, close code 1006 comparison, and
   `relay.error` comparison.
2. Obtain approval to collect a new baseline in a separate equivalent
   environment or approved rollback window.
3. Compare that baseline against the current-vFinal 20-session sample and record
   `PASS` only if all thresholds in this document are met.

Comparison command once an approved baseline exists:

```bash
corepack pnpm grok:first-vfinal:latency-artifact-inventory -- \
  --expect=blocked \
  --root out\grok_first_vfinal_latency

corepack pnpm grok:first-vfinal:latency-compare -- \
  --baseline <pre-vFinal-summary.json> \
  --current out/grok_first_vfinal_latency/2026-05-16T14-32-01-504Z/summary.json \
  --baseline-close-code1006 <count> \
  --current-close-code1006 <count> \
  --baseline-relay-error <count> \
  --current-relay-error <count> \
  --out <comparison-summary.json>
```

The comparison output is the evidence to cite before promoting this assessment
to `PASS`. If the summary JSONs later include `closeCode1006Count` and
`relayErrorCount`, the explicit count flags may be omitted. Missing counter
evidence, fewer than 20 runs, any failed run, or passing the same summary as
both baseline and current returns `FAIL` and must keep #140 blocked.
