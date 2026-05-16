# Adecco vFinal Legacy XAI Scope Inventory

Status as of 2026-05-17 JST: **legacy shared XAI_API_KEY scope decision still required**.

This note supports issue #139. It does not change the customer submission DoD
verdict. The dedicated submitted vFinal runtime remains no-key, but the legacy
shared App Hosting backend still has `XAI_API_KEY` access for non-submitted
comparison/direct routes. Removing that access without a migration or formal
de-scope decision can break existing legacy behavior.

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

Code/config evidence:

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

Issue #139 remains blocked until one of these is true:

1. A customer/operator explicitly approves that the vFinal submitted runtime
   scope is limited to the dedicated no-key backend and submitted URL, with
   legacy shared App Hosting routes and their `XAI_API_KEY` access treated as
   internal comparison/continuity infrastructure outside the vFinal submission.
2. The legacy/direct Grok Voice routes are migrated, decommissioned, or
   formally de-scoped so the shared App Hosting service account no longer needs
   `XAI_API_KEY`; then the IAM binding is removed and v50/v3 comparison
   non-regression plus vFinal smoke are rerun.

Until then, the customer submission DoD and security-checksheet submission DoD
must remain BLOCKED for #139.
