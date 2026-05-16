# Adecco vFinal Acceptance Blocker Inventory

Status as of 2026-05-17 JST: **acceptance PASS or explicit legacy blocker approval still required**.

This note supports issue #141. It does not change the customer submission DoD
verdict. Current evidence shows vFinal runtime/security controls passed their
targeted gates, but the canonical full `verify:acceptance` gate is not clean
PASS and cannot be treated as complete without either a clean rerun or explicit
approval of the legacy ConvAI judge blocker.

## Current Gate State

Canonical command:

```text
corepack pnpm verify:acceptance
```

Observed state:

- A 2026-05-17 00:44 JST full rerun was executable when required values were
  resolved into process-local environment variables from Secret Manager.
  Secret values were not printed or persisted.
- That full rerun reached `[3/10] publish scenario` and failed after three
  ElevenLabs ConvAI judge attempts on the legacy
  `staffing_order_hearing_busy_manager_medium` path.
- The latest full rerun failure was not limited to the historical
  `no-coaching`-only exception: retries also included `role-adherence` and
  `no-hidden-fact-leak`.
- No vFinal session, relay, WAF, metadata logging, no-key runtime, browser
  WebSocket, direct `api.x.ai`, or sensitive-log regression was indicated by
  that acceptance failure.

## Current Shell Rerun Blocker

Fresh preflight attempt:

```text
corepack pnpm verify:acceptance -- --preflight
```

Latest current-shell result:

```text
[vendor_failure] 7 PERMISSION_DENIED: Permission 'secretmanager.versions.access'
denied on resource (or it may not exist).
```

2026-05-17 04:20 JST recheck:

- `corepack pnpm verify:acceptance -- --preflight` still failed before product
  checks with the same Secret Manager `secretmanager.versions.access`
  permission denial.
- Secret values were not printed or persisted.

This means a fresh clean rerun still requires one of:

- process-local vendor secrets and project inputs supplied without printing or
  persisting values; or
- an execution identity with the required Secret Manager access.

This current-shell Secret Manager blocker does not replace the earlier full-run
legacy ConvAI judge evidence. It only prevents Codex from obtaining a fresh
clean `verify:acceptance` result in the current environment.

## Why The Existing Exception Is Not Applied

The repository has a historical exception for a legacy
`staffing_order_hearing_busy_manager_medium::no-coaching` judge mismatch under
specific conditions. Codex is not applying that exception to the latest vFinal
submission closeout because the latest full rerun also failed
`role-adherence` and `no-hidden-fact-leak` on the legacy path.

## Valid Resolution Paths

Issue #141 remains blocked until one of these is true:

1. A clean full `corepack pnpm verify:acceptance` run passes.
2. A customer/operator explicitly approves that the current legacy ConvAI judge
   blocker is outside the vFinal submitted runtime/security scope. The approval
   must explicitly acknowledge that the latest full rerun included
   `no-coaching`, `role-adherence`, and `no-hidden-fact-leak`, so the
   no-coaching-only exception is not being applied.
3. The legacy ConvAI judge path is fixed or re-scoped, then the canonical gate
   is rerun and passes.

Until then, the customer submission DoD and security-checksheet submission DoD
must remain BLOCKED for #141.
