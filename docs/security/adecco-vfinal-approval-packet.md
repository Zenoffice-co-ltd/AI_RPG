# Adecco vFinal Approval Packet

Status as of 2026-05-17 JST: **approval required before customer submission**.

This packet is for the human/customer decision maker who can close the remaining
approval-sensitive vFinal DoD items. It does not change the closeout verdict.
`docs/security/adecco-ai-roleplay-final-security-closeout.md` must remain
BLOCKED until the required approvals or fresh evidence are recorded.
The consolidated inventory index for #138-#141 plus workbook issue #171 is
`docs/security/adecco-vfinal-blocker-inventory-index.md`.
Workbook cells that still require human/legal/operator confirmation are tracked
in `docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md`.
Umbrella issue #128 stays open while any required decision below is unresolved;
the final PASS guard requires #128 to be closed after finalization.

## Current Safe Submission Claim

The following claim is supported by current evidence:

> The dedicated vFinal App Hosting backend `adecco-roleplay-vfinal` is separated
> from the legacy comparison backend, does not bind or access `XAI_API_KEY`, and
> routes browser realtime traffic only to the Cloud Run relay
> `wss://voice.mendan.biz/api/v3/realtime-relay`. Current production evidence
> shows session 200, forbidden session keys absent, browser direct `api.x.ai`
> count 0, relay phases present, metadata-only log retention >=180 days,
> sensitive scan 0 for required markers, Cloud Armor preview/log on the relay
> LB, ZAP baseline/passive FAIL=0, and live text/voice E2E PASS.

The following claim is **not** yet supported:

> Customer submission DoD: PASS.

## Required Decisions

### #138 Submitted URL

Current state:

- Dedicated hosted.app URL is live and returns HTTP 200:
  `https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-vFinal`
- `roleplay-vfinal.mendan.biz` and `adecco-roleplay.mendan.biz` had no DNS
  resolver result in the latest read-only check.
- The submitted URL decision inventory is tracked in
  `docs/security/adecco-vfinal-submitted-url-decision-inventory.md`.

Approve one:

```text
Approved: the dedicated hosted.app URL is acceptable as the vFinal customer
submitted URL.
Submitted URL: https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-vFinal
```

or

```text
Approved: the dedicated vFinal mendan.biz custom domain is active as the vFinal customer
submitted URL.
Submitted URL: https://<dedicated-vFinal-mendan.biz>/demo/adecco-roleplay-vFinal
DNS/certificate status is active.
Submitted-URL smoke passed with session 200, relay WSS only, direct api.x.ai count 0,
and forbidden session keys absent.
```

The custom-domain approval path must name a dedicated vFinal domain mapped to
`adecco-roleplay-vfinal`. The legacy shared comparison domain
`roleplay.mendan.biz` is not a valid submitted vFinal URL for this approval
path.

or

```text
Do not submit yet. Map a dedicated vFinal mendan.biz custom domain to the
adecco-roleplay-vfinal backend, wait for DNS/certificate active status, then
rerun the submitted-URL smoke.
```

### #139 Legacy Shared App Hosting `XAI_API_KEY` Scope

Current state:

- Dedicated vFinal service account is not present on the `XAI_API_KEY` IAM
  policy.
- Cloud Run relay service account has `XAI_API_KEY` access, as expected.
- Legacy shared App Hosting service account still has `XAI_API_KEY` access for
  non-submitted legacy/direct/internal comparison routes.
- The legacy shared runtime dependency inventory is tracked in
  `docs/security/adecco-vfinal-legacy-xai-scope-inventory.md`.

Approve one:

```text
Approved: the vFinal customer-submitted runtime scope is limited to the
dedicated no-key App Hosting backend adecco-roleplay-vfinal and its submitted
URL. Legacy shared App Hosting routes and their XAI_API_KEY access are internal
comparison/continuity infrastructure and are out of scope for the vFinal
customer submission.
```

or

```text
Do not submit yet. Migrate, decommission, or formally de-scope the legacy/direct
xAI routes, remove the shared App Hosting service account from XAI_API_KEY
secret access, and rerun v50-family comparison non-regression plus vFinal
smoke.
```

### #140 Latency Baseline

Current state:

- Current-vFinal 20-session voice sample passed with closeCode1006=0 and
  relay.error=0 in the sample window.
- No existing artifact was found that satisfies the strict same-environment,
  same-scenario, >=20-session pre-vFinal baseline requirement with the required
  metrics.
- Local artifact candidates are assessed in
  `docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md`.

Approve one:

```text
Approved: use the following pre-vFinal latency baseline for the vFinal customer submission comparison.
Baseline source: <specific artifact, deployment, or approved measurement source>.
pre-vFinal sessions >=20.
sessionApiMs p95: baseline <ms>, current <ms>, threshold baseline+50ms, result <PASS|FAIL>.
firstAudioDeltaMs p95: baseline <ms>, current <ms>, threshold baseline+100ms, result <PASS|FAIL>.
firstAudibleAudioMs p95: baseline <ms>, current <ms>, threshold baseline+100ms, result <PASS|FAIL>.
closeCode1006 increase: <none|details>.
relay.error increase: <none|details>.
Comparison guard: corepack pnpm grok:first-vfinal:latency-compare PASS.
Comparison summary: <comparison-summary.json path or URL>.
Comparison result: PASS.
```

When a baseline source is approved, run the comparison guard and attach or cite
its output:

```bash
corepack pnpm grok:first-vfinal:latency-compare -- --baseline <pre-vFinal-summary.json> --current out/grok_first_vfinal_latency/2026-05-16T14-32-01-504Z/summary.json --baseline-close-code1006 <count> --current-close-code1006 <count> --baseline-relay-error <count> --current-relay-error <count> --out <comparison-summary.json>
```

The guard fails if the baseline/current summary paths are identical, if either
side has fewer than 20 runs, if any run failed, or if the required operational
counters are missing.
If #140 is resolved by OPEN issue approval instead of issue closure, the
approval comment must cite the comparison guard PASS and the comparison summary
artifact; a p95 table alone is not sufficient.

or

```text
Do not submit yet. Approve a controlled rollback or separate same-environment
baseline deployment to collect >=20 pre-vFinal sessions with the same sampler
and compare p95 metrics before final submission.
```

### #141 `verify:acceptance`

Current state:

- `verify:acceptance -- --preflight` is ready when required vendor secrets are
  resolved into process-local environment variables. A 2026-05-17 00:44 JST
  rerun used process-local Secret Manager values without printing or persisting
  them. A later current-shell preflight without process-local env values still
  stops on Secret Manager `secretmanager.versions.access` permission denied.
- Full `verify:acceptance` is blocked at the legacy
  `staffing_order_hearing_busy_manager_medium` ElevenLabs ConvAI judge step.
- Latest rerun failed `no-coaching` on retry 1, `role-adherence` plus
  `no-coaching` on retry 2, and `no-hidden-fact-leak` plus `no-coaching` on
  retry 3. Codex is not applying the no-coaching-only exception autonomously.
- The acceptance blocker inventory is tracked in
  `docs/security/adecco-vfinal-acceptance-blocker-inventory.md`.

Approve one:

```text
Approved: the current verify:acceptance blocker is a legacy ConvAI vendor judge
blocker outside the vFinal submitted runtime/security scope. It may remain open
outside the customer submission DoD.
```

or

```text
Do not submit yet. Obtain a clean full corepack pnpm verify:acceptance run, or
fix/re-scope the legacy ConvAI judge path until the canonical gate passes.
```

### #171 Workbook Human Confirmations

Current state:

- The two source questionnaire drafts still contain cells whose final answers
  require human/legal/operator confirmation.
- The cell-level map is tracked in
  `docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md`.

Approve one:

```text
Approved: all cells listed in docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md have been human-confirmed or rewritten to explicit unresolved/not-applicable answers, and the questionnaire drafts may be treated as final submission artifacts.
```

or

```text
Do not submit yet. Confirm or rewrite each listed workbook cell, update the
source questionnaire drafts, and rerun the final PASS guard.
```

## After Approval

After approvals or fresh evidence are recorded:

1. Update issues #138, #139, #140, #141, and #171 with the approval or evidence.
2. Update `docs/security/adecco-ai-roleplay-final-security-closeout.md`.
3. Update `docs/security/adecco-vfinal-customer-submission-dod-audit.md`.
4. Update questionnaire workbooks and
   `docs/security/adecco-vfinal-questionnaire-submission-map.md`.
   The source workbooks must not retain BLOCKED-mode markers such as
   `vFinal提出URLは#138未確定`, `Excel人間確認 (#171)`, or
   `baseline不足の免除ではPASS不可` after their overall DoD status is changed
   to PASS.
5. Run:

```bash
git diff --check
corepack pnpm grok:vfinal-security-invariants
corepack pnpm grok:vfinal-submission-dod-status -- --expect=pass \
  --check-github-issues \
  --allow-open-approved-issues \
  --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" \
  --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

PASS mode requires both source questionnaire workbooks above; running the final
guard without them is not valid submission evidence.
PASS mode also requires `--check-github-issues` or
`VFINAL_SUBMISSION_DOD_CHECK_GITHUB_ISSUES=1` so #138, #139, #140, #141, and
#171 are verified closed or approved and umbrella #128 is verified closed.

If any of #138, #139, #140, #141, or #171 remain OPEN and are resolved by approval
comment rather than closure, `--approval-author=<approver-github-login>` or
`VFINAL_SUBMISSION_DOD_APPROVAL_AUTHORS` is required. The guard rejects
approval-based PASS for OPEN blockers unless the expected GitHub approver login
list is supplied before running the final PASS guard.
Approval comments must replace every `<placeholder>` in this packet with a
concrete value. The guard rejects approval comments that still contain unfilled
angle-bracket placeholders.

6. Create the final closeout PR and set the final verdict to
   `Customer submission DoD: PASS` only if all remaining blockers are closed or
   explicitly approved, with #140 backed by a passing pre-vFinal baseline
   comparison rather than a waiver of the missing baseline.
