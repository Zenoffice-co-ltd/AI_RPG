# Adecco vFinal Latency Baseline Candidate Assessment

Status as of 2026-05-17 JST: **PASS**.

This note supports issue #140. It does not change the customer submission DoD
verdict by itself. A strict temporary-baseline comparison has been collected
and returned PASS. The overall customer submission DoD remains blocked until
the remaining non-latency blockers, especially #171 workbook human
confirmations and umbrella #128 final closure, are resolved.

Evidence comments:

- https://github.com/Zenoffice-co-ltd/AI_RPG/issues/140#issuecomment-4468623153
- https://github.com/Zenoffice-co-ltd/AI_RPG/issues/128#issuecomment-4468623211

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

## 2026-05-17 Strict Baseline Comparison PASS

Temporary baseline environment:

- Backend: `adecco-vfinal-baseline`
- Origin: `https://adecco-vfinal-baseline--adecco-mendan.asia-east1.hosted.app`
- Service account:
  `firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com`
- Source: `adecco-roleplay-vfinal` App Hosting build-004 source archive
  `gs://firebaseapphosting-sources-787365421680-asia-east1/adecco-roleplay-vfinal-2026-05-16T10-38-49-527Z.zip`
- Baseline App Hosting rollout:
  `projects/adecco-mendan/locations/asia-east1/backends/adecco-vfinal-baseline/rollouts/build-2026-05-16-004`
- Rollout state: `SUCCEEDED`
- Relay allowlist: baseline hosted.app origin added while preserving existing
  origins.
- Relay revision after allowlist update: `xai-realtime-relay-00015-pwh`

Pre-sample baseline smoke:

```bash
corepack pnpm grok:first-vfinal:browser-e2e -- --mode start \
  --origin https://adecco-vfinal-baseline--adecco-mendan.asia-east1.hosted.app \
  --out out/grok_first_vfinal_baseline_smoke/2026-05-17T00-10-00-baseline-build004-start
```

Result: PASS. Session 200, `wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay`,
relay WSS only, direct `api.x.ai` count 0, and forbidden session/outgoing keys
absent.

Strict comparison inputs:

| Artifact | Runs | Result | `sessionApiMs` p95 | `firstAudioDeltaMs` p95 | `firstAudibleAudioMs` p95 | closeCode1006 | `relay.error` |
|---|---:|---|---:|---:|---:|---:|---:|
| `out/grok_first_vfinal_latency/2026-05-17T00-12-00-baseline-build004-voice20/summary.json` | 20 | 20/20 pass | 153 | 4633 | 4868 | 0 | 0 |
| `out/grok_first_vfinal_latency/2026-05-17T00-15-00-current-vfinal-voice20/summary.json` | 20 | 20/20 pass | 187 | 4702 | 4923 | 0 | 0 |

Cloud Logging aggregate counters for the matching windows:

- Baseline window: 2026-05-17T00:07:30Z to 2026-05-17T00:12:25Z.
  `client.connected=20`, `upstream.connected=20`, `closeCode1006=0`,
  `relay.error=0`.
- Current window: 2026-05-17T00:12:20Z to 2026-05-17T00:18:00Z.
  `client.connected=20`, `upstream.connected=20`, `closeCode1006=0`,
  `relay.error=0`.

Comparison command:

```bash
corepack pnpm grok:first-vfinal:latency-compare -- \
  --baseline out/grok_first_vfinal_latency/2026-05-17T00-12-00-baseline-build004-voice20/summary.json \
  --current out/grok_first_vfinal_latency/2026-05-17T00-15-00-current-vfinal-voice20/summary.json \
  --baseline-close-code1006 0 \
  --current-close-code1006 0 \
  --baseline-relay-error 0 \
  --current-relay-error 0 \
  --out out/grok_first_vfinal_latency_compare/2026-05-17T00-20-00-baseline-build004-vs-current/comparison-summary.json
```

Comparison output:

- `status=PASS`
- `sessionApiMs p95`: baseline 153, current 187, threshold 203.
- `firstAudioDeltaMs p95`: baseline 4633, current 4702, threshold 4733.
- `firstAudibleAudioMs p95`: baseline 4868, current 4923, threshold 4968.
- closeCode1006 increase: baseline 0, current 0, PASS.
- `relay.error` increase: baseline 0, current 0, PASS.

Comparison result: **PASS**.

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

2026-05-17 06:58 JST read-only Cloud Logging inventory:

- Official docs rechecked before the read-only GCP query:
  - `https://cloud.google.com/sdk/gcloud/reference/logging/read`
  - `https://cloud.google.com/logging/docs/view/logging-query-language`
- Added `corepack pnpm grok:vfinal-cloud-log-latency-inventory` so #140 can
  inspect Cloud Logging metadata without printing or persisting raw log JSON.
- Command:
  `corepack pnpm grok:vfinal-cloud-log-latency-inventory -- --expect=blocked --project=adecco-mendan --freshness=7d --limit=1000`.
- Result: PASS for expected BLOCKED state.
- The inventory found 53 `grokFirstVFinal` `turn.completed` entries across 53
  session hashes. All observed turn entries were from the current dedicated
  service `adecco-roleplay-vfinal`, with prompt version
  `grok-first-v50.6-2026-05-15` and guardrail version
  `grok-first-vfinal-guard-2026-05-16`.
- The Cloud Logging turn metadata has `firstAudioDeltaMs` and
  `firstAudibleAudioMs`, but does not include `sessionApiMs`, which is one of
  the strict #140 comparison metrics. Therefore these logs cannot be promoted
  into a comparison-ready pre-vFinal baseline artifact.
- Broad 7-day relay metadata for `backend="grok-first-vFinal"` found
  `relay.error=0`. It also found `closeCode1006=4` outside the narrower
  current-vFinal 20-session sample window. This broad read-only inventory does
  not replace the sample-window operational counters already recorded in the
  closeout and is not a formal latency comparison.
- Comparison-ready explicit pre-vFinal baseline candidates found by this
  Cloud Logging inventory: 0.

## Rejected Baseline Candidates

| Candidate family | Example artifact | Runs | Reason it is not a strict baseline |
|---|---|---:|---|
| v50.5 local voice E2E smoke | `C:\dev\AI_RPG\out\grok_first_v50_5_voice_e2e\smoke_full_20260515\summary.json` | 35 | Local `http://127.0.0.1:3115`, different demo slug/prompt version, failing quality run, and no `sessionApiMs` p95 metric. |
| v50.5 local P0 guard E2E | `C:\dev\AI_RPG\out\grok_first_v50_5_voice_e2e\p0_guards_20260515\summary.json` | 30 | Local guard-focused test set, failing quality run, different demo slug/prompt version, and no `sessionApiMs` p95 metric. |
| v50.8 fixed-guard E2E | `C:\dev\AI_RPG\out\grok_first_v50_8_fixed_guard_e2e\*\summary.json` | varies | Fixed-guard scope rather than same scenario latency sample; missing required `sessionApiMs` p95 metric and denominator is not consistently a 20-session comparable latency set. |
| older Grok Voice browser audio E2E | `C:\dev\AI_RPG\out\grok_voice_browser_audio_e2e\*\summary.json` | varies | Different route/version families and missing required `sessionApiMs` p95 metric. |
| Adecco v6/v7 log reports | `C:\dev\AI_RPG\out\adecco_roleplay_v*_log_report\*\summary.json` | n/a | Log report format does not provide the required three comparable p95 metrics and denominator. |

## Current Decision

Issue #140 now has passing strict latency comparison evidence. The repository
evidence supports this narrow statement:

> A same-environment temporary baseline backend collected a 20/20 pre-current
> vFinal voice baseline, a fresh current-vFinal 20/20 voice sample was collected
> in the same measurement window, Cloud Logging aggregate counters showed
> closeCode1006=0 and `relay.error=0` for both windows, and
> `corepack pnpm grok:first-vfinal:latency-compare` returned PASS.

This closes the latency-evidence gap for #140, subject to issue comment
recording and final DoD guard verification. It does not make the overall
customer submission DoD PASS while #171 workbook finalization and #128 final
closure remain incomplete.


Comparison summary: out/grok_first_vfinal_latency_compare/2026-05-17T00-20-00-baseline-build004-vs-current/comparison-summary.json.
Comparison result: PASS.
