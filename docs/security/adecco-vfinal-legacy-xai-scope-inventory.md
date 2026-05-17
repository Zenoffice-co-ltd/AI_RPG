# Adecco vFinal Legacy XAI Scope Inventory

Status as of 2026-05-17 JST: **APPROVED pending final guard**.

This note supports issue #139. It does not change the customer submission DoD
verdict by itself. The dedicated submitted vFinal runtime remains no-key, and
the legacy shared App Hosting backend `XAI_API_KEY` access has been approved as
out of submitted scope for this vFinal customer submission. Removing that
legacy access remains a separate migration/de-scope decision.

Approval evidence:

- https://github.com/Zenoffice-co-ltd/AI_RPG/issues/139#issuecomment-4468507721

## Official Docs Rechecked

Rechecked on 2026-05-17 before the latest read-only #139 IAM/config review:

- Secret Manager access control with IAM:
  https://cloud.google.com/secret-manager/docs/access-control
  (page redirected to `docs.cloud.google.com`; last updated 2026-05-15 UTC).
  Relevant decision: `roles/secretmanager.secretAccessor` grants
  `secretmanager.versions.access`, while `roles/secretmanager.viewer` is
  metadata-only and does not grant payload access. Least privilege should be
  granted at the lowest practical resource level.
- Firebase App Hosting backend/config/secrets:
  https://firebase.google.com/docs/app-hosting/configure
  (last updated 2026-05-15 UTC). Relevant decision: App Hosting can reference
  Cloud Secret Manager secrets from `apphosting.yaml`, secret values load
  during rollout, and App Hosting backend creation/management is an
  operator/admin-controlled action.

## Submitted vFinal Runtime

The submitted vFinal path is the dedicated App Hosting backend
`adecco-roleplay-vfinal` with service account
`firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com`.

Code/config evidence:

- `apps/web/apphosting.vfinal.yaml` intentionally omits `XAI_API_KEY`.
- `apps/web/app/api/grok-first-vFinal/session/route.ts` creates only the
  vFinal session contract and delegates to
  `apps/web/lib/grok-first-roleplay/vfinal-session.ts`.
- `apps/web/lib/grok-first-roleplay/vfinal-session.ts` requires only
  `XAI_RELAY_TICKET_SECRET` for the signed relay ticket and returns
  `wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay`.
- vFinal realtime upstream access is owned by the Cloud Run relay, not by the
  App Hosting web runtime.

This supports the narrow claim: the submitted vFinal Web/App Hosting runtime
does not require or access `XAI_API_KEY`.

## Legacy Shared Runtime Dependencies

The legacy shared App Hosting backend is still configured for broader internal
comparison/direct Grok Voice routes.

Latest read-only IAM recheck, 2026-05-17 04:20 JST:

- `gcloud secrets get-iam-policy XAI_API_KEY --project=adecco-mendan
  --format=json` succeeded without reading secret values.
- `roles/secretmanager.secretAccessor` still includes
  `serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com`
  and `serviceAccount:xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com`.
- `roles/secretmanager.viewer` still includes
  `serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com`.
- The dedicated submitted vFinal service account
  `serviceAccount:firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com`
  was not present on the `XAI_API_KEY` IAM policy.

2026-05-17 04:50 JST read-only IAM/config recheck:

- `gcloud secrets get-iam-policy XAI_API_KEY --project=adecco-mendan
  --format=json` still showed the legacy shared App Hosting compute service
  account and Cloud Run relay service account under
  `roles/secretmanager.secretAccessor`; it still showed the legacy shared App
  Hosting compute service account under `roles/secretmanager.viewer`.
- The dedicated submitted vFinal service account
  `serviceAccount:firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com`
  was still not present on the `XAI_API_KEY` IAM policy.
- `apps/web/apphosting.yaml` still binds `XAI_API_KEY` for the shared backend.
- `apps/web/apphosting.vfinal.yaml` still omits `XAI_API_KEY` and binds only
  the relay ticket, invite-signing, and participant-hash secrets needed by the
  submitted vFinal web runtime.
- `GROK_VOICE_PRODUCTION_DETERMINISTIC_ONLY=true` in the shared backend lowers
  some legacy runtime TTS/realtime usage, but the shared `/api/v3` environment
  schema and production assertion still require `XAI_API_KEY` whenever Grok
  Voice roleplay is enabled. That means IAM removal remains a migration /
  de-scope decision, not a safe read-only cleanup.

2026-05-17 05:13 JST read-only IAM/config recheck:

- Official docs were rechecked immediately before the IAM review:
  Secret Manager `roles/secretmanager.secretAccessor` grants secret payload
  access through `secretmanager.versions.access`; `roles/secretmanager.viewer`
  is metadata-only. Firebase App Hosting supports `apphosting.yaml` secret
  references backed by Cloud Secret Manager and loads secret values during
  rollout.
- `gcloud secrets get-iam-policy XAI_API_KEY --project=adecco-mendan
  --format=json` again showed the legacy shared App Hosting compute service
  account and Cloud Run relay service account under
  `roles/secretmanager.secretAccessor`, and the legacy shared App Hosting
  compute service account under `roles/secretmanager.viewer`. The dedicated
  submitted vFinal service account was still absent from this policy.
- `gcloud secrets get-iam-policy XAI_API_KEY --project=zapier-transfer
  --format=json` showed only the legacy shared App Hosting compute service
  account under `roles/secretmanager.secretAccessor`; the dedicated submitted
  vFinal service account was absent from this policy too.
- `gcloud secrets get-iam-policy XAI_RELAY_TICKET_SECRET --project=adecco-mendan
  --format=json` showed the shared App Hosting compute service account, the
  dedicated submitted vFinal service account, and the Cloud Run relay service
  account under `roles/secretmanager.secretAccessor`. This matches the relay
  ticket boundary: submitted vFinal web runtime signs relay tickets, while the
  relay validates them. `XAI_RELAY_TICKET_SECRET` was not found in
  `zapier-transfer`.
- `gcloud secrets get-iam-policy GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET
  --project=adecco-mendan --format=json` and
  `gcloud secrets get-iam-policy GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET
  --project=adecco-mendan --format=json` showed both shared and dedicated
  vFinal App Hosting service accounts under `roles/secretmanager.secretAccessor`.
- `gcloud secrets get-iam-policy demo-access-token --project=adecco-mendan
  --format=json` showed only the legacy shared App Hosting compute service
  account under `roles/secretmanager.secretAccessor`. `DEMO_ACCESS_TOKEN` was
  not found because it is the environment variable name; the actual secret
  alias is `demo-access-token`, as documented in `apps/web/apphosting.yaml`.
- `apps/web/apphosting.vfinal.yaml` still omits `XAI_API_KEY` and binds only
  `XAI_RELAY_TICKET_SECRET`,
  `GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET`, and
  `GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET`. The shared
  `apps/web/apphosting.yaml` still binds `XAI_API_KEY`,
  `XAI_RELAY_TICKET_SECRET`, the two vFinal invite/hash secrets, and
  `DEMO_ACCESS_TOKEN` via `demo-access-token`.

2026-05-17 07:12 JST reusable read-only Secret Manager IAM boundary helper:

- Official docs were rechecked immediately before the helper run:
  - `https://cloud.google.com/secret-manager/docs/access-control`
  - `https://firebase.google.com/docs/app-hosting/configure`
- Added `corepack pnpm grok:vfinal-secret-iam-boundary` so #139 can recheck
  the live Secret Manager IAM boundary without reading secret payloads.
- Command:
  `corepack pnpm grok:vfinal-secret-iam-boundary -- --expect=blocked`.
- Result: PASS for expected BLOCKED state.
- Dedicated submitted vFinal service account
  `serviceAccount:firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com`
  still has no `XAI_API_KEY` `secretAccessor` or `viewer` access in
  `adecco-mendan` or the fallback `zapier-transfer` project.
- Cloud Run relay service account
  `serviceAccount:xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com`
  has the required `roles/secretmanager.secretAccessor` access to
  `XAI_API_KEY` and `XAI_RELAY_TICKET_SECRET` in `adecco-mendan`.
- Legacy shared App Hosting service account
  `serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com`
  still has `XAI_API_KEY` access:
  - `roles/secretmanager.secretAccessor` and `roles/secretmanager.viewer` in
    `adecco-mendan`; and
  - `roles/secretmanager.secretAccessor` in `zapier-transfer`.
- This keeps #139 blocked pending explicit out-of-scope approval for the
  legacy shared backend or migration/removal of that legacy access. No IAM
  binding was changed and no secret value was read, printed, persisted, or
  committed.

Code/config evidence:

- 2026-05-17 05:49 JST repo-local guard:
  `corepack pnpm grok:vfinal-legacy-xai-scope -- --expect=blocked` passed for
  expected BLOCKED state. The guard confirmed the submitted vFinal App Hosting
  config, session route, and vFinal session helper omit `XAI_API_KEY`; the
  vFinal session helper still uses `XAI_RELAY_TICKET_SECRET` and
  `wss://voice.mendan.biz/api/v3/realtime-relay`. It also found five legacy
  shared XAI dependency markers: shared `apphosting.yaml` binds `XAI_API_KEY`,
  `server-env.ts` defines it, production env assertion requires it,
  `/api/v3/session` can pass `env.XAI_API_KEY` to the xAI ephemeral-token path,
  and Grok Voice TTS uses `env.XAI_API_KEY`.
- `apps/web/apphosting.yaml` still binds `XAI_API_KEY`.
- `apps/web/lib/roleplay/server-env.ts` defines `XAI_API_KEY` in the Grok Voice
  server env schema and `assertGrokVoiceEnvForProduction()` requires it when
  Grok Voice roleplay is enabled.
- `apps/web/app/api/v3/session/route.ts` can issue an xAI realtime ephemeral
  token with `env.XAI_API_KEY` when a legacy non-relay transport path is used.
- `apps/web/app/api/v3/greet/route.ts`,
  `apps/web/app/api/v3/locked-response-tts/route.ts`, and
  `apps/web/app/api/v3/sanitized-response-tts/route.ts` call the Grok Voice
  TTS path when runtime TTS/cache-miss behavior is allowed.
- `apps/web/server/grokVoice/tts.ts` calls `https://api.x.ai/v1/tts` with
  `env.XAI_API_KEY`.

Scripts and local harnesses also mention `XAI_API_KEY`, but they are operator
tools and do not justify App Hosting runtime secret access by themselves.

Read-only code/config precheck:

```bash
corepack pnpm grok:vfinal-legacy-xai-scope -- --expect=blocked
```

## Removal Risk

Removing the legacy shared App Hosting service account from `XAI_API_KEY`
before a migration/de-scope decision can cause:

- `/api/v3/session` legacy/direct non-relay paths to fail while issuing xAI
  realtime ephemeral auth;
- `/api/v3/greet`, `/api/v3/locked-response-tts`, or
  `/api/v3/sanitized-response-tts` to fail on cache miss or allowed runtime TTS;
- internal comparison/demo routes that still depend on `/api/v3/*` Grok Voice
  behavior to return 503/502;
- false confidence in the security checklist if the submitted vFinal runtime
  and legacy comparison runtime are not explicitly separated in scope.

## Valid Resolution Paths

Issue #139 is approved until one of these is true:

1. A customer/operator explicitly approves that the vFinal submitted runtime
   scope is limited to the dedicated no-key backend and submitted URL, with
   legacy shared App Hosting routes and their `XAI_API_KEY` access treated as
   internal comparison/continuity infrastructure outside the vFinal submission.
2. The legacy/direct Grok Voice routes are migrated, decommissioned, or
   formally de-scoped so the shared App Hosting service account no longer needs
   `XAI_API_KEY`; then the IAM binding is removed and v50/v3 comparison
   non-regression plus vFinal smoke are rerun.

The migration/removal path must include, at minimum:

- an operator-approved route inventory for shared `/api/v3/*` and any
  v50/v3 comparison routes that still use the shared App Hosting backend;
- confirmation that direct xAI ephemeral-token and runtime-TTS/cache-miss paths
  are migrated to the Cloud Run relay, disabled, or explicitly de-scoped;
- removal of `XAI_API_KEY` from `apps/web/apphosting.yaml` or deployment of an
  equivalent no-key shared backend configuration;
- Secret Manager IAM removal of
  `firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com` from
  `roles/secretmanager.secretAccessor` on `XAI_API_KEY`;
- post-change smoke for the submitted vFinal URL and non-regression checks for
  retained v50/v3 comparison routes;
- a final Secret Manager IAM proof showing only the approved relay service
  account, and any explicitly approved operators/service agents, retain
  payload access to `XAI_API_KEY`.

Until then, the customer submission DoD and security-checksheet submission DoD
must remain BLOCKED for #139.
