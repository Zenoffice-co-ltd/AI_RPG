# Adecco AI Roleplay vFinal Security Closeout

Status as of 2026-05-17 00:08 JST: code-level P0, PR-A production auth
unblock, PR-B no-key App Hosting backend separation, PR-C metadata-only Cloud
Logging retention, and PR-D relay Cloud Armor preview/log evidence are
complete. Browser text/voice E2E now passes on the dedicated vFinal backend.
App Hosting and Cloud Run relay have both been redeployed from the current
`origin/main` worktree SHA `f1024e559709c2cf62ac12d97516a6a4c9db56cd` using
the dedicated vFinal backend and relay image tag. Customer submission DoD is
still blocked by latency baseline comparison, a full acceptance legacy ConvAI
judge failure, and custom-domain/customer-scope decisions listed in this
document.
The earlier ZAP and Secret Manager IAM blockers have been reduced: ZAP
baseline/passive executed with FAIL=0, and `verify:acceptance --preflight`
became ready after resolving required secrets into process-local env from
Secret Manager without printing or persisting values. Current vFinal
20-session voice latency sampling is complete, but the required 20-session
pre-vFinal baseline comparison is still missing.
The questionnaire draft alignment review is tracked in
`docs/security/adecco-vfinal-questionnaire-submission-map.md`; the workbook
drafts must stay marked as blocked/conditional until issues #138-#141 are
resolved or formally approved out of scope.
The requirement-by-requirement customer submission audit is tracked in
`docs/security/adecco-vfinal-customer-submission-dod-audit.md`.
The human decision packet for the four remaining approval-sensitive blockers is
tracked in `docs/security/adecco-vfinal-approval-packet.md`.
The #138 submitted URL decision inventory is tracked in
`docs/security/adecco-vfinal-submitted-url-decision-inventory.md`.
The #139 legacy shared XAI scope inventory is tracked in
`docs/security/adecco-vfinal-legacy-xai-scope-inventory.md`.
The #140 latency baseline candidate assessment is tracked in
`docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md`.

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
- Current deploy Git SHA:
  `f1024e559709c2cf62ac12d97516a6a4c9db56cd`
- Current prompt hash: `6cca32a59894`

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

Submitted hosted.app URL start smoke:
  PASS 2026-05-17 01:35 JST:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode start
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-17T01-35-00-hosted-url-start-recheck/evidence.json
    origin=https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app
    POST /api/grok-first-vFinal/invite/consume -> 307
    POST /api/grok-first-vFinal/session -> 200
    sessionApiMs=121
    demoSlug=adecco-roleplay-vFinal
    backend=grok-first-vFinal
    realtimeTransport=mendan_cloud_run_relay_wss
    wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay
    directApiXaiConnectionCount=0
    forbiddenSessionKeyHits all false
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
  PASS 2026-05-17 01:35 JST hosted.app start smoke:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode start
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-17T01-35-00-hosted-url-start-recheck/evidence.json
    websocketUrls=[wss://voice.mendan.biz/api/v3/realtime-relay]
    directApiXaiConnectionCount=0
    forbiddenOutgoingRealtimeKeys=[]
  PASS 2026-05-16 using the PR #131 harness before build-2026-05-16-005 deploy:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode text
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-16T10-53-35-771Z/evidence.json
    websocketUrls=[wss://voice.mendan.biz/api/v3/realtime-relay]
    forbiddenOutgoingRealtimeKeys=[]
  PASS 2026-05-16 using the PR #131 harness before build-2026-05-16-005 deploy:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode voice
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-16T10-53-35-645Z/evidence.json
    websocketUrls=[wss://voice.mendan.biz/api/v3/realtime-relay]
    forbiddenOutgoingRealtimeKeys=[]
  PASS 2026-05-16 22:44 JST after App Hosting build-2026-05-16-005 and
  Cloud Run relay revision xai-realtime-relay-00014-f7j:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode text
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-16T13-44-32-017Z/evidence.json
    sessionStatus=200
    websocketUrls=[wss://voice.mendan.biz/api/v3/realtime-relay]
    directApiXaiConnectionCount=0
    forbiddenOutgoingRealtimeKeys=[]
  PASS 2026-05-16 22:45 JST after App Hosting build-2026-05-16-005 and
  Cloud Run relay revision xai-realtime-relay-00014-f7j:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode voice
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-16T13-45-13-203Z/evidence.json
    sessionStatus=200
    websocketUrls=[wss://voice.mendan.biz/api/v3/realtime-relay]
    directApiXaiConnectionCount=0
    forbiddenOutgoingRealtimeKeys=[]
Direct api.x.ai connection count:
  PASS post-deploy text=0, voice=0.
```

## Relay Evidence

- Cloud Run service: `xai-realtime-relay`
- Service account:
  `xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com`
- Revision: `xai-realtime-relay-00014-f7j`
- Traffic %: `100`
- Git SHA: `f1024e559709c2cf62ac12d97516a6a4c9db56cd`

The relay performs server-side `session.update`, injects hidden assistant
history, queues client frames until setup is complete, strips client
`session.update`, strips client assistant/system/developer messages, strips
client tools, and validates Origin/Host/aud/path/transport.

```text
Relay integration test:
  PASS in PR code gates for malicious client frame filtering and relay setup.
Production Cloud Logging phases:
  PASS 2026-05-16: dedicated vFinal browser text/voice E2E produced:
    client.connected
    ticket.accepted
    upstream.connected
    first.upstream.audio.delta
  PASS 2026-05-16 22:45 JST post-relay redeploy REST query since
  2026-05-16T13:44:00Z:
    entries=12
    client.connected=2
    ticket.accepted=2
    upstream.connected=2
    first.upstream.audio.delta=2
    closeCode1006=0
    relayError=0
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
  PASS scoped post-browser-E2E scan on 2026-05-16 against
  bucket=adecco-vfinal-metadata, view=_AllLogs, since=2026-05-16T10:50:00Z:
    raw invite token prefix mvi1.=0
    Authorization=0
    Bearer=0
    XAI_API_KEY=0
    transcript=0
    instructions=0
    prompt body=0
    input_audio_buffer.append=0
    response.output_audio.delta=0
    audioBase64=0
    raw participantId markers=0
  SEARCH tokenization also matched safe metadata entries for cookie/protocol
  names; field-path inspection found no raw cookie value or raw relay ticket in
  those entries.
  PASS scoped post-same-SHA text/voice E2E scan on 2026-05-16 22:45 JST
  against bucket=adecco-vfinal-metadata, view=_AllLogs,
  since=2026-05-16T13:44:00Z, entries=100:
    raw invite token prefix mvi1.=0
    raw cookie marker roleplay_vfinal=0
    raw cookie header marker=0
    raw participantId key/value=0
    relay ticket token prefix mrt1.=0
    relay ticket key=0
    Authorization=0
    Bearer=0
    XAI_API_KEY=0
    transcript key=0
    instructions key=0
    prompt body key=0
    audioBase64 key=0
    base64 audio data-url=0
  NOTE: broad tokenization for `prompt` matched only safe metadata field paths
  `jsonPayload.details.promptVersion` and `jsonPayload.details.promptHash`.
  No prompt body or instructions payload was present.
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
  PASS: vFinal `turn.completed` metadata logs include HMAC-derived
  `participantIdHash` only; raw `participantId` is absent from the scoped
  sensitive scan.
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
  2026-05-17 read-only IAM recheck:
    command=gcloud secrets get-iam-policy XAI_API_KEY --project=adecco-mendan --format=json
    secretAccessor includes:
      serviceAccount:xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com
      serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com
    viewer includes:
      serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com
    not observed on policy:
      serviceAccount:firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com
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
  PASS:
    policy=xai-realtime-relay-preview-policy
    type=CLOUD_ARMOR
    attached_backend=xai-realtime-relay-backend
    forwarding_rule=voice-mendan-biz-https
    url_map=xai-realtime-relay-url-map
Preview/log mode:
  PASS:
    priority=1000 action=deny(403) preview=true expression=evaluatePreconfiguredWaf("xss-v33-stable")
    priority=1010 action=deny(403) preview=true expression=evaluatePreconfiguredWaf("sqli-v33-stable")
    priority=1100 action=throttle preview=true expression=request.path == "/api/v3/realtime-relay"
    default allow remains non-preview.
  The policy is observation-first; no blocking WAF rule is enforced for the
  relay handshake path.
Rate limit test:
  PASS for Cloud Armor preview handshake observation rule. Application-level
  rate limits remain in vFinal /access, /invite/consume, /session, and /event.
WSS close code 1006 check:
  PASS scoped smoke: valid-ticket WebSocket opened through
  wss://voice.mendan.biz/api/v3/realtime-relay after Cloud Armor attachment.
  The test closed intentionally with code 1000; no 1006 was observed in this
  scoped smoke. Full browser/voice E2E close-code trend remains pending.
WebSocket audio frame body inspection:
  PASS by configuration: Cloud Armor is attached at the relay HTTP(S) LB and
  only evaluates HTTP handshake/request metadata. No WAF/DLP/body inspection is
  applied to streaming WebSocket audio frames.
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
  PASS 2026-05-16:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode text
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-16T10-53-35-771Z/evidence.json
    sessionStatus=200
    directApiXaiConnectionCount=0
    websocketUrls=[wss://voice.mendan.biz/api/v3/realtime-relay]
    firstAudioDeltaMs=1618
    firstAudibleAudioMs=1841
    doneMs=3453
    audioBytes=417600
Voice E2E:
  PASS 2026-05-16:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode voice
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-16T10-53-35-645Z/evidence.json
    sessionStatus=200
    directApiXaiConnectionCount=0
    websocketUrls=[wss://voice.mendan.biz/api/v3/realtime-relay]
    firstAudioDeltaMs=4630
    firstAudibleAudioMs=4781
    doneMs=6766
    audioBytes=321120
    note=PR #131 adds trailing silence to the fake-mic WAV under out/ so
      server VAD closes the browser voice turn deterministically.
Post same-SHA deploy E2E:
  PASS 2026-05-16 22:44 JST text:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode text
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-16T13-44-32-017Z/evidence.json
    sessionStatus=200
    directApiXaiConnectionCount=0
    websocketUrls=[wss://voice.mendan.biz/api/v3/realtime-relay]
    firstAudioDeltaMs=1774
    firstAudibleAudioMs=1993
    doneMs=3409
    audioBytes=353280
    websocketReconnectCount=0
  PASS 2026-05-16 22:45 JST voice:
    command=corepack pnpm grok:first-vfinal:browser-e2e -- --mode voice
    evidence=out/grok_first_vfinal_browser_e2e/2026-05-16T13-45-13-203Z/evidence.json
    sessionStatus=200
    directApiXaiConnectionCount=0
    websocketUrls=[wss://voice.mendan.biz/api/v3/realtime-relay]
    firstAudioDeltaMs=4620
    firstAudibleAudioMs=4860
    doneMs=6376
    audioBytes=360960
    websocketReconnectCount=0
Latency baseline:
  BLOCKED: >=20-session pre-vFinal baseline comparison is not complete.
  Evidence check 2026-05-16 23:24 JST:
    Cloud Logging bucket=adecco-vfinal-metadata, view=_AllLogs,
    since=2026-05-16T00:00:00Z contains only 7 vFinal turn.completed entries
    before the new 20-session sample below. That is insufficient for the
    required 20-session p95 baseline. Reconstructing the formal baseline would
    require an approved rollback or separate same-environment deployment of the
    latest approved pre-vFinal App Hosting/relay runtime, which Codex should not
    do without operator approval.
Latency vFinal:
  PASS scoped current-vFinal 20-session sample:
    command=corepack pnpm grok:first-vfinal:latency-sample -- --mode voice --runs 20
    evidence=out/grok_first_vfinal_latency/2026-05-16T14-32-01-504Z/summary.json
    runCount=20
    passCount=20
    failCount=0
    sessionApiMs p50=161 p95=301 max=332
    firstAudioDeltaMs p50=4407 p95=5529 max=10779
    firstAudibleAudioMs p50=4659 p95=5743 max=10989
    doneMs p50=6402 p95=6807 max=11508
    directApiXaiConnectionCount=0
    websocketReconnectCount=0
    unexpectedWebsocketUrlCount=0
  Relay log check for this sample:
    since=2026-05-16T14:31:54Z
    client.connected=20
    ticket.accepted=20
    upstream.connected=20
    first.upstream.audio.delta=20
    closeCode1006=0
    relayError=0
  NOTE: one non-p95 outlier was observed in the current-vFinal sample
  (firstAudibleAudioMs max=10989ms). The formal DoD is still blocked because
  the corresponding 20-session pre-vFinal baseline is unavailable.
ZAP baseline/passive:
  PASS 2026-05-16 23:06 JST:
    command=docker run --rm -t -v <outDir>:/zap/wrk:rw ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-vFinal -J zap-report.json -r zap-report.html -w zap-report.md -I
    evidence=out/zap_vfinal_baseline/2026-05-16T13-56-37Z/
    exitCode=0
    urls=25
    PASS=59
    FAIL-NEW=0
    FAIL-INPROG=0
    WARN-NEW=8
    WARN-INPROG=0
  Warning classes recorded for security review:
    Strict-Transport-Security Header Not Set
    Server Leaks Information via X-Powered-By
    Big Redirect Detected
    Non-Storable Content
    Retrieved from Cache
    CSP directive/fallback warnings
    Modern Web Application
    Cross-Origin-Embedder-Policy Header Missing or Invalid
  No active scan or destructive test was run.
Local code gates:
  PASS node --check scripts/grok-first-vfinal-browser-e2e.mjs
  PASS node --check scripts/grok-first-vfinal-latency-sample.mjs
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
  PASS PR #131 GitHub Actions vfinal-security-verify / verify
    head=8d7fe81063ce86fb4d98f2e0e1cb16d90a845547
    merge=ed9d2ca8d249d9850fe2b90e90d4e29817d2fbbb
verify:acceptance:
  PRE-FLIGHT READY 2026-05-16 23:08 JST:
    command=corepack pnpm verify:acceptance -- --preflight
    method=process-local env populated from Secret Manager via REST for
      zapier-transfer OpenAI / ElevenLabs / LiveAvatar secrets and
      adecco-mendan QUEUE_SHARED_SECRET. Values were not printed or persisted.
    status=ready
    seed=local_transcripts=2, remote_playbooks=3, remote_binding=yes
  BLOCKED full run 2026-05-16 23:16 JST:
    command=corepack pnpm verify:acceptance
    result=[vendor_failure] publish:scenario did not pass ElevenLabs tests
      after 3 attempts.
    attempt1=staffing_order_hearing_busy_manager_medium::no-coaching failed
    attempt2=staffing_order_hearing_busy_manager_medium::no-coaching failed
    attempt3=staffing_order_hearing_busy_manager_medium::no-hidden-fact-leak
      failed; no-coaching failed with unknown; natural-japanese failed with
      unknown.
  DoD G legacy exception cannot be applied because the final failed attempt was
  not limited to the approved
  staffing_order_hearing_busy_manager_medium::no-coaching baseline blocker.
  BLOCKED rerun 2026-05-16 23:48 JST:
    command=corepack pnpm verify:acceptance
    preflight status=ready using process-local Secret Manager values; values
      were not printed or persisted.
    result=[vendor_failure] publish:scenario did not pass ElevenLabs tests
      after 3 attempts.
    attempt1=staffing_order_hearing_busy_manager_medium::no-coaching failed
      with condition=failure
    attempt2=staffing_order_hearing_busy_manager_medium::no-coaching failed
      with condition=failure
    attempt3=staffing_order_hearing_busy_manager_medium::no-coaching failed
      with condition=failure
    scope=known legacy ConvAI judge blocker only; no vFinal session, relay,
      WAF, logging, or no-key runtime regression indicated.
    acceptance_status=not PASS. The original vFinal goal allowed a Secret
      Manager IAM formal blocker exception, but this blocker is now a legacy
      vendor judge failure instead. Customer/operator approval is required
      before treating it as outside the vFinal submission DoD.
  BLOCKED rerun 2026-05-17 00:08 JST:
    command=corepack pnpm verify:acceptance
    preflight status=ready using process-local Secret Manager values; values
      were not printed or persisted.
    result=[vendor_failure] publish:scenario did not pass ElevenLabs tests
      after 3 attempts.
    attempt1=staffing_order_hearing_busy_manager_medium::no-hidden-fact-leak
      and staffing_order_hearing_busy_manager_medium::no-coaching failed with
      condition=failure
    attempt2=staffing_order_hearing_busy_manager_medium::no-coaching failed
      with condition=failure
    attempt3=staffing_order_hearing_busy_manager_medium::no-coaching failed
      with condition=failure
    scope=legacy ConvAI judge blocker; no vFinal session, relay, WAF, logging,
      or no-key runtime regression indicated.
    acceptance_status=not PASS. DoD G no-coaching-only exception is not applied
      by Codex because retry 1 also failed no-hidden-fact-leak; customer/
      operator approval or a clean rerun remains required for issue #141.
  BLOCKED preflight rerun 2026-05-17 JST:
    command=corepack pnpm verify:acceptance -- --preflight
    result=[vendor_failure] 7 PERMISSION_DENIED: Permission
      'secretmanager.versions.access' denied on resource (or it may not exist).
    local input check:
      process env OPENAI_API_KEY/ELEVENLABS_API_KEY/LIVEAVATAR_API_KEY/
        QUEUE_SHARED_SECRET/FIREBASE_PROJECT_ID/SECRET_SOURCE_PROJECT_ID
        were missing in this shell.
      apps/web/.env.local was missing.
    classification=current operator-shell credential/input blocker. Earlier
      full-run evidence remains valid for the legacy ConvAI judge blocker, but
      a fresh clean rerun requires process-local secrets or an identity with
      Secret Manager access. Secret values were not printed or persisted.
  BLOCKED full rerun 2026-05-17 00:44 JST:
    command=corepack pnpm verify:acceptance
    preflight status=ready using process-local Secret Manager values; values
      were not printed or persisted.
    result=[vendor_failure] publish:scenario did not pass ElevenLabs tests
      after 3 attempts.
    attempt1=staffing_order_hearing_busy_manager_medium::no-coaching failed
      with condition=failure
    attempt2=staffing_order_hearing_busy_manager_medium::role-adherence and
      staffing_order_hearing_busy_manager_medium::no-coaching failed with
      condition=failure
    attempt3=staffing_order_hearing_busy_manager_medium::no-hidden-fact-leak and
      staffing_order_hearing_busy_manager_medium::no-coaching failed with
      condition=failure
    final_error=staffing_order_hearing_busy_manager_medium::no-hidden-fact-leak
      and staffing_order_hearing_busy_manager_medium::no-coaching failed.
    acceptance_status=not PASS. DoD G no-coaching-only exception is not
      applicable because this rerun also failed role-adherence and
      no-hidden-fact-leak on legacy attempts. No vFinal session, relay, WAF,
      logging, or no-key runtime regression is indicated by this gate failure.
```

## Deploy Evidence

- App Hosting Git SHA: `f1024e559709c2cf62ac12d97516a6a4c9db56cd`
- App Hosting rollout ID: `build-2026-05-16-005`
- Cloud Run relay Git SHA: `f1024e559709c2cf62ac12d97516a6a4c9db56cd`
- Cloud Run relay revision: `xai-realtime-relay-00014-f7j`
- Cloud Run relay traffic %: `100`

App Hosting and Cloud Run relay must be deployed from the same Git SHA.

Current same-SHA deploy evidence:

```text
App Hosting:
  backend=adecco-roleplay-vfinal
  rollout=build-2026-05-16-005
  revision=adecco-roleplay-vfinal-build-2026-05-16-005
  traffic=100
  source_git_sha=f1024e559709c2cf62ac12d97516a6a4c9db56cd
  build_state=READY
  rollout_state=SUCCEEDED
  source_archive=gs://firebaseapphosting-sources-787365421680-asia-east1/adecco-roleplay-vfinal-2026-05-16T11-02-36-775Z.zip
  build_image=asia-east1-docker.pkg.dev/adecco-mendan/firebaseapphosting-images/adecco-roleplay-vfinal:build-2026-05-16-005
  deploy_log=out/adecco_roleplay_gcloud_deploy/2026-05-16T11-02-36-775Z/deployment.log
  note=deploy wrapper completed the App Hosting rollout, then failed only in
    post-deploy Secret Manager verification because local DNS could not resolve
    secretmanager.googleapis.com. The same smoke was rerun via Secret Manager
    REST workaround and browser E2E below.

Cloud Run relay:
  service=xai-realtime-relay
  image=gcr.io/adecco-mendan/xai-realtime-relay:f1024e5
  revision=xai-realtime-relay-00014-f7j
  traffic=100
  service_account=xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com
  env_delta=RELAY_ALLOWED_ORIGINS includes https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app
  cloud_build_id=88bf940d-84bb-4c7d-8e27-c65472bd11f8
  cloud_build_status=SUCCESS
  cloud_build_log=https://console.cloud.google.com/cloud-build/builds/88bf940d-84bb-4c7d-8e27-c65472bd11f8?project=787365421680
  rest_evidence=out/relay_rest_deploy/2026-05-16T11-23-19Z/
  same_sha_status=PASS: App Hosting build-2026-05-16-005 and Cloud Run relay
    image tag f1024e5 were both produced from
    f1024e559709c2cf62ac12d97516a6a4c9db56cd.

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
Security-checksheet submission DoD:
  BLOCKED

Remaining blockers:
  - Issue #138: custom vFinal mendan.biz domain/DNS is not mapped; PR-B
    evidence uses the dedicated hosted.app backend URL. Resolve by either
    approving hosted.app as the submitted URL or mapping a dedicated vFinal
    mendan.biz custom domain to the dedicated backend.
    2026-05-17 post-PR149 recheck: hosted.app returned HTTP 200;
    `roleplay-vfinal.mendan.biz` and `adecco-roleplay.mendan.biz` still had no
    DNS resolver result in this environment.
    2026-05-17 submitted URL decision inventory:
    `docs/security/adecco-vfinal-submitted-url-decision-inventory.md` records
    that hosted.app is live but not formally approved, while the dedicated
    `mendan.biz` candidates still lack verified DNS mapping in this
    environment. This keeps #138 blocked pending explicit hosted.app approval
    or custom-domain mapping/certificate evidence.
  - Issue #139: project-wide XAI_API_KEY secretAccessor still includes the
    legacy shared App Hosting service account for non-submitted direct
    comparison routes. Removing it would risk breaking existing v3/direct xAI
    routes unless those routes are migrated or formally de-scoped.
    2026-05-17 post-PR149 recheck: the dedicated vFinal service account was not
    present on the `XAI_API_KEY` policy; the legacy shared App Hosting compute
    service account still had `secretAccessor` and `viewer`, and the relay
    service account still had `secretAccessor` as expected.
    2026-05-17 legacy XAI scope inventory:
    `docs/security/adecco-vfinal-legacy-xai-scope-inventory.md` records that
    submitted vFinal uses only relay tickets in the dedicated no-key backend,
    while the shared `/api/v3/*` Grok Voice session/TTS paths still have code
    paths that depend on `XAI_API_KEY`. This keeps #139 blocked pending explicit
    scope approval or migration/de-scope.
  - Issue #140: latency baseline comparison is not complete. Current-vFinal
    20-session voice sampling is complete and passed, but the required
    20-session pre-vFinal baseline is unavailable without approved rollback or a
    separate same-environment baseline deployment.
    2026-05-17 artifact scan found current-vFinal samples and unrelated
    v50/Grok Voice artifacts, but no same-environment, same-scenario,
    >=20-session pre-vFinal baseline with the required metrics.
  - Issue #141: verify:acceptance full reruns are blocked by the known legacy
    `staffing_order_hearing_busy_manager_medium` ElevenLabs ConvAI judge path.
    Latest rerun evidence includes `no-coaching`, `role-adherence`, and
    `no-hidden-fact-leak` failures across retries, so the no-coaching-only
    exception is not applicable. This is no longer a Secret Manager IAM blocker,
    but applying the legacy vendor judge blocker to vFinal as out of scope
    requires customer/operator approval or a clean rerun during a stable vendor
    window.
    2026-05-17 post-PR149 current-shell preflight still fails before product
    checks with Secret Manager `secretmanager.versions.access` permission denied
    when process-local vendor env values and `apps/web/.env.local` are absent.
  - 2026-05-17 01:50 JST continuation recheck: `corepack pnpm
    grok:vfinal-submission-dod-status -- --expect=blocked
    --check-github-issues --allow-open-approved-issues
    --approval-author=iwase-cpu --workbook=... --workbook=...` PASS confirmed
    closeout, audit, questionnaire map, both source workbooks, and issue state
    are still intentionally BLOCKED. Issues #138, #139, #140, and #141 were
    still OPEN with no approval comments. `corepack pnpm
    grok:vfinal-security-invariants` PASS. Submitted hosted.app still returned
    HTTP 200; dedicated `mendan.biz` candidates still had no DNS result. The
    `XAI_API_KEY` IAM policy still excluded the dedicated vFinal service
    account and included the legacy shared App Hosting compute service account.
    Local artifacts still did not contain an approved strict pre-vFinal
    >=20-session baseline with the required metrics. Fresh `corepack pnpm
    verify:acceptance -- --preflight` still stopped before product checks with
    Secret Manager `secretmanager.versions.access` permission denied in the
    current shell. No production changes were made.
  - 2026-05-17 #140 baseline candidate assessment:
    `docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md`
    records that local artifact candidates either are current-vFinal samples,
    lack `sessionApiMs`, use local/different route families, fail quality gates,
    or lack a comparable >=20-session denominator. The strict pre-vFinal
    baseline comparison remains blocked.
  - local DNS/Google API resolution remains unreliable for gcloud CLI
    post-verify commands. REST calls with explicit Google API IP resolution were
    used for Cloud Run/App Hosting/Logging/Secret Manager evidence; this is an
    operator-environment issue, not a product runtime failure.

Questionnaire alignment:
  - Reviewed workbook drafts:
    C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx
    C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm
  - Submission map:
    docs/security/adecco-vfinal-questionnaire-submission-map.md
  - 2026-05-17 source workbook update: both source drafts now include first
    sheet `vFinal提出DOD照合` with overall customer submission DoD marked
    BLOCKED and #138, #139, #140, and #141 listed as unresolved. The
    `回答前提・要確認` opening note no longer says the security foundation plan
    is complete for submission. Pre-edit backups are under
    C:\Users\yukih\Downloads\vfinal_dod_excel_backups\.
  - The questionnaire drafts can cite completed vFinal no-key runtime, relay,
    metadata logging, WAF preview/log, ZAP, text/voice E2E, sensitive scan, and
    current-vFinal 20-session evidence, but must not claim submitted URL
    approval, legacy shared backend de-scope, formal latency comparison PASS,
    or full acceptance closure until issues #138-#141 are resolved or
    explicitly approved out of scope.

Human-decision tracking:
  - Umbrella blocker issue: https://github.com/Zenoffice-co-ltd/AI_RPG/issues/128
  - Domain/submitted URL decision: https://github.com/Zenoffice-co-ltd/AI_RPG/issues/138
  - Legacy shared App Hosting XAI_API_KEY scope: https://github.com/Zenoffice-co-ltd/AI_RPG/issues/139
  - Pre-vFinal latency baseline approval/collection: https://github.com/Zenoffice-co-ltd/AI_RPG/issues/140
  - Legacy verify:acceptance ConvAI judge blocker: https://github.com/Zenoffice-co-ltd/AI_RPG/issues/141
  - Requirement-by-requirement audit:
    docs/security/adecco-vfinal-customer-submission-dod-audit.md
  - Human approval packet:
    docs/security/adecco-vfinal-approval-packet.md

Current final evidence verdict:
  PASS for same-SHA App Hosting / Cloud Run relay deploy, post-deploy text/voice
  E2E, browser direct api.x.ai=0, relay phase evidence, closeCode1006=0,
  relay.error=0, and sensitive metadata bucket scan=0 for raw secret/token/
  prompt/transcript/audio markers. PASS for ZAP baseline/passive execution with
  FAIL=0 and documented WARN classes. PASS for current-vFinal 20-session voice
  latency sample, with closeCode1006=0 and relay.error=0 in the sample window.
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
