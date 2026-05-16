# Adecco AI Roleplay vFinal Security Closeout

Status as of 2026-05-16 17:30 JST: code-level P0 and PR merge DoD are complete,
and App Hosting / Cloud Run relay were redeployed from the same merged Git SHA.
Customer submission DoD is still blocked by production environment evidence and
runtime issues listed in this document.

## Target

- URL: `https://roleplay.mendan.biz/demo/adecco-roleplay-vFinal`
- Session API: `/api/grok-first-vFinal/session`
- Event API: `/api/grok-first-vFinal/event`
- Relay: `wss://voice.mendan.biz/api/v3/realtime-relay`
- `demoSlug`: `adecco-roleplay-vFinal`
- `backend`: `grok-first-vFinal`
- Temporary baseline: latest approved Grok-first relay runtime present in
  `origin/main`; do not cite route names absent from `origin/main`.
- Baseline commit SHA: `bc8de3dc937e2feba0b398ff6c72476a4d79f26b`
- Baseline prompt hash: blocked until vFinal session contract returns 200 in
  production

## Session Contract Evidence

The session response must return only public metadata and relay auth. It must
not return `instructions`, prompt body, hidden assistant history, hidden first
message, `ephemeralToken`, xAI API key, raw invite token, raw participant ID,
transcript, audio/base64, or tool definitions.

```text
curl result:
  BLOCKED 2026-05-16: /api/grok-first-vFinal/session returned 401 with a
  syntactically valid vFinal API session cookie generated from the Secret
  Manager values available to the operator shell. /demo/adecco-roleplay-vFinal/access
  also returned 403 for generated invite tokens. This blocks live browser and
  relay WebSocket evidence.

Safe negative checks from the 401 response:
  instructions=false
  firstMessage=false
  hiddenAssistantHistory=false
  ephemeralToken=false
  XAI_API_KEY=false
  transcript=false
  tools=false
```

## Browser Connection Evidence

Allowed browser network destinations:

- `roleplay.mendan.biz`
- `voice.mendan.biz`

Forbidden:

- Browser direct `api.x.ai`

```text
Browser WebSocket capture:
  BLOCKED by vFinal invite/session auth returning 403/401.
Direct api.x.ai connection count:
  BLOCKED until browser session can start.
```

## Relay Evidence

- Cloud Run service: `xai-realtime-relay`
- Service account:
  `xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com`
- Revision: `xai-realtime-relay-00011-dt6`
- Traffic %: `100`
- Git SHA: `bc8de3dc937e2feba0b398ff6c72476a4d79f26b`

The relay performs server-side `session.update`, injects hidden assistant
history, queues client frames until setup is complete, strips client
`session.update`, strips client assistant/system/developer messages, strips
client tools, and validates Origin/Host/aud/path/transport.

```text
Relay integration test:
  PASS in PR code gates for malicious client frame filtering and relay setup.
Production Cloud Logging phases:
  BLOCKED until vFinal session/auth returns 200 and a WebSocket can connect.
Health:
  PASS https://voice.mendan.biz/healthz -> {"ok":true}
```

## Logging And Retention Evidence

Retention target: metadata-only Cloud Logging bucket or sink with retention >=
180 days.

Sensitive values that must not appear:

- relay ticket raw value
- Authorization / Bearer token / `XAI_API_KEY`
- cookie raw value / invite token raw value / raw participant ID
- audio frame / base64 audio
- transcript text / user text / agent text
- prompt / instructions / hidden scenario text

```text
Log bucket:
  projects/adecco-mendan/locations/global/buckets/_Default
Retention:
  30 days
Inclusion filter:
  BLOCKED: metadata-only 180+ day bucket/sink has not been configured.
Exclusion filter:
  _Default exclusion drop-vfinal-access-raw-invite:
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="adecco-roleplay"
  AND httpRequest.requestUrl=~"/demo/adecco-roleplay-vFinal/access\\?invite="
Sensitive log scan command/result:
  BLOCKED: a production diagnostic request before the exclusion confirmed that
  raw invite query values can enter Cloud Run request logs via httpRequest.requestUrl.
  The exclusion above prevents future _Default ingestion for that URL shape, but
  this must be remediated or scoped out before customer submission.
```

## Invite Auth Evidence

Invite URL shape:

```text
/demo/adecco-roleplay-vFinal/access?invite=<signedInviteToken>
```

Cookie scope:

- `roleplay_vfinal_access`: `Path=/demo/adecco-roleplay-vFinal`,
  `HttpOnly`, `Secure`, `SameSite=Lax`
- `roleplay_vfinal_api_access`: `Path=/api/grok-first-vFinal`, `HttpOnly`,
  `Secure`, `SameSite=Lax`

Logs may contain only HMAC-derived `participantIdHash`.

```text
Cookie capture:
  BLOCKED: /access currently returns 403 for generated invite tokens.
participantIdHash log sample:
  BLOCKED until /access or /session succeeds.
raw participant/token scan:
  BLOCKED: see Logging And Retention Evidence. Raw invite query logging was
  observed before the sink exclusion was added.
```

## Secret / IAM Evidence

Required:

- Relay service account can access only `XAI_API_KEY` and
  `XAI_RELAY_TICKET_SECRET`.
- vFinal Web/App Hosting runtime must not have `XAI_API_KEY`.
- Web/App Hosting vFinal runtime holds only invite/hash/ticket issuance secrets.
- Submitted vFinal App Hosting config is `apps/web/apphosting.vfinal.yaml`,
  which intentionally omits `XAI_API_KEY`.
- In production, `GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET` and
  `GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET` are mandatory and must not fall
  back to `XAI_RELAY_TICKET_SECRET`.

If existing internal comparison routes still require `XAI_API_KEY`, deploy
vFinal on a separate App Hosting backend/environment before customer
submission.

```text
Relay SA IAM:
  XAI_API_KEY: secretAccessor includes
    serviceAccount:xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com
  XAI_RELAY_TICKET_SECRET: secretAccessor includes
    serviceAccount:xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com
Web/App Hosting SA IAM:
  BLOCKED: firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com
  still has secretAccessor on XAI_API_KEY in the existing shared App Hosting
  backend.
Runtime env proof:
  BLOCKED for strict vFinal no-key DoD: the deployed shared adecco-roleplay
  backend still binds XAI_API_KEY for existing comparison routes.
apps/web/apphosting.vfinal.yaml scan:
  PASS: vFinal code contract omits XAI_API_KEY.
Secret scan result:
  BLOCKED until CI/artifact secret scan evidence is collected.
```

## WAF / Rate Limit Evidence

Phase 1 answer:

- Relay LB is protected by Cloud Armor/WAF in preview/log mode.
- WebSocket upgrade is not blocked.
- WebSocket audio frame body inspection is not used.
- `/access`, `/session`, and `/event` have application-level rate limits.
- If Web App remains Firebase App Hosting direct, WAF is relay-entry focused
  and Web App is protected by compensating controls, not app-wide WAF.

```text
Cloud Armor policy:
  BLOCKED: no Cloud Armor security policies were listed in project
  adecco-mendan during 2026-05-16 verification.
Preview/log mode:
  BLOCKED.
Rate limit test:
  BLOCKED for production live test until vFinal auth succeeds. Code-level
  application rate limit exists for /access, /session, and /event.
WSS close code 1006 check:
  BLOCKED until browser WebSocket E2E can run.
```

## Test And Latency Evidence

Commands:

```bash
pnpm grok:vfinal-security-invariants
pnpm --filter @top-performer/web test -- tests/unit/grok-first-vfinal.test.ts
pnpm --filter @top-performer/xai-realtime-relay test -- src/server.test.ts
pnpm --filter @top-performer/grok-realtime-relay-auth test
pnpm typecheck
pnpm test
pnpm verify:acceptance
```

Latency baseline must use the same environment, same scenario, and at least 20
sessions against the latest approved relay runtime before vFinal.

Pass criteria:

- session API p95 <= baseline + 50ms
- `firstAudioDeltaMs` p95 <= baseline + 100ms
- `firstAudibleAudioMs` p95 <= baseline + 100ms
- no WebSocket close code 1006 increase
- no `relay.error` increase
- voice E2E passes after WAF preview/log policy is applied

```text
Text E2E:
Voice E2E:
Latency baseline:
Latency vFinal:
ZAP baseline/passive:
Local code gates:
  PASS corepack pnpm grok:vfinal-security-invariants
  PASS corepack pnpm exec vitest run --config vitest.config.ts apps/web/tests/unit/grok-first-vfinal.test.ts apps/xai-realtime-relay/src/server.test.ts packages/grok-realtime-relay-auth/src/ticket.test.ts
  PASS corepack pnpm --filter @top-performer/web typecheck
  PASS corepack pnpm --filter @top-performer/xai-realtime-relay typecheck
  PASS corepack pnpm -r --workspace-concurrency=1 --if-present typecheck
  PASS corepack pnpm -r --workspace-concurrency=1 --if-present test
  BLOCKED corepack pnpm typecheck / test: Turbo on Windows cannot find package manager binary
verify:acceptance:
  BLOCKED corepack pnpm verify:acceptance:
  [vendor_failure] 7 PERMISSION_DENIED: Permission 'secretmanager.versions.access' denied on resource (or it may not exist).
```

## Deploy Evidence

- App Hosting Git SHA: `bc8de3dc937e2feba0b398ff6c72476a4d79f26b`
- App Hosting rollout ID: `build-2026-05-16-007`
- Cloud Run relay Git SHA: `bc8de3dc937e2feba0b398ff6c72476a4d79f26b`
- Cloud Run relay revision: `xai-realtime-relay-00011-dt6`
- Cloud Run relay traffic %: `100`

App Hosting and Cloud Run relay must be deployed from the same Git SHA.

Current same-SHA deploy evidence:

```text
App Hosting:
  backend=adecco-roleplay
  rollout=build-2026-05-16-007
  revision=adecco-roleplay-build-2026-05-16-007
  traffic=100

Cloud Run relay:
  service=xai-realtime-relay
  image=gcr.io/adecco-mendan/xai-realtime-relay:bc8de3d
  revision=xai-realtime-relay-00011-dt6
  traffic=100
```

## Rollback

1. Stop new invite distribution.
2. Roll App Hosting backend to the previous known-good rollout.
3. Roll Cloud Run relay traffic to the previous known-good revision.
4. Confirm `/api/grok-first-vFinal/session` is unavailable or reverted.
5. Run sensitive log scan for the incident window.
6. Rotate `XAI_RELAY_TICKET_SECRET`, invite signing secret, participant hash
   secret, and `XAI_API_KEY` if exposure is suspected.
