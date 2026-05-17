# Adecco vFinal Customer Submission Progress Report

Date: 2026-05-17 JST

Overall verdict: **Customer submission DoD remains BLOCKED**.

This report summarizes the current closeout state for the Adecco AI Roleplay
vFinal customer submission. It reflects the repository evidence, issue
approvals, source workbook guard status, and the latest strict latency
comparison evidence available as of 2026-05-17 JST.

## Executive Summary

The technical implementation and production security evidence are substantially
complete. The dedicated no-key vFinal App Hosting backend, Cloud Run relay
path, metadata-only logging, Cloud Armor preview/log mode, ZAP baseline,
browser E2E, same-SHA deploy evidence, and strict latency comparison evidence
are all in place.

The formal customer submission DoD is still blocked because the two source
questionnaire workbooks have not been finalized as submission artifacts. The
workbooks still intentionally report `vFinal提出DOD照合 = BLOCKED`, and issue
#171 remains open for human/legal/operator confirmations that cannot be proven
from code or infrastructure evidence alone.

## Progress Estimate

Estimated overall progress: **90%**.

Rationale:

- Technical implementation and live security evidence: about **95% complete**.
- Blocker closure and approval evidence: about **90% complete**.
- Formal submission artifacts, including the two Excel workbooks and final PASS
  guard: about **70% complete**.
- Final customer submission DoD: still **0% PASS** as a binary gate because the
  official verdict must remain BLOCKED until all final guard requirements pass.

The percentage above is a delivery progress estimate, not a formal DoD verdict.
The formal verdict is still BLOCKED.

## Completed Technical Evidence

The following areas are complete or evidence-backed for the vFinal submitted
runtime:

| Area | Current State |
| --- | --- |
| Dedicated App Hosting backend | PASS. Submitted runtime is the dedicated `adecco-roleplay-vfinal` backend. |
| No-key Web runtime | PASS. Dedicated vFinal service account is not granted `XAI_API_KEY` access. |
| xAI connectivity path | PASS. Browser traffic uses the Cloud Run relay; browser direct `api.x.ai` count is 0 in vFinal evidence. |
| Session API secrecy | PASS. Prompt, instructions, hidden history, API key, transcript, audio, and relay ticket are not returned to the browser session payload. |
| Invite flow | PASS. vFinal invite consume returns 307 and scoped cookies are used for the submitted route. |
| Relay path | PASS. Session `wsUrl` points to `wss://voice.mendan.biz/api/v3/realtime-relay`. |
| Metadata-only logging | PASS. Sensitive scan evidence is 0 for the scoped vFinal log buckets/windows. |
| Log retention | PASS. Dedicated logging bucket/sink evidence exists with 180-day retention. |
| Cloud Armor | PASS. Relay load balancer has preview/log mode WAF evidence. |
| Browser E2E | PASS. Text and voice browser E2E evidence exists for the dedicated vFinal route. |
| Same-SHA deploy | PASS. App Hosting and Cloud Run relay evidence are tied to the same submitted SHA. |
| ZAP baseline/passive | PASS. ZAP baseline/passive evidence has FAIL=0 with documented WARN classes. |
| Current vFinal latency sample | PASS. Current submitted vFinal 20/20 voice sample exists and passed. |
| Strict latency comparison | PASS evidence recorded for #140, pending final guard closure. |

## Issue Status

| Issue | Topic | Current State |
| --- | --- | --- |
| #128 | Umbrella customer submission blocker | OPEN. Keep open until final PASS guard and final closeout PR. |
| #138 | Submitted URL decision | APPROVED pending final guard. hosted.app submitted URL approval is recorded. |
| #139 | Legacy shared backend `XAI_API_KEY` scope | APPROVED pending final guard. Submitted scope is limited to the dedicated no-key vFinal backend; legacy shared backend is out of submitted scope. |
| #140 | Pre-vFinal latency baseline comparison | PASS pending final guard. Strict baseline/current comparison passed. |
| #141 | `verify:acceptance` legacy ConvAI blocker | APPROVED pending final guard. Legacy ConvAI judge blocker is approved out of vFinal submitted runtime/security scope. |
| #171 | Workbook human confirmations | BLOCKED. Source workbooks still require human/legal/operator confirmation and final PASS workbook guard. |

## #140 Latency Comparison Status

#140 is no longer the primary substantive blocker. A strict temporary baseline
comparison has been collected and passed.

Baseline environment:

- Backend: `adecco-vfinal-baseline`
- Origin:
  `https://adecco-vfinal-baseline--adecco-mendan.asia-east1.hosted.app`
- Service account:
  `firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com`
- Relay allowlist includes the temporary baseline origin.
- Relay revision after allowlist update: `xai-realtime-relay-00015-pwh`

Baseline evidence:

- Baseline start smoke: PASS.
- Baseline voice sample: 20/20 PASS.
- Current submitted vFinal voice sample: 20/20 PASS.
- Relay log counters were recorded as aggregate counts only; raw log JSON was
  not saved or committed.

Comparison result:

| Metric | Baseline p95 | Current p95 | Threshold | Result |
| --- | ---: | ---: | ---: | --- |
| `sessionApiMs` | 153 ms | 187 ms | 203 ms | PASS |
| `firstAudioDeltaMs` | 4633 ms | 4702 ms | 4733 ms | PASS |
| `firstAudibleAudioMs` | 4868 ms | 4923 ms | 4968 ms | PASS |
| `closeCode1006` | 0 | 0 | no increase | PASS |
| `relay.error` | 0 | 0 | no increase | PASS |

Comparison artifact:

- `out/grok_first_vfinal_latency_compare/2026-05-17T00-20-00-baseline-build004-vs-current/comparison-summary.json`

Operational note: the temporary baseline backend and baseline relay allowlist
entry should be treated as measurement infrastructure. Cleanup should be
documented separately if/when approved; it should not be mixed into a final
PASS wording change unless explicitly included in the final closeout scope.

## #171 Workbook Status

#171 remains the only major substantive blocker.

Source workbooks:

- `C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx`
- `C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm`

Current workbook guard state:

- Both workbooks still have first sheet `vFinal提出DOD照合`.
- Both workbooks still report overall status `BLOCKED`.
- The first-sheet blocker rows now show #138 `APPROVED`, #139 `APPROVED`,
  #140 `PASS`, #141 `APPROVED`, and #171 `BLOCKED`.
- The TPISA workbook still preserves its VBA project.
- The blocked-mode workbook guard passes, which is expected.
- The pass-mode workbook guard has not passed and must not be treated as passed.

Items that still require human/legal/operator confirmation include:

- Legal entity name and registered address.
- DPO, security contact, and phone number.
- Privacy policy or submission document reference.
- DPA, SCC, and subprocessor contract status.
- Subprocessor legal names, addresses, and processing locations.
- Insurance coverage.
- Certification, audit, and third-party penetration test status.
- Physical security and visitor controls.
- Company device encryption and malware protection.
- DR/BCP, RTO, and RPO.
- Security training frequency and records.
- Past incident, breach, and regulatory investigation history.
- Deletion, backup, archive, and legal retention policy.

These items cannot be converted to PASS from repository evidence alone.

## Final Guard Status

Latest expected-BLOCKED verification is consistent:

- `grok:vfinal-workbook-human-confirmations --expect=blocked`: PASS.
- `grok:vfinal-submission-dod-status --expect=blocked --check-github-issues --allow-open-approved-issues`: PASS.
- `grok:vfinal-security-invariants`: PASS.
- `git diff --check`: PASS.

The expected-BLOCKED final guard now reports individual inventory status PASS
for #138, #139, #140, and #141, with remaining blockers `#128` and `#171`.
The final PASS guard has not been run successfully because the source workbooks
are still blocked and #128/#171 remain open.

## What Remains

The remaining shortest path is:

1. Human/legal/operator owner finalizes both source workbooks.
2. Both workbooks are promoted from blocked-mode to PASS-mode without copying
   raw workbook answers into docs or issue comments.
3. Run the workbook PASS guard against both source workbook paths.
4. Update #171 and #128 with count/status-only workbook evidence.
5. Update the closeout docs from BLOCKED to PASS only after the workbook guard
   and final DoD guard pass.
6. Run the final DoD guard with issue-state checking and both workbook paths.
7. Create one final closeout PR and close #128, #138, #139, #140, #141, and
   #171 only after the final PASS guard succeeds.

## Do Not Do

- Do not mark `Customer submission DoD: PASS` while #171 remains blocked.
- Do not treat #140 as waived; the current acceptable route is the strict
  comparison evidence now recorded.
- Do not copy Excel answer values into docs, PR text, or issue comments.
- Do not commit raw Cloud Logging JSON, invite tokens, cookies, relay tickets,
  audio, transcripts, prompts, or secret values.
- Do not remove legacy shared backend `XAI_API_KEY` access without a separate
  approved migration/de-scope plan.
- Do not include `out/` artifacts in a docs PR unless a specific artifact is
  intentionally approved for commit.

## Current Recommended Progress Statement

Recommended external-facing statement:

> The vFinal technical and security evidence is largely complete, including the
> dedicated no-key runtime, relay-only browser path, metadata-only logging, WAF
> preview evidence, ZAP, browser E2E, and strict latency comparison. The customer
> submission DoD remains BLOCKED until the two source questionnaire workbooks are
> finalized by the human/legal/operator owner and the final workbook and DoD
> guards pass.
