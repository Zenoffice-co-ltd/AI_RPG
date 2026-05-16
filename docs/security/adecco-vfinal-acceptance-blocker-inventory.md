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

2026-05-17 04:44 JST permission/input recheck:

- Active gcloud account: `iwase@zenoffice.co.jp`.
- Active gcloud project: `zapier-transfer`.
- Process-local values were absent for `FIREBASE_PROJECT_ID`,
  `SECRET_SOURCE_PROJECT_ID`, `QUEUE_SHARED_SECRET`, `OPENAI_API_KEY`,
  `ELEVENLABS_API_KEY`, `LIVEAVATAR_API_KEY`, and
  `FIREBASE_CREDENTIALS_SECRET_NAME`.
- `corepack pnpm verify:acceptance -- --preflight` still failed before product
  checks on Secret Manager `secretmanager.versions.access`.
- No secret values were read, printed, persisted, or copied into docs.

2026-05-17 05:31 JST permission/input recheck:

- Active gcloud account: `iwase@zenoffice.co.jp`.
- Active gcloud project: `zapier-transfer`.
- Process-local values were absent for the checked acceptance/runtime inputs:
  `FIREBASE_PROJECT_ID`, `SECRET_SOURCE_PROJECT_ID`, `QUEUE_SHARED_SECRET`,
  `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `LIVEAVATAR_API_KEY`,
  `FIREBASE_CREDENTIALS_SECRET_NAME`, `DEFAULT_ELEVEN_VOICE_ID`,
  `DEMO_ACCESS_TOKEN`, `XAI_API_KEY`, and `XAI_RELAY_TICKET_SECRET`.
- `corepack pnpm verify:acceptance -- --preflight` still failed before product
  checks on Secret Manager `secretmanager.versions.access`.
- No secret values were read, printed, persisted, or copied into docs.

2026-05-17 06:17 JST no-secret input inventory:

- Added and ran:
  `corepack pnpm grok:vfinal-acceptance-input-inventory -- --expect=blocked`.
- The inventory checks process environment and `apps/web/.env.local` key
  presence only. It does not read Secret Manager payloads and does not prove
  `verify:acceptance` PASS.
- Result: PASS for expected BLOCKED. `apps/web/.env.local` was absent in this
  worktree. Active gcloud account was `iwase@zenoffice.co.jp`; active gcloud
  project was `zapier-transfer`.
- Missing direct inputs without Secret Manager were `FIREBASE_PROJECT_ID`,
  `SECRET_SOURCE_PROJECT_ID`, and `QUEUE_SHARED_SECRET`.
- Missing Secret Manager fallback env overrides in this shell were
  `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `LIVEAVATAR_API_KEY`,
  `DEMO_ACCESS_TOKEN`, `XAI_API_KEY`, and `XAI_RELAY_TICKET_SECRET`.
- Missing context/default inputs were `FIREBASE_CREDENTIALS_SECRET_NAME` and
  `DEFAULT_ELEVEN_VOICE_ID`.
- A fresh `corepack pnpm verify:acceptance -- --preflight` attempt still failed
  before product checks with Secret Manager `secretmanager.versions.access`
  permission denied. No secret values were read, printed, persisted, or copied
  into docs.

2026-05-17 06:34 JST issue-state recheck:

- #141 had been closed, but no clean full `corepack pnpm verify:acceptance`
  PASS was recorded and no comment contained the stricter explicit legacy
  blocker approval required for vFinal submission scope.
- The latest executable full-run evidence still shows legacy
  `staffing_order_hearing_busy_manager_medium` ConvAI judge failures beyond
  the no-coaching-only exception, and the current shell still lacks a clean
  preflight because of Secret Manager `secretmanager.versions.access`.
- #141 was reopened to avoid treating issue closure as clean acceptance PASS
  or approval. The valid resolution paths below remain unchanged.

2026-05-17 07:48 JST current-shell preflight recheck:

- `corepack pnpm grok:vfinal-acceptance-input-inventory -- --expect=blocked`
  passed for expected BLOCKED. The helper checks only process environment and
  `apps/web/.env.local` key presence; it does not read Secret Manager payloads.
- `apps/web/.env.local` was absent. Active gcloud account was
  `iwase@zenoffice.co.jp`; active gcloud project was `zapier-transfer`.
- Missing direct inputs without Secret Manager were `FIREBASE_PROJECT_ID`,
  `SECRET_SOURCE_PROJECT_ID`, and `QUEUE_SHARED_SECRET`.
- Missing process/env-local overrides for Secret Manager fallback keys were
  `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `LIVEAVATAR_API_KEY`,
  `DEMO_ACCESS_TOKEN`, `XAI_API_KEY`, and `XAI_RELAY_TICKET_SECRET`.
- Missing context/default inputs were `FIREBASE_CREDENTIALS_SECRET_NAME` and
  `DEFAULT_ELEVEN_VOICE_ID`.
- A fresh `corepack pnpm verify:acceptance -- --preflight` attempt still failed
  before product checks with Secret Manager `secretmanager.versions.access`
  permission denied.
- No secret values were read, printed, persisted, or copied into docs. This
  current-shell blocker does not supersede the earlier executable full-run
  evidence that reached the legacy ConvAI judge path; #141 still requires a
  clean full PASS, explicit legacy blocker approval, or legacy judge
  fix/re-scope.

This means a fresh clean rerun still requires one of:

- process-local vendor secrets and project inputs supplied without printing or
  persisting values; or
- an execution identity with the required Secret Manager access.

Minimum restart input for the current shell:

- Provide process-local `FIREBASE_PROJECT_ID`, `SECRET_SOURCE_PROJECT_ID`, and
  `QUEUE_SHARED_SECRET`, plus vendor keys in process-local env; or
- Grant the execution identity enough Secret Manager `versions.access` to
  resolve the canonical vendor key secrets in the configured
  `SECRET_SOURCE_PROJECT_ID` and provide the remaining direct inputs that are
  not Secret Manager fallbacks.
- The acceptance preflight also requires a valid Firebase/Admin execution
  context for Firestore and Cloud Tasks. If ADC is not sufficient, provide a
  process-local `FIREBASE_CREDENTIALS_SECRET_NAME` that points to an approved
  Firebase Admin credential secret.

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
