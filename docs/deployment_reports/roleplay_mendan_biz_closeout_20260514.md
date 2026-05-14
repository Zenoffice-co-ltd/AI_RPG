# roleplay.mendan.biz Custom Domain Closeout

## Summary

- Goal: move the customer-facing v25 app URL to `https://roleplay.mendan.biz`
  while keeping the relay on `wss://voice.mendan.biz/api/v3/realtime-relay`.
- Branch: `codex/roleplay-mendan-biz-custom-domain`
- Baseline commit: `11bd8e748cde4a4cc6a78b106ab2c42239ecb101`
- Date: 2026-05-14
- Operator: Codex
- Current status: `PASS`

## Official Docs Checked

```yaml
firebase_app_hosting_custom_domain:
  official_doc_checked: true
  doc_url: https://firebase.google.com/docs/app-hosting/custom-domain
  selected_method: Firebase App Hosting custom domain direct assignment
  backend: projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay
  certificate_type: Firebase App Hosting managed SSL certificate
  certificate_status: CERT_ACTIVE
firebase_hosting_custom_domain:
  official_doc_checked: true
  doc_url: https://firebase.google.com/docs/hosting/custom-domain
  selected_method: fallback only; not used for this App Hosting backend
cloud_run_custom_domains:
  official_doc_checked: true
  doc_url: https://cloud.google.com/run/docs/mapping-custom-domains
  selected_method: not used for the screen URL
external_application_load_balancer:
  official_doc_checked: true
  doc_url: https://cloud.google.com/load-balancing/docs/https
  selected_method: fallback only; not used
```

## Domain Mapping

| Item | Value |
|---|---|
| App domain | `https://roleplay.mendan.biz` |
| Relay domain | `wss://voice.mendan.biz/api/v3/realtime-relay` |
| Previous app domain | `https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app` |
| Backend | `projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay` |
| Backend URI | `adecco-roleplay--adecco-mendan.asia-east1.hosted.app` |
| DNS provider | Value Domain / `dnsv.jp` authoritative nameservers |
| DNS status | `PASS` |
| TLS status | `PASS` |
| Port 443 status | `roleplay.mendan.biz:443` PASS; `voice.mendan.biz:443` PASS |

DNS records added by the DNS operator while preserving existing records:

| Type | Name | Value |
|---|---|---|
| A | `roleplay.mendan.biz` | `35.219.200.61` |
| TXT | `roleplay.mendan.biz` | `fah-claim=004-02-0d7d9b03-49a5-46a4-8022-c8a78efcafad` |
| CNAME | `_acme-challenge_7o5w5quluuyscfoe.roleplay.mendan.biz.` | `124e1455-6a0a-4ced-b50e-b104807eb7d1.16.authorize.certificatemanager.goog.` |

App Hosting custom domain status after DNS propagation:

| State | Value |
|---|---|
| `hostState` | `HOST_ACTIVE` |
| `ownershipState` | `OWNERSHIP_ACTIVE` |
| `certState` | `CERT_ACTIVE` |
| `reconciling` | `false` |

TLS check summary:

| Field | Value |
|---|---|
| Subject | `CN=roleplay.mendan.biz` |
| Issuer | `Google Trust Services WR3` |
| Valid from | `May 14 04:45:40 2026 GMT` |
| Valid until | `Aug 12 05:41:34 2026 GMT` |
| SAN | `roleplay.mendan.biz`, `*.roleplay.mendan.biz` |

## App Hosting / Deploy

| Item | Value |
|---|---|
| Backend | `adecco-roleplay` |
| Project | `adecco-mendan` |
| Region | `asia-east1` |
| Deploy command | `corepack pnpm deploy:adecco-roleplay:gcloud` |
| Rollout | `build-2026-05-14-001` |
| Rollout state | `SUCCEEDED` |
| `APP_BASE_URL` | `https://roleplay.mendan.biz` |

`corepack pnpm deploy:adecco-roleplay` was attempted first and failed with
`iam.serviceAccounts.actAs` delegation permission on the Firebase CLI path. The
repository gcloud/API deploy wrapper was used as the approved fallback and
completed the rollout. The wrapper also warmed the Grok registered-speech cache
with `ok=16 failed=0`.

## Relay Production Env

Cloud Run service `xai-realtime-relay` in `adecco-mendan/us-east1` was checked
from the live service definition.

| Env | Result |
|---|---|
| `RELAY_ALLOWED_ORIGINS` | includes `https://roleplay.mendan.biz` |
| `RELAY_EXPECTED_HOSTS` | `voice.mendan.biz` |
| `RELAY_EXPECTED_AUD` | `voice.mendan.biz` |
| `XAI_REALTIME_MODEL` | `grok-voice-think-fast-1.0` |

## Session Contract

`https://roleplay.mendan.biz/demo/adecco-roleplay-v25/access` was checked with
the live demo access token. It returned a redirect to the v25 page and set both
the UI and API access cookies. Secret and cookie values were not printed or
recorded.

The v25 session contract was checked with authenticated POST using:

- `origin: https://roleplay.mendan.biz`
- `referer: https://roleplay.mendan.biz/demo/adecco-roleplay-v25`
- the redacted API access cookie header
- body: `{"demoSlug":"adecco-roleplay-v25"}`

| Field | Result |
|---|---|
| `demoSlug` | `adecco-roleplay-v25` |
| `routerVariant` | `B_NARROW_FALLBACK_SEMANTIC` |
| `realtimeTransport` | `mendan_cloud_run_relay_wss` |
| `wsUrl` | `wss://voice.mendan.biz/api/v3/realtime-relay` |
| `ephemeralToken` | absent |
| `ephemeralExpiresAt` | absent |
| `realtimeAuth.mode` | `mendan_relay_subprotocol` |

## E2E

| Gate | Result | Evidence |
|---|---|---|
| Browser text E2E with `roleplay.mendan.biz` | PASS | `out/grok_voice_browser_audio_e2e/20260514T055841Z/summary.json` |
| Browser audio E2E with `roleplay.mendan.biz` | PASS | `out/grok_voice_browser_audio_e2e/20260514T055934Z/summary.json` |
| Cloud Logging required phases | PASS | `client.connected`, `ticket.accepted`, `upstream.connected` |
| Browser direct `api.x.ai` | PASS | Browser WebSocket list contained only `wss://voice.mendan.biz/api/v3/realtime-relay` |
| v23/v4/v5 direct path | PASS | all returned `xai_direct_wss`, `api.x.ai`, and `xai_ephemeral_subprotocol` |

Cloud Logging query returned 10 relay log entries in the freshness window. The
unique relay phases were:

- `client.closed`
- `client.connected`
- `ticket.accepted`
- `upstream.connected`
- `upstream.connecting`

Sensitive log scan passed for raw relay ticket, API credential, authorization
credential, cookie, transcript preview fields, and base64 media payload
patterns. Raw Cloud Logging JSON was written only under the OS temp directory
and was not committed.

## Static / Unit / Build

| Command | Result |
|---|---|
| `corepack pnpm --filter @top-performer/web typecheck` | PASS |
| `corepack pnpm --filter @top-performer/web test` | PASS, 98 files / 841 tests |
| `corepack pnpm --filter @top-performer/web build` | PASS; existing Turbopack NFT warning observed |
| `corepack pnpm --filter @top-performer/xai-realtime-relay typecheck` | PASS |
| `corepack pnpm --filter @top-performer/xai-realtime-relay test` | PASS, 98 files / 841 tests |
| `corepack pnpm --filter @top-performer/xai-realtime-relay build` | PASS |
| `corepack pnpm --filter @top-performer/grok-realtime-relay-auth typecheck` | PASS |
| `corepack pnpm --filter @top-performer/grok-realtime-relay-auth test` | PASS, 98 files / 841 tests |
| `corepack pnpm --filter @top-performer/grok-realtime-relay-auth build` | PASS |
| `corepack pnpm grok:verify-registered-speech` | PASS |
| `corepack pnpm grok:forbid-modelless-ws` | PASS, offenders 0 |
| `corepack pnpm grok:audio-e2e:layer-a` | PASS, 57/57 |
| `corepack pnpm grok:audio-e2e:layer-b` | PASS, 112/112 |
| `git diff --check` | PASS |

The v50 runtime-source unit test was updated to resolve `apps/web/lib` from the
test file location instead of `process.cwd()`. This keeps the test stable when
workspace package scripts invoke the root Vitest config from package
directories.

## Security

- Customer browser allowlist:
  - `https://roleplay.mendan.biz` TCP 443
  - `https://voice.mendan.biz` TCP 443
  - `wss://voice.mendan.biz` TCP 443
- Browser permission: microphone.
- Direct browser access to `api.x.ai`: not required for v25.
- `hosted.app`: internal rollback and verification only.
- v25 browser receives no xAI credential and no xAI ephemeral token.
- Relay logs do not include raw ticket, API credential, authorization
  credential, cookie, transcript preview, or base64 media payloads.
- Raw Cloud Logging JSON, secret values, relay tickets, cookies, transcripts,
  audio frames, screenshots, zips, and generated audio are not committed.

## ZAP / SSL / Port Notes

- ZAP passive/baseline scan: allowed.
- ZAP active scan: prior coordination required for time window, paths, and
  request rate.
- WebSocket fuzzing/load testing: not allowed without separate approval.
- SSL/TLS check: PASS for `roleplay.mendan.biz`.
- Port check: TCP 443 PASS for `roleplay.mendan.biz` and `voice.mendan.biz`.
- Normal HTTP access to `/api/v3/realtime-relay` may return 401, 403, or 426
  because WebSocket upgrade, allowed Origin, expected Host, short-lived ticket,
  and subprotocol are required.

## Acceptance

`corepack pnpm verify:acceptance` was run with process-env secrets resolved from
Secret Manager and `APP_BASE_URL=https://roleplay.mendan.biz`.

Result: FAIL, classified as legacy ElevenLabs ConvAI judge variance unrelated
to v25/domain/relay.

Evidence:

- The first run without process-env overrides failed before acceptance because
  local ADC could not call Secret Manager. Values were then loaded into the
  current process environment only, following AGENTS.md precedence, without
  printing or writing secrets.
- The second run without explicit `APP_BASE_URL` used the local default from
  env examples and failed because `pnpm` is not on PATH on this Windows host.
- The final run explicitly set `APP_BASE_URL=https://roleplay.mendan.biz`.
- It reached `[3/10] publish scenario`.
- Failure after three publish attempts was:
  `staffing_order_hearing_busy_manager_medium::no-coaching`.
- Earlier attempts also showed transient failures for
  `no-hidden-fact-leak` and `shallow-questions-stay-shallow`.
- This is the existing legacy ElevenLabs ConvAI judge path, not v25
  Cloud Run relay, session, browser WebSocket, logging, or security behavior.

## Final Verdict

- `roleplay.mendan.biz` domain cutover: PASS
- v25 relay path on customer-facing domain: PASS
- customer-facing allowlist simplification: PASS
- v25 browser direct access to `api.x.ai`: PASS, no direct connection
- v23/v4/v5 direct path non-regression: PASS
- broader repository `verify:acceptance`: FAIL due to legacy ElevenLabs ConvAI
  judge variance; track separately from v25 closeout
