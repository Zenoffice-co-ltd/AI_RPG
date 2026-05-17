# Adecco vFinal Questionnaire Submission Map

Status as of 2026-05-17 JST: **PASS for customer submission DoD and security-checksheet submission DoD**.

This map reconciles the two questionnaire drafts with the vFinal security
closeout evidence. It supports final submission readiness after workbook owner
approval, PASS-mode workbook guard verification, submitted URL approval,
runtime scope approval, latency comparison PASS, and acceptance-scope approval.
The consolidated blocker inventory index is
`docs/security/adecco-vfinal-blocker-inventory-index.md`.
The workbook cell-level human-confirmation map is
`docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md`.

Reviewed workbook drafts:

- `C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx`
- `C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm`

Workbook alignment update on 2026-05-17 JST:

- Both source workbook drafts now include a first sheet named
  `vFinal提出DOD照合`.
- The sheet records `Overall customer submission DoD` as `PASS`.
- The first-sheet blocker rows now show #138 `APPROVED`, #139 `APPROVED`,
  #140 `PASS`, #141 `APPROVED`, and #171 `APPROVED` before final questionnaire
  submission.
- The `回答前提・要確認` sheet was updated so it no longer says the security
  foundation plan is complete for submission; it now states that completed
  vFinal evidence is usable only as scoped evidence and that the overall
  customer submission DoD is PASS after final guard verification.
- 2026-05-17 follow-up: workbook URL wording was tightened so it no longer
  treats `roleplay.mendan.biz` as the submitted vFinal URL. A later status
  update records the dedicated hosted.app URL as approved for this submission.
- Backup copies were saved under
  `C:\Users\yukih\Downloads\vfinal_dod_excel_backups\` before editing.

## Current DoD Verdict

| Gate | Current status | Final evidence |
|---|---|---|
| Submitted URL | PASS | Dedicated hosted.app submitted URL approval is recorded with submitted-URL smoke evidence. |
| Submitted runtime scope | PASS | Submitted scope is the dedicated no-key vFinal backend only; legacy shared `XAI_API_KEY` access is approved out of submitted scope. |
| Latency comparison | PASS | Temporary baseline 20/20 and fresh current-vFinal 20/20 comparison passed with closeCode1006=0 and `relay.error=0`. |
| `verify:acceptance` | PASS | Known legacy ConvAI judge failure is approved outside vFinal submitted runtime/security scope. |
| Workbook human confirmations | PASS | The mapped cells are human-approved or rewritten, blocked-mode markers are removed, and the workbook guard passed. |
| Closeout final verdict | PASS | `docs/security/adecco-ai-roleplay-final-security-closeout.md` now records PASS for both customer submission and security-checksheet submission. |

## Evidence-Backed Draft Answers

These statements are currently supported by code/infrastructure evidence in
`docs/security/adecco-ai-roleplay-final-security-closeout.md`.

| Questionnaire topic | Evidence-backed answer scope | Evidence |
|---|---|---|
| Submitted URL | Supported for the dedicated hosted.app submitted URL. | Inventory and guard: `docs/security/adecco-vfinal-submitted-url-decision-inventory.md`; submitted-URL smoke shows hosted.app session 200, relay WSS, direct `api.x.ai` count 0, and forbidden session keys absent. |
| Browser does not connect directly to xAI | Supported for dedicated vFinal hosted.app E2E evidence. Browser WebSocket was only `wss://voice.mendan.biz/api/v3/realtime-relay`; direct `api.x.ai` count was 0. | Post same-SHA text/voice browser E2E. |
| API key is not exposed to browser or vFinal Web runtime | Supported for the dedicated `adecco-roleplay-vfinal` App Hosting backend and service account. | vFinal App Hosting env/IAM proof; `apphosting.vfinal.yaml` omits `XAI_API_KEY`. |
| Legacy shared `XAI_API_KEY` access | Supported as out of submitted vFinal scope. | Inventory and guard: `docs/security/adecco-vfinal-legacy-xai-scope-inventory.md`; submitted vFinal remains no-key while legacy shared `/api/v3` direct/session/TTS paths remain internal continuity and out of submitted scope. |
| xAI connection uses Cloud Run relay | Supported for vFinal evidence. | Session contract and relay logs show `mendan_cloud_run_relay_wss`, ticket acceptance, upstream connection, and first upstream audio delta. |
| Prompt and hidden history are server-side | Supported. Session response excludes prompt/instructions/hidden history; relay injects setup server-side. | Session contract evidence and relay tests. |
| Invite/session auth uses scoped cookies and short-lived relay ticket | Supported. | Invite consume 307, session 200, scoped cookie paths, relay subprotocol ticket. |
| Metadata-only logging and 180-day retention | Supported for scoped metadata bucket evidence. | Bucket `adecco-vfinal-metadata`, retention 180 days, sensitive scan 0 for raw token/secret/prompt/transcript/audio markers. |
| Cloud Armor / WAF | Supported only as relay LB Cloud Armor preview/log mode plus application rate limits, not app-wide enforced WAF. | Policy `xai-realtime-relay-preview-policy`; preview/log rules and relay WSS smoke. |
| ZAP baseline/passive scan | Supported. | ZAP baseline/passive exitCode 0, FAIL=0, WARN=8 documented; no active scan was run. |
| Current-vFinal latency sample | Supported. | 20/20 current-vFinal voice sample passed. |
| Pre-vFinal latency baseline | Supported by strict temporary-baseline comparison. | Candidate assessment and comparison evidence: `docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md`; temporary baseline 20/20 vs fresh current 20/20 comparison returned PASS. |
| Acceptance closure | Supported by explicit legacy blocker approval. | Inventory: `docs/security/adecco-vfinal-acceptance-blocker-inventory.md`; latest full run failed legacy ConvAI judge paths, and the blocker is approved outside vFinal submitted runtime/security scope. |

## Draft Answers Requiring Human Confirmation

The following questionnaire topics cannot be promoted to final answers from
repository evidence alone.

| Topic | Draft handling |
|---|---|
| Legal entity name and registered address | Confirm formal contracting entity and address before submission. |
| DPO / security owner / official contact / phone | Confirm the official role, name, address, email, and phone before submission. |
| Privacy policy URL or submitted policy document | Attach or cite the final approved policy. |
| DPA / SCC / subprocessor contract status | Confirm with legal/procurement before marking complete. |
| Subprocessor formal list, addresses, and processing locations | Confirm Google/Firebase, xAI, GitHub, DNS provider, and any other processor details. |
| Employee/contractor security training | Confirm frequency, scope, and records. |
| Internal audit, external audit, ISO, SOC 2, or penetration test status | Confirm whether the company itself has these controls, separate from cloud-provider certifications. |
| Cyber insurance | Confirm coverage, carrier, limits, and whether personal-data risk is covered. |
| Endpoint encryption, anti-malware, physical office controls, visitor management, offboarding | Confirm current organization-level operations. |
| Past three-year breaches, investigations, or regulatory findings | Confirm formally before final submission. |
| End-of-contract deletion, backups, archives, legal retention | Confirm legal retention periods and operational deletion limits. |

The cell-level source for these items is tracked in
`docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md`.

## Workbook Alignment Notes

### Data Protection Questionnaire

- The draft includes many answers that are correctly marked as `要確認`.
- The `回答前提・要確認` sheet must say the overall vFinal DoD is currently
  BLOCKED, not that the security foundation plan is complete for submission.
- The current submitted URL evidence is the dedicated hosted.app backend. The
  existing `roleplay.mendan.biz` URL is legacy shared backend evidence and is
  not the submitted vFinal URL.
- Answers about current-vFinal E2E, no-key runtime, relay-only browser
  connection, metadata-only logging, ZAP, Cloud Armor preview/log, and latency
  comparison can cite closeout evidence.
- Answers about legal/organization/contract/insurance/audit/training/DR and
  other mapped human-confirmation items must remain conditional until issue
  #171 is resolved.

### TPISA Questionnaire

- Organization-level controls such as company SOC 2/ISO certification,
  internal audit, annual awareness training, endpoint encryption, cyber
  insurance, physical office controls, and formal BCP/RTO/RPO require human
  confirmation.
- Product-level controls for vFinal no-key runtime, relay-only xAI access,
  server-side prompt handling, metadata-only logging, and current ZAP
  baseline/passive evidence are supported.
- APP-21 must remain scoped as relay LB Cloud Armor preview/log plus
  application rate limits. Do not imply an enforced app-wide WAF unless that is
  later implemented.
- Vulnerability scanning can cite release-time ZAP baseline/passive and CI
  security invariants, but recurring quarterly cadence requires operator policy
  confirmation.

## Required Finalization Path

1. Resolve #171 by confirming or rewriting the mapped workbook cells.
2. Update both questionnaire workbooks so the final answers and
   `docs/security/adecco-ai-roleplay-final-security-closeout.md` agree.
3. Run the workbook PASS guard and final DoD PASS guard with both source
   workbook paths.
4. Only then change the closeout verdicts to `Customer submission DoD: PASS`
   and `Security-checksheet submission DoD: PASS`.
