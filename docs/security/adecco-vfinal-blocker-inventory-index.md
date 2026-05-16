# Adecco vFinal Blocker Inventory Index

Status as of 2026-05-17 JST: **all blocker inventories still require resolution or approval**.

This index is the human-facing table of the approval/evidence-sensitive items
that still block customer submission DoD and security-checksheet submission
DoD. It does not replace the individual inventory files or the GitHub issues;
it makes the finalization checklist easier to audit.

| Issue | Blocker | Inventory / assessment | Current index verdict |
|---|---|---|---|
| #138 | Submitted URL approval or dedicated custom-domain mapping | `docs/security/adecco-vfinal-submitted-url-decision-inventory.md` | BLOCKED: hosted.app is live but not formally approved; dedicated `mendan.biz` candidates lack verified DNS mapping. |
| #139 | Legacy shared App Hosting `XAI_API_KEY` scope | `docs/security/adecco-vfinal-legacy-xai-scope-inventory.md` | BLOCKED: submitted vFinal runtime is no-key, but legacy shared `/api/v3` session/TTS paths still require explicit scope approval or migration/de-scope. |
| #140 | Strict pre-vFinal latency baseline comparison | `docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md` | BLOCKED: current-vFinal 20-session sample exists, but no approved strict pre-vFinal >=20-session baseline is available. |
| #141 | Canonical `verify:acceptance` closure | `docs/security/adecco-vfinal-acceptance-blocker-inventory.md` | BLOCKED: latest executable full run failed legacy ConvAI judge paths beyond the no-coaching-only exception; current-shell preflight lacks Secret Manager access. |
| #171 | Workbook human confirmations | `docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md` | BLOCKED: final questionnaire cells still require human/legal/operator confirmation or explicit unresolved/not-applicable wording. |

## Latest Continuation Recheck

2026-05-17 JST recheck after PR #177:

- #138, #139, #140, #141, and #171 are still OPEN.
- PR #177 added `corepack pnpm grok:first-vfinal:latency-compare` for the
  future #140 baseline comparison. It rejects weak denominator, missing
  closeCode1006 / relay.error counters, threshold failures, failed runs, and
  using the same summary artifact as both baseline and current.
- This tooling does not create, approve, or collect the missing pre-vFinal
  baseline. #140 remains BLOCKED until a same-environment, same-scenario,
  >=20-session baseline is approved or collected and the comparator returns
  PASS.

2026-05-17 JST recheck after PR #169:

- #138, #139, #140, and #141 are still OPEN.
- #171 was opened to track workbook cell-level human confirmations.
- The `Approved:` strings currently present on those issues are approval
  templates in fenced code blocks or blockquotes from the approval packet, not
  accepted approval comments.
- `roleplay-vfinal.mendan.biz` and `adecco-roleplay.mendan.biz` still did not
  resolve in this environment; the dedicated hosted.app candidate returned HTTP
  200.
- `corepack pnpm verify:acceptance -- --preflight` still failed before product
  checks with Secret Manager `secretmanager.versions.access` permission denied
  in this shell. No secret values were printed or persisted.

## Finalization Rule

Before the closeout can say `Customer submission DoD: PASS` and
`Security-checksheet submission DoD: PASS`, every row above must be updated to
one of:

- PASS with evidence from a clean run or completed infrastructure change; or
- Approved out of scope with a linked approval comment from an authorized
  approver.

The final PASS guard must be run with issue-state checking and the two source
questionnaire workbooks:

```bash
corepack pnpm grok:vfinal-submission-dod-status -- --expect=pass \
  --check-github-issues \
  --allow-open-approved-issues \
  --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" \
  --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

If any open issue is resolved by approval text instead of closure,
`--approval-author=<approver-github-login>` or
`VFINAL_SUBMISSION_DOD_APPROVAL_AUTHORS` is required.
