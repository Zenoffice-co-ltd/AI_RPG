# Adecco AI Roleplay vFinal Security Closeout

Status: implementation evidence template. Fill every evidence field during the
final production rollout.

## Target

- URL: `https://roleplay.mendan.biz/demo/adecco-roleplay-vFinal`
- Session API: `/api/grok-first-vFinal/session`
- Event API: `/api/grok-first-vFinal/event`
- Relay: `wss://voice.mendan.biz/api/v3/realtime-relay`
- `demoSlug`: `adecco-roleplay-vFinal`
- `backend`: `grok-first-vFinal`
- Temporary baseline: latest approved Grok-first relay runtime present in
  `origin/main`; do not cite route names absent from `origin/main`.
- Baseline commit SHA:
- Baseline prompt hash:

## Session Contract Evidence

The session response must return only public metadata and relay auth. It must
not return `instructions`, prompt body, hidden assistant history, hidden first
message, `ephemeralToken`, xAI API key, raw invite token, raw participant ID,
transcript, audio/base64, or tool definitions.

```text
curl result / browser network capture:
```

## Browser Connection Evidence

Allowed browser network destinations:

- `roleplay.mendan.biz`
- `voice.mendan.biz`

Forbidden:

- Browser direct `api.x.ai`

```text
Browser WebSocket capture:
Direct api.x.ai connection count:
```

## Relay Evidence

- Cloud Run service: `xai-realtime-relay`
- Service account:
  `xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com`
- Revision:
- Traffic %:
- Git SHA:

The relay performs server-side `session.update`, injects hidden assistant
history, queues client frames until setup is complete, strips client
`session.update`, strips client assistant/system/developer messages, strips
client tools, and validates Origin/Host/aud/path/transport.

```text
Relay integration test:
Production Cloud Logging phases:
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
Retention:
Inclusion filter:
Exclusion filter:
Sensitive log scan command/result:
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
participantIdHash log sample:
raw participant/token scan:
```

## Secret / IAM Evidence

Required:

- Relay service account can access only `XAI_API_KEY` and
  `XAI_RELAY_TICKET_SECRET`.
- vFinal Web/App Hosting runtime must not have `XAI_API_KEY`.
- Web/App Hosting vFinal runtime holds only invite/hash/ticket issuance secrets.

If existing internal comparison routes still require `XAI_API_KEY`, deploy
vFinal on a separate App Hosting backend/environment before customer
submission.

```text
Relay SA IAM:
Web/App Hosting SA IAM:
Runtime env proof:
Secret scan result:
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
Preview/log mode:
Rate limit test:
WSS close code 1006 check:
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
verify:acceptance:
```

## Deploy Evidence

- App Hosting Git SHA:
- App Hosting rollout ID:
- Cloud Run relay Git SHA:
- Cloud Run relay revision:
- Cloud Run relay traffic %:

App Hosting and Cloud Run relay must be deployed from the same Git SHA.

## Rollback

1. Stop new invite distribution.
2. Roll App Hosting backend to the previous known-good rollout.
3. Roll Cloud Run relay traffic to the previous known-good revision.
4. Confirm `/api/grok-first-vFinal/session` is unavailable or reverted.
5. Run sensitive log scan for the incident window.
6. Rotate `XAI_RELAY_TICKET_SECRET`, invite signing secret, participant hash
   secret, and `XAI_API_KEY` if exposure is suspected.
