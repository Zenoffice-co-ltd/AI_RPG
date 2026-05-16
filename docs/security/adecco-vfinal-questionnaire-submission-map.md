# Adecco vFinal Questionnaire Submission Map

Status as of 2026-05-17 JST: **BLOCKED for customer submission DoD and security-checksheet submission DoD**.

This map reconciles the two questionnaire drafts with the vFinal security
closeout evidence. It must not be used to claim final submission readiness
until the four remaining decisions/evidence gaps are resolved or formally
approved out of scope. The same blocker set applies to the security-checksheet
submission DoD because the questionnaire drafts cannot be promoted to final
answers while submitted URL, runtime scope, latency comparison, and acceptance
remain unresolved.

Reviewed workbook drafts:

- `C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx`
- `C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm`

Workbook alignment update on 2026-05-17 JST:

- Both source workbook drafts now include a first sheet named
  `vFinal提出DOD照合`.
- The sheet records `Overall customer submission DoD` as `BLOCKED` and lists
  #138, #139, #140, and #141 as unresolved.
- The `回答前提・要確認` sheet was updated so it no longer says the security
  foundation plan is complete for submission; it now states that completed
  vFinal evidence is usable only as scoped evidence and that the overall
  customer submission DoD remains blocked.
- Backup copies were saved under
  `C:\Users\yukih\Downloads\vfinal_dod_excel_backups\` before editing.

## Current DoD Verdict

| Gate | Current status | Required before PASS |
|---|---|---|
| Submitted URL | BLOCKED by issue #138 | Approve the dedicated hosted.app URL for submission, or map an active dedicated vFinal `mendan.biz` custom domain to `adecco-roleplay-vfinal`. |
| Submitted runtime scope | BLOCKED by issue #139 | Approve that only the dedicated no-key vFinal backend is in submission scope and legacy shared `XAI_API_KEY` access is out of scope, or migrate/remove the legacy dependency. |
| Latency comparison | BLOCKED by issue #140 | Compare current-vFinal 20-session p95 evidence with an approved or newly collected >=20-session pre-vFinal baseline. |
| `verify:acceptance` | BLOCKED by issue #141 | Obtain a clean full PASS, or formally approve the known legacy ConvAI judge failure as outside vFinal submission scope. |
| Closeout final verdict | BLOCKED | Keep `docs/security/adecco-ai-roleplay-final-security-closeout.md` as BLOCKED for both customer submission and security-checksheet submission until all gates above are resolved or approved. |

## Evidence-Backed Draft Answers

These statements are currently supported by code/infrastructure evidence in
`docs/security/adecco-ai-roleplay-final-security-closeout.md`.

| Questionnaire topic | Evidence-backed answer scope | Evidence |
|---|---|---|
| Browser does not connect directly to xAI | Supported for dedicated vFinal hosted.app E2E evidence. Browser WebSocket was only `wss://voice.mendan.biz/api/v3/realtime-relay`; direct `api.x.ai` count was 0. | Post same-SHA text/voice browser E2E. |
| API key is not exposed to browser or vFinal Web runtime | Supported for the dedicated `adecco-roleplay-vfinal` App Hosting backend and service account. | vFinal App Hosting env/IAM proof; `apphosting.vfinal.yaml` omits `XAI_API_KEY`. |
| Legacy shared `XAI_API_KEY` access | Not supported as submitted vFinal scope until #139 is approved or migrated/removed. | Inventory: `docs/security/adecco-vfinal-legacy-xai-scope-inventory.md`; legacy shared `/api/v3` direct/session/TTS paths still depend on `XAI_API_KEY`. |
| xAI connection uses Cloud Run relay | Supported for vFinal evidence. | Session contract and relay logs show `mendan_cloud_run_relay_wss`, ticket acceptance, upstream connection, and first upstream audio delta. |
| Prompt and hidden history are server-side | Supported. Session response excludes prompt/instructions/hidden history; relay injects setup server-side. | Session contract evidence and relay tests. |
| Invite/session auth uses scoped cookies and short-lived relay ticket | Supported. | Invite consume 307, session 200, scoped cookie paths, relay subprotocol ticket. |
| Metadata-only logging and 180-day retention | Supported for scoped metadata bucket evidence. | Bucket `adecco-vfinal-metadata`, retention 180 days, sensitive scan 0 for raw token/secret/prompt/transcript/audio markers. |
| Cloud Armor / WAF | Supported only as relay LB Cloud Armor preview/log mode plus application rate limits, not app-wide enforced WAF. | Policy `xai-realtime-relay-preview-policy`; preview/log rules and relay WSS smoke. |
| ZAP baseline/passive scan | Supported. | ZAP baseline/passive exitCode 0, FAIL=0, WARN=8 documented; no active scan was run. |
| Current-vFinal latency sample | Supported only as current-vFinal scoped evidence, not formal comparison PASS. | 20/20 current-vFinal voice sample passed; pre-vFinal baseline missing. |
| Pre-vFinal latency baseline | Not supported yet. | Candidate assessment: `docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md`; no approved strict >=20-session pre-vFinal baseline found. |

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

## Workbook Alignment Notes

### Data Protection Questionnaire

- The draft includes many answers that are correctly marked as `要確認`.
- The `回答前提・要確認` sheet must say the overall vFinal DoD is currently
  BLOCKED, not that the security foundation plan is complete for submission.
- The current submitted URL evidence is the dedicated hosted.app backend. The
  existing `roleplay.mendan.biz` URL is legacy shared backend evidence unless a
  dedicated vFinal custom domain is approved and mapped.
- Answers about current-vFinal E2E, no-key runtime, relay-only browser
  connection, metadata-only logging, ZAP, and Cloud Armor preview/log can cite
  closeout evidence.
- Answers about URL approval, legacy shared backend de-scope, latency
  comparison PASS, and `verify:acceptance` PASS must remain blocked or
  explicitly conditional until issues #138-#141 are resolved.

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

1. Resolve or formally approve issue #138.
2. Resolve or formally approve issue #139.
3. Resolve issue #140 with an approved >=20-session pre-vFinal baseline and
   comparison.
4. Resolve or formally approve issue #141.
5. Update both questionnaire workbooks so the final answers and
   `docs/security/adecco-ai-roleplay-final-security-closeout.md` agree.
6. Only then change the closeout verdicts to `Customer submission DoD: PASS`
   and `Security-checksheet submission DoD: PASS`.
