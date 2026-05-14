# roleplay.mendan.biz IT Review Notes

## Customer Allowlist

- `https://roleplay.mendan.biz` TCP 443
- `https://voice.mendan.biz` TCP 443
- `wss://voice.mendan.biz` TCP 443
- Browser permission: microphone

## Not Required

- Direct browser access to `https://api.x.ai`
- Direct browser access to `wss://api.x.ai`
- Customer access to `https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app`

The `hosted.app` URL remains available only for internal rollback and
verification during the custom-domain transition.

## OWASP ZAP Scope

Allowed:

- Passive scan
- Baseline scan
- SSL/TLS certificate inspection
- TCP 443 reachability checks

Conditional:

- Authenticated active scan only with an agreed time window, target paths, and
  request rate.

Not allowed without separate approval:

- DoS or load testing
- WebSocket fuzzing
- Credential stuffing
- Destructive testing

## Expected Responses

- `https://roleplay.mendan.biz/demo/adecco-roleplay-v25` should load the v25
  roleplay page.
- `https://voice.mendan.biz/healthz` returns HTTP 200.
- `wss://voice.mendan.biz/api/v3/realtime-relay` requires WebSocket upgrade,
  allowed Origin, expected Host, and a signed short-lived relay ticket.
- Normal HTTP access to `/api/v3/realtime-relay` may return 401, 403, or 426.
  This is expected for unauthenticated or non-upgrade access.

## Data Handling

- Browser does not receive the xAI credential.
- v25 session does not return an xAI ephemeral token.
- Relay ticket TTL is 60 seconds.
- Relay logs metadata only.
- Relay logs must not contain raw ticket, API credential, cookie, transcript
  text, prompt, instruction, base64 media payloads, or audio frames.

## Current Cutover Status

- Firebase App Hosting custom domain `roleplay.mendan.biz` has been created for
  backend `projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay`.
- DNS is managed outside GCP by `dnsv.jp`.
- DNS resolves to the Firebase App Hosting assigned address.
- App Hosting reports `HOST_ACTIVE`, `OWNERSHIP_ACTIVE`, and `CERT_ACTIVE`.
- `APP_BASE_URL` is deployed as `https://roleplay.mendan.biz`.
- `https://roleplay.mendan.biz/demo/adecco-roleplay-v25` loads successfully.

## E2E Evidence

- Browser text E2E: PASS
  (`out/grok_voice_browser_audio_e2e/20260514T055841Z/summary.json`)
- Browser audio E2E: PASS
  (`out/grok_voice_browser_audio_e2e/20260514T055934Z/summary.json`)
- Cloud Logging: PASS for `client.connected`, `ticket.accepted`, and
  `upstream.connected`
- SSL/TLS: PASS for certificate SAN `roleplay.mendan.biz`
- Port: `roleplay.mendan.biz:443` reachable; `voice.mendan.biz:443` reachable
