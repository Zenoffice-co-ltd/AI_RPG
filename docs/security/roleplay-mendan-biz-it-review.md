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
  roleplay page after the Firebase App Hosting custom domain reaches ACTIVE.
- `https://voice.mendan.biz/healthz` returns HTTP 200.
- `wss://voice.mendan.biz/api/v3/realtime-relay` requires WebSocket upgrade,
  allowed Origin, expected Host, and a signed short-lived relay ticket.
- Normal HTTP access to `/api/v3/realtime-relay` may return 401, 403, or 426.
  This is expected for unauthenticated or non-upgrade access.

## Data Handling

- Browser does not receive the xAI API key.
- v25 session does not return an xAI ephemeral token.
- Relay ticket TTL is 60 seconds.
- Relay logs metadata only.
- Relay logs must not contain raw ticket, API key, cookie, transcript text,
  prompt, instruction, audio frame, or audio base64.

## Current Cutover Status

- Firebase App Hosting custom domain `roleplay.mendan.biz` has been created for
  backend `projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay`.
- DNS is managed outside GCP by `dnsv.jp`.
- DNS records are pending, so the domain is not yet customer-ready.
- `APP_BASE_URL` must remain on the `hosted.app` URL until DNS resolves, the
  managed certificate is ACTIVE, and the v25 page loads on
  `https://roleplay.mendan.biz`.

## E2E Evidence

- Browser text E2E: pending DNS/TLS ACTIVE
- Browser audio E2E: pending DNS/TLS ACTIVE
- Cloud Logging: pending roleplay.mendan.biz E2E
- SSL/TLS: pending DNS/TLS ACTIVE
- Port: `voice.mendan.biz:443` reachable; `roleplay.mendan.biz:443` pending DNS
