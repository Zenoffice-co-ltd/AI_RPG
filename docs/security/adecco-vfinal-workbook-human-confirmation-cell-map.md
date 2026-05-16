# Adecco vFinal Workbook Human Confirmation Cell Map

Status as of 2026-05-17 JST: **human confirmation still required before final questionnaire submission**.

This map lists questionnaire cells whose answers cannot be proven by repository
or vFinal infrastructure evidence alone. It supports the requirement that the
Excel drafts must not be promoted to final PASS while unconfirmed organization,
legal, insurance, audit, contract, or operational facts remain open.

GitHub tracking issue: https://github.com/Zenoffice-co-ltd/AI_RPG/issues/171

## Source Workbooks

- `C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx`
- `C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm`

The source workbooks currently stay in BLOCKED mode through the first sheet
`vFinal提出DOD照合`. This file does not change that verdict.

2026-05-17 04:40 JST machine-readable workbook recheck:

- Both source workbooks still have `vFinal提出DOD照合` as the first sheet.
- Both first sheets still include `Overall customer submission DoD BLOCKED` and
  an `Excel人間確認 (#171) BLOCKED` row.
- `Adecco_データ保護アンケート_v01_回答ドラフト.xlsx`: all 25 mapped cells were
  non-empty, but 17 still contained confirmation or unresolved markers such as
  `要確認`, `未確認`, `未確定`, `確認`, or blocker references.
- `Adecco_TPISAアンケート_v01_回答ドラフト.xlsm`: all 34 expanded mapped
  cells were non-empty, but 19 still contained confirmation or unresolved
  markers such as `要確認`, `未確認`, `未確定`, `確認`, or blocker references.
- No workbook values were copied into this file. This count-only recheck
  confirms #171 remains unresolved until the mapped cells are human-confirmed
  or rewritten to explicit unresolved/not-applicable answers.

2026-05-17 05:24 JST count-only workbook recheck:

- Command:
  `corepack pnpm grok:vfinal-workbook-human-confirmations -- --expect=blocked --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"`.
- Both source workbooks still have `vFinal提出DOD照合` as the first sheet and
  overall status `BLOCKED`.
- `Adecco_データ保護アンケート_v01_回答ドラフト.xlsx`: 25/25 mapped cells were
  non-empty and remain human-confirmation items. The mapped answer-cell marker
  scan found 1 cell containing a blocker/confirmation marker.
- `Adecco_TPISAアンケート_v01_回答ドラフト.xlsm`: 34/34 expanded mapped cells
  were non-empty and remain human-confirmation items. The mapped answer-cell
  marker scan found 0 cells containing blocker/confirmation markers, and the
  workbook still retained `vbaProject.bin`.
- The marker scan is a diagnostic only. It does not reduce the confirmation
  denominator: all mapped cells listed below still require human/legal/operator
  confirmation or explicit unresolved/not-applicable wording before the source
  workbooks can be promoted to final submission artifacts.
- No workbook answer values were copied into this file.

2026-05-17 06:08 JST final-PASS helper recheck:

- `corepack pnpm grok:vfinal-workbook-human-confirmations -- --self-test`
  passed.
- `--expect=blocked` passed against both source workbooks.
- `--expect=pass` failed as expected while both source workbooks remain in
  BLOCKED mode. The helper now rejects final PASS when the first sheet overall
  status is not `PASS`, any B3:B7 blocker row is still `BLOCKED`, mapped
  human-confirmation cells are empty, mapped blocker references remain, or
  workbook-wide blocked-mode markers remain.
- Diagnostic marker counts still include broad confirmation wording, but PASS
  mode only treats concrete blocker references as mapped-cell blockers so a
  final human answer such as "confirmed" or "確認済み" is not rejected solely for
  being a confirmation statement.
- No workbook answer values were copied into this file.

## Data Protection Questionnaire Cells

| Sheet | Cell | Confirmation needed before final submission |
|---|---:|---|
| `Sheet1` | `E5` | Formal contracting entity name and registered address. |
| `Sheet1` | `E6` | Affiliate involvement, if any, with formal names/addresses. |
| `Sheet1` | `E8` | GDPR EU representative requirement. |
| `Sheet1` | `E9` | DPO / privacy owner / official contact and approved contact address. |
| `Sheet1` | `E12` | Final privacy policy URL or submitted policy document. |
| `Sheet1` | `E14` | DPA, SCC, data subject request, breach notification, and transfer safeguards. |
| `Sheet1` | `E15` | Formal past-three-year privacy law violation check. |
| `Sheet1` | `E24` | Final data-flow attachment and processing locations, including xAI and cloud regions. |
| `Sheet1` | `E25` | Final safeguards for inadequate-protection jurisdictions. |
| `Sheet1` | `E27` | Subprocessor / transfer change approval process. |
| `Sheet1` | `E28` | Employee/contractor data protection training frequency and records. |
| `Sheet1` | `E30` | Formal subprocessor list, addresses, and processing places. |
| `Sheet1` | `E32` | Subprocessor due-diligence procedure and evidence. |
| `Sheet1` | `E34` | Subprocessor register / contract management procedure. |
| `Sheet1` | `E35` | Adecco prior written approval process for new subprocessors. |
| `Sheet1` | `E36` | Formal past-three-year subprocessor privacy violation check. |
| `Sheet1` | `E37` | Cross-border subprocessor contract / DPA / SCC safeguards. |
| `Sheet1` | `E42` | External independent security audit / penetration test status. |
| `Sheet1` | `E43` | Company physical controls and endpoint handling, separate from cloud provider controls. |
| `Sheet1` | `E46` | Formal past-three-year regulator investigation / breach inquiry check. |
| `Sheet1` | `E49` | Audit-right acceptance scope and process. |
| `Sheet1` | `E51` | Company-held privacy/security certifications, if any. |
| `Sheet1` | `E56` | Cyber insurance enrollment status. |
| `Sheet1` | `E57` | Personal-data risk insurance carrier, coverage, and limits. |
| `Sheet1` | `E60` | Legal retention periods, backup/archive deletion limits, and deletion policy. |

## TPISA Cells

| Sheet | Cell | Confirmation needed before final submission |
|---|---:|---|
| `基本情報` | `C12` | Formal legal company name and registered address. |
| `基本情報` | `C15:C18` | Official security contact, role, email, and phone. |
| `A.組織のセキュリティ` | `G12` | Company SOC 2 or equivalent external audit status. |
| `A.組織のセキュリティ` | `G13` | Company ISO 27001 certification status. |
| `A.組織のセキュリティ` | `G14` | Organization-wide security policy approval status. |
| `A.組織のセキュリティ` | `G15` | Security/privacy training cadence and attendance records. |
| `A.組織のセキュリティ` | `G16` | Formal internal audit function or external audit record. |
| `A.組織のセキュリティ` | `G18` | Privileged access review cadence and evidence. |
| `A.組織のセキュリティ` | `G23:G24` | DR/BCP RTO/RPO values and test cadence evidence. |
| `A.組織のセキュリティ` | `G27` | Company endpoint/device encryption policy and implementation. |
| `A.組織のセキュリティ` | `G31` | Firewall/WAF/LB/rate-limit review cadence evidence. |
| `A.組織のセキュリティ` | `G32` | Incident process formal approval and review cadence. |
| `A.組織のセキュリティ` | `G33` | Formal past-12-month incident check. |
| `A.組織のセキュリティ` | `G35:G36` | Recurring vulnerability scan and patch cadence policy evidence. |
| `A.組織のセキュリティ` | `G37` | Company anti-malware deployment and scan operation. |
| `A.組織のセキュリティ` | `G38:G40` | Office physical access list, offboarding, and visitor management controls. |
| `B.製品のセキュリティ` | `G14` | Idle timeout / cookie expiry / re-authentication policy. |
| `B.製品のセキュリティ` | `G15` | Product privileged access review cadence evidence. |
| `B.製品のセキュリティ` | `G18` | Product DR/rollback RTO/RPO values. |
| `B.製品のセキュリティ` | `G21` | Backup/log retrieval or rollback test cadence evidence. |
| `B.製品のセキュリティ` | `G26` | 180-day metadata log retention is supported, but final review procedure remains operational. |
| `B.製品のセキュリティ` | `G33` | Recurring scan cadence beyond release-time evidence. |
| `B.製品のセキュリティ` | `G35:G37` | Cloud provider physical/data-center controls evidence references. |
| `B.製品のセキュリティ` | `G39:G40` | Independent penetration test and third-party validation status. |

## Finalization Rule

Before the workbooks can be treated as final submission artifacts, every row
above needs either:

- human confirmation with the final answer kept in the workbook; or
- workbook wording changed to an explicit `未実施`, `要確認`, or not-applicable
  answer that does not overclaim the control.

The final closeout PR should update this file to `PASS` only after those cell
answers are confirmed or rewritten and issue #171 is closed or formally
approved out of scope.
