# Adecco vFinal Human Unblock Checklist

Status as of 2026-05-17 JST: **human/operator action required**.

This checklist is the shortest safe path from the current BLOCKED state to a
final customer/security-checksheet submission decision. It does not replace the
approval packet or the individual inventories; it points to the exact evidence
or approval needed next.

Authoritative detail:

- Approval wording: `docs/security/adecco-vfinal-approval-packet.md`
- Blocker inventory: `docs/security/adecco-vfinal-blocker-inventory-index.md`
- Requirement audit:
  `docs/security/adecco-vfinal-customer-submission-dod-audit.md`
- Final closeout:
  `docs/security/adecco-ai-roleplay-final-security-closeout.md`

## Current Blockers

| Issue | Who must act | Required action | Evidence that unblocks |
|---|---|---|---|
| #138 | Customer/operator | Approve hosted.app as the submitted URL, or map an active dedicated vFinal `mendan.biz` custom domain. | Approval comment with exact submitted URL and submitted-URL smoke evidence, or active DNS/certificate plus smoke for the dedicated custom domain. |
| #139 | Customer/operator or infrastructure owner | Approve the dedicated no-key backend as the vFinal submitted scope, or migrate/de-scope shared `/api/v3` direct xAI paths and remove shared App Hosting `XAI_API_KEY` access. | Approval comment naming both service accounts, or IAM removal proof plus vFinal and retained v50/v3 non-regression evidence. |
| #140 | Operator/release owner | Provide an approved same-environment, same-scenario, >=20-session pre-vFinal baseline or approve a baseline collection window. | `corepack pnpm grok:first-vfinal:latency-compare` PASS with baseline/current artifacts and closeCode1006 / relay.error counters. |
| #141 | Operator/release owner | Provide required process-local inputs/Secret Manager access and obtain clean `verify:acceptance` PASS, or approve the legacy ConvAI blocker as outside vFinal submitted runtime/security scope. | Clean full command PASS, or approval text acknowledging `no-coaching`, `role-adherence`, and `no-hidden-fact-leak` on `staffing_order_hearing_busy_manager_medium` and no vFinal runtime/security regression. |
| #171 | Human/legal/operator | Confirm or rewrite the mapped questionnaire cells. | Both source workbooks changed to `vFinal提出DOD照合` overall PASS, blocked-mode markers removed, and approval/closure for the mapped cells. |

## Safe Order

1. Decide #138 and #139 first so the submitted runtime and URL scope are fixed.
2. Resolve #140 with a real baseline comparison. Do not promote current-vFinal
   latency alone to PASS.
3. Resolve #141 with either a clean full acceptance run or explicit legacy
   blocker approval.
4. Resolve #171 after the final security-checksheet wording is aligned with the
   approved scope decisions.
5. Close or formally approve #138, #139, #140, #141, and #171, then close #128.
6. Run the final PASS guard with both source workbooks:

```bash
corepack pnpm grok:vfinal-submission-dod-status -- --expect=pass \
  --check-github-issues \
  --allow-open-approved-issues \
  --approval-author=<approver-github-login> \
  --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" \
  --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

`--approval-author` is required only when any blocker issue remains OPEN and is
resolved by approval comment instead of closure.
PASS mode also validates concrete evidence markers in the blocker inventories,
including submitted-URL smoke, service-account / key scope evidence, #140
latency comparison output with closeCode1006 / `relay.error`, acceptance
evidence, and workbook artifact markers. Top-level `PASS` wording alone is not
accepted as final evidence.

For a read-only #138 hosted.app/custom-domain candidate precheck, run:

```bash
corepack pnpm grok:vfinal-submitted-url-candidates -- --expect=blocked
```

For a repo-local #139 code/config scope precheck that does not read Secret
Manager payloads or mutate IAM, run:

```bash
corepack pnpm grok:vfinal-legacy-xai-scope -- --expect=blocked
```

For a no-secret #141 current-shell input inventory before attempting
`verify:acceptance`, run:

```bash
corepack pnpm grok:vfinal-acceptance-input-inventory -- --expect=blocked
```

This reports only key presence in process env and `apps/web/.env.local`, plus
active gcloud account/project. It does not read Secret Manager payloads and is
not a replacement for a clean `corepack pnpm verify:acceptance` run or explicit
legacy blocker approval.

For a count-only #171 precheck that does not copy workbook answer values into
docs or issue comments, run:

```bash
corepack pnpm grok:vfinal-workbook-human-confirmations -- --expect=blocked \
  --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" \
  --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

Before closing #171 or promoting the workbooks to final submission artifacts,
run the same helper in final PASS mode:

```bash
corepack pnpm grok:vfinal-workbook-human-confirmations -- --expect=pass \
  --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" \
  --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

PASS mode requires the `vFinal提出DOD照合` first sheet overall status to be
`PASS`, B3:B7 blocker rows to be clear of `BLOCKED`, all mapped
human-confirmation cells to be non-empty, mapped blocker references to be
removed, blocked-mode workbook markers to be removed, and `.xlsm` VBA content
to remain intact.

For a scoped #140 artifact precheck before choosing or approving a baseline,
run:

```bash
corepack pnpm grok:first-vfinal:latency-artifact-inventory -- --expect=blocked \
  --root out\grok_first_vfinal_latency
```

This inventory guard treats closeCode1006 and `relay.error` counters as part of
comparison readiness. A p95-only artifact is not enough for final #140 PASS.
The final comparison helper also requires artifact identity markers: baseline
input must be identifiable as pre-vFinal/baseline evidence, and current input
must be identifiable as current vFinal evidence.

## Current Codex Stop Conditions

Codex must not change the final verdict to PASS until the checks above are
done. The current environment still has these blockers:

- #138: hosted.app evidence exists, but the submitted URL is not formally
  approved and no dedicated `mendan.biz` mapping is active in this environment.
- #139: the dedicated submitted vFinal runtime is no-key, but legacy shared App
  Hosting still has `XAI_API_KEY` access and needs scope approval or migration.
- #140: cross-worktree search found no valid pre-vFinal baseline artifact.
- #141: current shell lacks required process-local inputs and Secret Manager
  access for a fresh clean rerun; earlier full run failed legacy ConvAI judge
  paths beyond the no-coaching-only exception.
- #171: workbook mapped cells still require human confirmation or explicit
  unresolved/not-applicable wording.

Until those are resolved or approved, customer submission DoD and
security-checksheet submission DoD remain BLOCKED.
