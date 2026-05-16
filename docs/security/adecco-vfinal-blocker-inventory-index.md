# Adecco vFinal Blocker Inventory Index

Status as of 2026-05-17 JST: **all blocker inventories still require resolution or approval**.

This index is the human-facing table of the approval/evidence-sensitive items
that still block customer submission DoD and security-checksheet submission
DoD. It does not replace the individual inventory files or the GitHub issues;
it makes the finalization checklist easier to audit.
The shortest operator-facing action checklist is
`docs/security/adecco-vfinal-human-unblock-checklist.md`.

Umbrella tracker: #128 remains OPEN while any row below is unresolved. The
final PASS guard requires #128 to be CLOSED in addition to the blocker rows
being closed or formally approved.

| Issue | Blocker | Inventory / assessment | Current index verdict |
|---|---|---|---|
| #138 | Submitted URL approval or dedicated custom-domain mapping | `docs/security/adecco-vfinal-submitted-url-decision-inventory.md` | BLOCKED: hosted.app is live but not formally approved; dedicated `mendan.biz` candidates lack verified DNS mapping. |
| #139 | Legacy shared App Hosting `XAI_API_KEY` scope | `docs/security/adecco-vfinal-legacy-xai-scope-inventory.md` | BLOCKED: submitted vFinal runtime is no-key, but legacy shared `/api/v3` session/TTS paths still require explicit scope approval or migration/de-scope. |
| #140 | Strict pre-vFinal latency baseline comparison | `docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md` | BLOCKED: current-vFinal 20-session sample exists, but no approved strict pre-vFinal >=20-session baseline is available. |
| #141 | Canonical `verify:acceptance` closure | `docs/security/adecco-vfinal-acceptance-blocker-inventory.md` | BLOCKED: latest executable full run failed legacy ConvAI judge paths beyond the no-coaching-only exception; current-shell preflight lacks Secret Manager access. |
| #171 | Workbook human confirmations | `docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md` | BLOCKED: final questionnaire cells still require human/legal/operator confirmation or explicit unresolved/not-applicable wording. |

## Latest Continuation Recheck

2026-05-17 JST recheck after PR #209:

- #138 was found CLOSED during post-merge guard verification, but the issue
  comments did not include the required exact hosted.app submitted-URL approval
  with submitted-URL smoke evidence, and no dedicated `mendan.biz` active
  DNS/certificate + submitted-URL smoke evidence was present. #138 was
  reopened. Issue closure alone is not approval evidence.
- `corepack pnpm grok:vfinal-submission-dod-status -- --expect=blocked
  --check-github-issues --allow-open-approved-issues
  --approval-author=iwase-cpu --workbook=<data-protection workbook>
  --workbook=<TPISA workbook>` passed again after #138 was reopened, listing
  #128, #138, #139, #140, #141, and #171 as blockers.
- PR #209 tightened #140 comparison evidence so `corepack pnpm
  grok:first-vfinal:latency-compare` now requires both baseline/current
  artifact identity markers in addition to the existing denominator,
  fail-count, p95 threshold, closeCode1006, `relay.error`, and same-artifact
  checks. This does not create or approve the missing pre-vFinal baseline.

2026-05-17 JST recheck after PR #188 and PR #189:

- #128, #138, #139, #140, #141, and #171 are still OPEN.
- Fresh #139 docs/IAM/config recheck confirmed the relevant Secret Manager and
  App Hosting official docs were rechecked on 2026-05-17. The dedicated
  submitted vFinal App Hosting service account is still absent from the
  `XAI_API_KEY` IAM policy, while the legacy shared App Hosting compute service
  account still has `secretAccessor`. Shared `apps/web/apphosting.yaml` still
  binds `XAI_API_KEY`; `apps/web/apphosting.vfinal.yaml` still omits it.
  Although shared deterministic-only config reduces some legacy usage, the
  shared `/api/v3` production assertion still requires the key when Grok Voice
  roleplay is enabled. #139 remains blocked pending explicit scope approval or
  route migration/de-scope plus IAM removal and regression evidence.
- Fresh #141 permission/input recheck found the active gcloud account
  `iwase@zenoffice.co.jp` on project `zapier-transfer`, with no process-local
  `FIREBASE_PROJECT_ID`, `SECRET_SOURCE_PROJECT_ID`, `QUEUE_SHARED_SECRET`,
  `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `LIVEAVATAR_API_KEY`, or
  `FIREBASE_CREDENTIALS_SECRET_NAME`. The current shell still fails
  `verify:acceptance -- --preflight` before product checks on Secret Manager
  `secretmanager.versions.access`, so #141 remains blocked until the required
  inputs/permissions or formal approval are supplied.
- Fresh #171 source workbook recheck found both `vFinal提出DOD照合` first
  sheets still in `BLOCKED` mode with `Excel人間確認 (#171) BLOCKED`.
  All mapped #171 cells were non-empty, but confirmation/unresolved markers
  remain in 17/25 data-protection cells and 19/34 expanded TPISA cells. This
  keeps #171 blocked pending human confirmation or explicit unresolved /
  not-applicable wording.
- Fresh #138 hosted.app submitted URL start smoke passed at 2026-05-17
  04:29 JST: session 200, `wsUrl`
  `wss://voice.mendan.biz/api/v3/realtime-relay`, browser WebSocket URL only
  the relay WSS, direct `api.x.ai` count 0, and forbidden session keys absent.
  Dedicated `mendan.biz` candidates still did not resolve in this environment,
  and `curl -I` failed with host resolution error for both checked candidates.
  This supports the hosted.app approval path but does not itself approve #138.
- PR #188 tightened #138 approval matching. A hosted.app approval is no longer
  accepted with the URL alone; both hosted.app and dedicated custom-domain
  paths must include submitted-URL smoke evidence: invite consume 307,
  session 200, `wsUrl`
  `wss://voice.mendan.biz/api/v3/realtime-relay`, direct `api.x.ai` count 0,
  and forbidden session keys absent. The custom-domain path also still requires
  active DNS/certificate status and must not use the legacy shared
  `roleplay.mendan.biz` domain.
- PR #189 refreshed #139 IAM evidence without reading secret values. The
  dedicated submitted vFinal service account remains absent from the
  `XAI_API_KEY` IAM policy, while the legacy shared App Hosting compute service
  account and Cloud Run relay service account still have access. #139 remains
  BLOCKED pending explicit scope approval or migration/de-scope plus IAM
  removal and regression evidence.
- PR #189 also refreshed #141 current-shell evidence. `corepack pnpm
  verify:acceptance -- --preflight` still stops before product checks on Secret
  Manager `secretmanager.versions.access` in this shell. #141 remains BLOCKED
  pending clean full `verify:acceptance` PASS, explicit legacy blocker
  approval using the stricter wording, or legacy judge path re-scope/fix.
- Fresh #140 local artifact rescan found four
  `out/grok_first_vfinal_latency/*/summary.json` files. Two were 20/20 pass
  current-vFinal samples, and two had denominators below 20. None was a
  pre-vFinal same-environment, same-scenario, >=20-session baseline. #140
  remains BLOCKED pending approved baseline evidence and a passing comparison.
- The Excel source workbooks still report `vFinal提出DOD照合` overall status
  `BLOCKED`.

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
questionnaire workbooks. Issue-state checking verifies umbrella #128 plus
blockers #138, #139, #140, #141, and #171:

```bash
corepack pnpm grok:vfinal-submission-dod-status -- --expect=pass \
  --check-github-issues \
  --allow-open-approved-issues \
  --approval-author=<approver-github-login> \
  --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" \
  --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

If any open issue is resolved by approval text instead of closure,
`--approval-author=<approver-github-login>` or
`VFINAL_SUBMISSION_DOD_APPROVAL_AUTHORS` is required.
For #138, approval text must include the exact submitted URL and submitted-URL
smoke evidence: invite consume 307, session 200, `wsUrl`
`wss://voice.mendan.biz/api/v3/realtime-relay`, direct `api.x.ai` count 0, and
forbidden session keys absent. Dedicated custom-domain approval also requires
active DNS/certificate status and cannot use `roleplay.mendan.biz`.
For #139, approval text must name the submitted vFinal service account and the
legacy shared App Hosting service account so the scope boundary is explicit.
For #140, approval text must cite a same-environment, same-scenario,
>=20-session pre-vFinal baseline, p95 threshold comparison, closeCode1006 /
relay.error comparison, `corepack pnpm grok:first-vfinal:latency-compare` PASS,
a comparison summary artifact, and `Comparison result: PASS`.
For #171, approval text must name both source questionnaire workbooks, confirm
the `vFinal提出DOD照合` overall status is PASS, and state that blocked-mode
markers were removed.
For #141, approval text must identify
`staffing_order_hearing_busy_manager_medium`, acknowledge the latest full
rerun included `no-coaching`, `role-adherence`, and `no-hidden-fact-leak` so
the no-coaching-only exception is not being applied, and state that no vFinal
session, relay, WAF, logging, or no-key runtime regression is indicated.

While any row remains BLOCKED, PR titles and bodies should avoid GitHub
auto-closing phrases such as `close #128`, `fix #141`, or `resolve #138`.
Use `remains BLOCKED`, `pending`, or `tracks` wording for evidence-refresh and
guard-hardening PRs. Only the final PASS closeout PR should close blocker
issues, and only after the final PASS guard has succeeded.
