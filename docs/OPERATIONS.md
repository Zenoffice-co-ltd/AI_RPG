# Operations

## Environment

Use `.env.local.example` as the source of truth for required variables.

Key values:

- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `LIVEAVATAR_API_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `CLOUD_TASKS_QUEUE_ANALYZE`
- `QUEUE_SHARED_SECRET`
- `DEFAULT_ELEVEN_VOICE_ID`
- `DEFAULT_AVATAR_ID`

## Vendor Bootstrap

```bash
pnpm bootstrap:vendors
pnpm bootstrap:vendors -- --preflight
```

This script:

- checks ElevenLabs connectivity
- checks LiveAvatar connectivity
- reuses `/settings/runtime.liveAvatarElevenSecretId` by default and creates a new LiveAvatar secret only when missing or `--refresh-secret` is passed
- fetches public avatars
- stores runtime settings in `/settings/runtime`
- writes `data/generated/vendors/bootstrap.json`

## Deploy

- App Hosting sample config lives in [apps/web/apphosting.yaml](/C:/AI_RPG/apps/web/apphosting.yaml)
- deploy target is `apps/web`
- keep all vendor secrets server-only in Secret Manager

## Smoke Tests

```bash
pnpm smoke:eleven
pnpm smoke:liveavatar
pnpm verify:acceptance -- --preflight
pnpm verify:acceptance
```

`smoke:eleven` validates KB creation and optional agent/test execution.

`smoke:liveavatar` requires:

- `bootstrap:vendors` already run
- at least one published `AgentBinding`
- default avatar available

`verify:acceptance` is the canonical end-to-end acceptance entrypoint. It runs:

1. preflight
2. `bootstrap:vendors`
3. seed check and optional import/build/compile
4. `publish:scenario --scenario staffing_order_hearing_busy_manager_medium`
5. `smoke:eleven`
6. `smoke:liveavatar`
7. `/api/sessions` -> transcript polling -> `/api/sessions/[id]/end`
8. result polling and 60 second scorecard SLA check

If `APP_BASE_URL` is local, the script can boot the local web app and deliver `/api/internal/analyze-session` directly after queue enqueue so the scorecard path remains verifiable.

## Admin Auth

- `/admin/*` and `/api/admin/*` are protected by Basic Auth
- enforcement lives in [apps/web/proxy.ts](/C:/AI_RPG/apps/web/proxy.ts)
