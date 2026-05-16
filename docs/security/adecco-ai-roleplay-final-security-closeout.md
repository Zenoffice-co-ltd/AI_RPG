# Adecco AI Roleplay vFinal Security Closeout

Status as of 2026-05-16 19:15 JST: code-level P0, PR-A production auth
unblock, PR-B no-key App Hosting backend separation, and PR-C metadata-only
Cloud Logging retention evidence are complete. Customer submission DoD is still
blocked by WAF, browser/voice E2E, latency, ZAP, acceptance, and final
same-SHA production closeout evidence listed in this document.

## Target

- Submitted vFinal no-key URL:
  `https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-vFinal`
- Legacy shared URL retained for internal comparison continuity:
  `https://roleplay.mendan.biz/demo/adecco-roleplay-vFinal`
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

## Official Docs Checked

Checked on 2026-05-16 before starting the vFinal submission unblock work.

| Area | Official doc | Adoption decision |
|---|---|---|
| Firebase App Hosting backend/config/secrets/service account | https://firebase.google.com/docs/app-hosting/configure | Keep deploy evidence tied to App Hosting backend config and Secret Manager references. Use `apphosting.vfinal.yaml` only for the later dedicated no-key runtime phase; PR-A does not change backend topology. |
| Cloud Logging buckets/sinks/exclusions/retention | https://docs.cloud.google.com/logging/docs/buckets and https://docs.cloud.google.com/logging/docs/routing/overview | Later infra phase must create or update a metadata-only bucket/sink with retention >= 180 days. PR-A removes raw invite tokens from request URLs so request logging is no longer the primary mitigation. |
| Cloud Armor security policy / preview mode / rate limiting | https://cloud.google.com/armor/docs/configure-security-policies and https://docs.cloud.google.com/armor/docs/rate-limiting-overview | Later infra phase must apply Cloud Armor to the relay backend in preview/log mode first. Application-level rate limits remain in vFinal `/access`, `/invite/consume`, `/session`, and `/event`. |
| External Application Load Balancer / WebSocket support | https://cloud.google.com/load-balancing/docs/https | Google Cloud HTTP(S)-based load balancers support WebSocket upgrade without extra proxy configuration. WAF changes must not inspect streaming audio frames or break upgrade. |
| Secret Manager IAM / secretAccessor scope | https://cloud.google.com/secret-manager/docs/access-control and https://docs.cloud.google.com/secret-manager/docs/best-practices | Later no-key runtime phase must enforce least privilege: relay keeps `XAI_API_KEY`; vFinal Web runtime must not have `XAI_API_KEY` access. |
| Firebase App Hosting backend REST create | https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends/create | PR-B creates a separate `adecco-roleplay-vfinal` backend and assigns a user-managed vFinal service account instead of the shared App Hosting compute service account. |
| Firebase App Hosting custom domain | https://firebase.google.com/docs/app-hosting/custom-domain | A custom `mendan.biz` submission domain requires DNS records and certificate/domain verification. Current PR-B evidence uses the dedicated `hosted.app` backend URL until DNS/domain mapping is approved. |
| Cloud Run service identity | https://docs.cloud.google.com/run/docs/securing/service-identity | Runtime evidence must verify the managed Cloud Run service uses the vFinal user-managed service account and not the shared App Hosting compute service account. |

## Session Contract Evidence

The session response must return only public metadata and relay auth. It must
not return `instructions`, prompt body, hidden assistant history, hidden first
message, `ephemeralToken`, xAI API key, raw invite token, raw participant ID,
transcript, audio/base64, or tool definitions.

```text
curl result:
  PASS 2026-05-16: POST /api/grok-first-vFinal/invite/consume returned 307 and
  set roleplay_vfinal_access / roleplay_vfinal_api_access. POST
  /api/grok-first-vFinal/session returned 200 in 0.190s using the scoped API
  cookie from the consume response.

PR-A local diagnostic:
  PASS 2026-05-16: after normalizing signing helper secrets, a vFinal invite
  generated from Secret Manager values is accepted by the local production
  verifier, sets a scoped API cookie, and that cookie verifies for session
  access.

Production session contract:
  sessionIdPrefix=gfvfinal_
  demoSlug=adecco-roleplay-vFinal
  backend=grok-first-vFinal
  scenarioId=staffing_order_hearing_adecco_manufacturer_busy_manager_medium_vfinal
  promptVersion=grok-first-v50.6-2026-05-15
  promptHash=6cca32a59894
  guardrailVersion=grok-first-vfinal-guard-2026-05-16
  realtimeTransport=mendan_cloud_run_relay_wss
  wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay
  realtimeAuth.mode=mendan_relay_subprotocol
  realtimeAuth.protocol=mendan-relay-v1
  relay ticket present=true

Safe negative checks from the 200 response:
  instructions=false
  firstMessage=false
  hiddenAssistantHistory=false
  ephemeralToken=false
  XAI_API_KEY=false
  transcript=false
  audioBase64=false
  tools=false

PR-B no-key backend smoke:
  PASS 2026-05-16: dedicated backend
  https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app
  returned POST /api/grok-first-vFinal/invite/consume -> 307 and
  POST /api/grok-first-vFinal/session -> 200 after deploying with
  apps/web/apphosting.vfinal.yaml. The response identity remained
  demoSlug=adecco-roleplay-vFinal, backend=grok-first-vFinal,
  realtimeTransport=mendan_cloud_run_relay_wss, and
  wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay. Forbidden keys were
  absent in the deploy-script contract check.
```

## Browser Connection Evidence

Allowed browser network destinations:

- `adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app` for PR-B
  no-key backend evidence
- `roleplay.mendan.biz` for legacy shared internal comparison routes until a
  custom vFinal `mendan.biz` domain is approved and mapped
- `voice.mendan.biz`

Forbidden:

- Browser direct `api.x.ai`

```text
Browser WebSocket capture:
  BLOCKED pending browser E2E against the dedicated no-key backend.
Direct api.x.ai connection count:
  BLOCKED pending browser E2E against the dedicated no-key backend.
```

## Relay Evidence

- Cloud Run service: `xai-realtime-relay`
- Service account:
  `xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com`
- Revision: `xai-realtime-relay-00012-gdb`
- Traffic %: `100`
- Git SHA: `ac321404be1553fe8984b6daad1ab5e4ba8e86a3`

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
  projects/adecco-mendan/locations/global/buckets/adecco-vfinal-metadata
Retention:
  180 days
Inclusion filter:
  sink=adecco-vfinal-metadata-sink
  destination=logging.googleapis.com/projects/adecco-mendan/locations/global/buckets/adecco-vfinal-metadata
  filter:
    resource.type="cloud_run_revision"
    AND (
      jsonPayload.scope="grokFirstVFinal"
      OR jsonPayload.scope="grokVoice.realtimeRelay"
      OR jsonPayload.scope=~"^vfinal\\."
    )
Exclusion filter:
  _Default exclusion drop-vfinal-access-raw-invite:
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="adecco-roleplay"
  AND httpRequest.requestUrl=~"/demo/adecco-roleplay-vFinal/access\\?invite="
Sensitive log scan command/result:
  PASS scoped PR-C scan against adecco-vfinal-metadata bucket after a live
  vFinal session generated post-sink metadata:
    mvi1.=0
    roleplay_vfinal=0
    relay-ticket=0
    mendan-relay-ticket.=0
    Authorization=0
    Bearer=0
    XAI_API_KEY=0
    transcript=0
    instructions=0
    prompt body=0
    input_audio_buffer.append=0
    response.output_audio.delta=0
    audioBase64=0
    participantId"=0
    participantId:=0
  NOTE: a production diagnostic request before PR-A confirmed that raw invite
  query values can enter Cloud Run request logs via httpRequest.requestUrl. PR-A
  moved invite consumption to URL fragments + POST body, and the _Default
  exclusion above remains as a defense-in-depth guard for the deprecated query
  shape.
```

## Invite Auth Evidence

Invite URL shape:

```text
/demo/adecco-roleplay-vFinal/access#invite=<signedInviteToken>
  -> POST /api/grok-first-vFinal/invite/consume
```

Cookie scope:

- `roleplay_vfinal_access`: `Path=/demo/adecco-roleplay-vFinal`,
  `HttpOnly`, `Secure`, `SameSite=Lax`
- `roleplay_vfinal_api_access`: `Path=/api/grok-first-vFinal`, `HttpOnly`,
  `Secure`, `SameSite=Lax`

Logs may contain only HMAC-derived `participantIdHash`.

```text
Cookie capture:
  PASS 2026-05-16: POST /api/grok-first-vFinal/invite/consume set
  roleplay_vfinal_access and roleplay_vfinal_api_access.
  PR-A changes /access to a fragment bootstrap and moves invite consumption to
  POST /api/grok-first-vFinal/invite/consume so raw invite tokens are not sent
  in the HTTP request line.
participantIdHash log sample:
  BLOCKED until /access or /session succeeds.
raw participant/token scan:
  PASS scoped scan since PR-A deploy: Cloud Logging requestUrl hits for
  /demo/adecco-roleplay-vFinal/access?invite= were 0 after
  build-2026-05-16-009 rollout. POST /api/grok-first-vFinal/invite/consume
  appeared with no token in requestUrl.
  Full sensitive log scan remains required for final submission.
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
  PASS for submitted vFinal backend:
    backend=adecco-roleplay-vfinal
    serviceAccount=firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com
    XAI_API_KEY secretAccessor=false
    XAI_API_KEY viewer=false
    allowed secrets:
      XAI_RELAY_TICKET_SECRET
      GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET
      GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET
  NOTE: the legacy shared backend service account
  firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com still has
  XAI_API_KEY access for non-submitted legacy/direct comparison routes. The
  submitted vFinal URL is therefore the dedicated hosted.app backend above, not
  the shared roleplay.mendan.biz backend.
Runtime env proof:
  PASS for adecco-roleplay-vfinal Cloud Run managed service:
    service=adecco-roleplay-vfinal
    revision=adecco-roleplay-vfinal-build-2026-05-16-002
    serviceAccountName=firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com
    env secrets:
      XAI_RELAY_TICKET_SECRET
      GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET
      GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET
    forbidden env/secret absent:
      XAI_API_KEY
      ANTHROPIC_API_KEY
      OPENAI_API_KEY
      FISH_API_KEY
      ELEVENLABS_API_KEY
apps/web/apphosting.vfinal.yaml scan:
  PASS: vFinal code contract omits XAI_API_KEY.
Secret scan result:
  PASS scoped PR-B evidence: dedicated vFinal App Hosting runtime env contains
  no XAI_API_KEY binding. Full repo/log/artifact secret scan remains required
  for final customer submission.
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
  PASS node --check scripts/deploy-adecco-roleplay-gcloud.mjs
  PASS corepack pnpm --filter @top-performer/web test -- tests/unit/grok-first-vfinal.test.ts
    (Vitest selected the web suite: 101 files / 874 tests passed)
  PASS corepack pnpm --filter @top-performer/web typecheck
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

- App Hosting Git SHA: `ac321404be1553fe8984b6daad1ab5e4ba8e86a3`
- App Hosting rollout ID: `build-2026-05-16-009`
- Cloud Run relay Git SHA: `ac321404be1553fe8984b6daad1ab5e4ba8e86a3`
- Cloud Run relay revision: `xai-realtime-relay-00012-gdb`
- Cloud Run relay traffic %: `100`

App Hosting and Cloud Run relay must be deployed from the same Git SHA.

Current same-SHA deploy evidence:

```text
App Hosting:
  backend=adecco-roleplay
  rollout=build-2026-05-16-009
  revision=adecco-roleplay-build-2026-05-16-009
  traffic=100

Cloud Run relay:
  service=xai-realtime-relay
  image=gcr.io/adecco-mendan/xai-realtime-relay:ac32140
  revision=xai-realtime-relay-00012-gdb
  traffic=100

PR-B vFinal no-key App Hosting backend evidence:
  PR=124 merged
  git_sha=b712f80850a763b4eac7ca9affa5da364eb837f3
  backend=adecco-roleplay-vfinal
  backend_uri=adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app
  service_account=firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com
  rollout=build-2026-05-16-002
  rollout_state=SUCCEEDED
  revision=adecco-roleplay-vfinal-build-2026-05-16-002
  traffic=100
  apphosting_config=apps/web/apphosting.vfinal.yaml
  deploy_script=pnpm deploy:adecco-roleplay-vfinal:gcloud
  deploy_evidence=out/adecco_roleplay_gcloud_deploy/2026-05-16T09-47-23-477Z/summary.json
  post_merge_smoke=PASS invite consume 307; session 200; demoSlug/backend/wsUrl expected

Existing comparison route non-regression:
  PASS 2026-05-16: shared backend session API smoke returned 200 for:
    /api/grok-first-v50/session
    /api/grok-first-v50-1/session
    /api/grok-first-v50-4/session
    /api/grok-first-v50-5/session
    /api/grok-first-v50-6/session
    /api/grok-first-v50-7/session
  All retained realtimeTransport=mendan_cloud_run_relay_wss,
  wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay, and
  realtimeAuth.mode=mendan_relay_subprotocol.
```

## Remaining Blockers

```text
Customer submission DoD:
  BLOCKED

Remaining blockers:
  - custom vFinal mendan.biz domain/DNS is not mapped; PR-B evidence uses the
    dedicated hosted.app backend URL.
  - project-wide XAI_API_KEY secretAccessor still includes the legacy shared App
    Hosting service account for non-submitted direct comparison routes. Removing
    it would risk breaking existing v3/direct xAI routes unless those routes are
    migrated or formally de-scoped.
  - final sensitive log scan after browser/voice E2E and relay phase evidence is not complete.
  - Cloud Armor/WAF preview/log mode is not yet applied to relay LB.
  - browser WS capture, direct api.x.ai=0 evidence, live text E2E, and live
    voice E2E are not complete.
  - latency baseline comparison is not complete.
  - ZAP baseline/passive scan is not complete.
  - verify:acceptance is still blocked by Secret Manager IAM:
    [vendor_failure] 7 PERMISSION_DENIED: Permission
    'secretmanager.versions.access' denied on resource (or it may not exist).

Final PR-B verdict:
  PASS for vFinal dedicated no-key App Hosting backend/environment separation.
  FAIL/BLOCKED for overall customer submission DoD until the remaining blockers
  above are resolved or formally approved as out of scope.
```

## Rollback

1. Stop new invite distribution.
2. Roll App Hosting backend to the previous known-good rollout.
3. Roll Cloud Run relay traffic to the previous known-good revision.
4. Confirm `/api/grok-first-vFinal/session` is unavailable or reverted.
5. Run sensitive log scan for the incident window.
6. Rotate `XAI_RELAY_TICKET_SECRET`, invite signing secret, participant hash
   secret, and `XAI_API_KEY` if exposure is suspected.
