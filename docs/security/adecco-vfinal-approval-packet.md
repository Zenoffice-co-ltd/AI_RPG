# Adecco vFinal Approval Packet

Status as of 2026-05-17 JST: **approval required before customer submission**.

This packet is for the human/customer decision maker who can close the remaining
approval-sensitive vFinal DoD items. It does not change the closeout verdict.
`docs/security/adecco-ai-roleplay-final-security-closeout.md` must remain
BLOCKED until the required approvals or fresh evidence are recorded.

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

Approve one:

```text
Approved: the dedicated hosted.app URL is acceptable as the vFinal customer
submitted URL.
```

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

Approve one:

```text
Approved: accept the current-vFinal 20-session latency sample as scoped evidence
and waive the missing strict pre-vFinal baseline for this submission.
```

or

```text
Do not submit yet. Approve a controlled rollback or separate same-environment
baseline deployment to collect >=20 pre-vFinal sessions with the same sampler
and compare p95 metrics before final submission.
```

### #141 `verify:acceptance`

Current state:

- `verify:acceptance -- --preflight` is ready when required vendor secrets are
  resolved into process-local environment variables.
- Full `verify:acceptance` is blocked at the legacy
  `staffing_order_hearing_busy_manager_medium` ElevenLabs ConvAI judge step.
- Latest rerun included `no-hidden-fact-leak` plus `no-coaching` on retry 1,
  then `no-coaching` on retries 2 and 3. Codex is not applying the
  no-coaching-only exception autonomously.

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

## After Approval

After approvals or fresh evidence are recorded:

1. Update issues #138, #139, #140, and #141 with the approval or evidence.
2. Update `docs/security/adecco-ai-roleplay-final-security-closeout.md`.
3. Update `docs/security/adecco-vfinal-customer-submission-dod-audit.md`.
4. Update questionnaire workbooks and
   `docs/security/adecco-vfinal-questionnaire-submission-map.md`.
5. Run:

```bash
git diff --check
corepack pnpm grok:vfinal-security-invariants
```

6. Create the final closeout PR and set the final verdict to
   `Customer submission DoD: PASS` only if all remaining blockers are closed or
   explicitly approved out of scope.

