# Adecco vFinal Workbook Owner Signoff

Date: 2026-05-17 JST

Status: **#171 workbook owner action required**.

This signoff note is the shortest path for the workbook owner, legal owner, or
operator to finish #171 without copying questionnaire answer values into the
repository, issue comments, or PR text.

## Current State

The technical submission blockers are already recorded as evidence-backed or
approved pending final guard:

| Item | Current state |
|---|---|
| #138 submitted URL | APPROVED pending final guard |
| #139 submitted runtime scope | APPROVED pending final guard |
| #140 latency comparison | PASS pending final guard |
| #141 acceptance blocker treatment | APPROVED pending final guard |
| #171 workbook human confirmations | BLOCKED |
| #128 umbrella | OPEN until final PASS guard succeeds |

The two source workbooks currently remain overall `BLOCKED`:

- `C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx`
- `C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm`

The first sheet `vFinal提出DOD照合` now reflects the current state:

- #138 `APPROVED`
- #139 `APPROVED`
- #140 `PASS`
- #141 `APPROVED`
- #171 `BLOCKED`
- overall `BLOCKED`

Latest count-only helper output identifies one mapped blocker marker in the
Data Protection workbook without exposing the cell value:

- `Adecco_データ保護アンケート_v01_回答ドラフト.xlsx`: `Sheet1!E24`
  for final data-flow attachment and processing locations, including xAI and
  cloud regions
- `Adecco_TPISAアンケート_v01_回答ドラフト.xlsm`: no mapped blocker marker
  cells reported

The cell value itself must stay in the workbook and must not be copied into
docs, issue comments, PR text, or command output.

## What The Workbook Owner Must Do

For every cell listed in
`docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md`, the
workbook owner must choose one final treatment inside the source workbook:

- Confirm the final answer as accurate.
- Rewrite the answer to an explicit unresolved answer.
- Rewrite the answer to an explicit not-applicable answer.

The repository cannot prove these organization/legal/operator facts by itself.
Do not mark the workbook as final if any mapped answer still overclaims an
unconfirmed fact.

## Human-Confirmation Categories

The mapped cells cover these human-confirmation categories:

- Legal entity name and registered address.
- DPO, privacy owner, security contact, email, and phone.
- Privacy policy or submitted policy document.
- DPA, SCC, transfer safeguards, and subprocessor contract status.
- Subprocessor legal names, addresses, and processing locations.
- Training frequency and records.
- Internal audit, external audit, SOC 2, ISO 27001, and penetration test status.
- Cyber insurance coverage, carrier, and limits.
- Endpoint encryption, anti-malware, physical access, visitor management, and
  offboarding controls.
- DR/BCP, RTO/RPO, backup, archive, deletion, and legal retention policy.
- Past breach, incident, regulator investigation, or privacy-law violation
  history.

## PASS-Mode Workbook Requirements

After the workbook owner finishes the mapped cells:

1. Change both source workbooks' `vFinal提出DOD照合` overall status to `PASS`.
2. Ensure B3:B7 no longer contain `BLOCKED`.
3. Remove blocked-mode workbook markers, including:
   - `BLOCKED`
   - `Excel人間確認 (#171)`
   - `vFinal提出URLは#138未確定`
   - `pre-vFinal >=20セッションbaselineとの正式比較が必要`
   - `baseline不足の免除ではPASS不可`
   - `docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md`
4. Preserve the TPISA `.xlsm` VBA project.
5. Do not copy workbook answer values into docs, issues, PR text, logs, or
   command output.

## Current PASS-Mode Dry Run

The current PASS-mode workbook guard intentionally fails. This is expected
until #171 is finalized.

Sanitized failure summary, with no workbook answer values copied:

- Data Protection workbook:
  - overall `vFinal提出DOD照合` status is still not `PASS`;
  - B7 still contains `BLOCKED`;
  - one mapped blocker marker remains at `Sheet1!E24`;
  - workbook-wide blocked-mode markers still remain.
- TPISA workbook:
  - overall `vFinal提出DOD照合` status is still not `PASS`;
  - B7 still contains `BLOCKED`;
  - workbook-wide blocked-mode markers still remain;
  - no mapped blocker-marker cell is currently reported.

This dry run is not a request to overclaim the workbooks. It is the checklist
for the workbook owner after the mapped cells are confirmed or rewritten.

## Required Verification

Run the workbook PASS guard:

```bash
corepack pnpm grok:vfinal-workbook-human-confirmations -- --expect=pass \
  --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" \
  --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

Then run the final DoD PASS guard:

```bash
corepack pnpm grok:vfinal-submission-dod-status -- --expect=pass \
  --check-github-issues \
  --allow-open-approved-issues \
  --approval-author=iwase-cpu \
  --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" \
  --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

## #171 Approval Comment

After the two workbooks are finalized and PASS-mode workbook guard succeeds,
post this approval text to issue #171:

```text
Approved: all cells listed in docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md have been human-confirmed or rewritten to explicit unresolved/not-applicable answers.
Adecco_データ保護アンケート_v01_回答ドラフト.xlsx checked.
Adecco_TPISAアンケート_v01_回答ドラフト.xlsm checked.
vFinal提出DOD照合 overall status: PASS.
blocked-mode markers removed.
the questionnaire drafts may be treated as final submission artifacts.
```

Do not post raw workbook answers with the approval.

## Current Stop Rule

Until the PASS-mode workbook guard succeeds, keep:

- `docs/security/adecco-ai-roleplay-final-security-closeout.md` as
  `Customer submission DoD: BLOCKED`.
- The source workbooks' overall status as `BLOCKED`.
- Issue #171 open.
- Issue #128 open.
