# roleplay.mendan.biz Custom Domain Closeout

## Summary

- Goal: move the customer-facing v25 app URL to `https://roleplay.mendan.biz`
  while keeping the relay on `wss://voice.mendan.biz/api/v3/realtime-relay`.
- Branch: `codex/roleplay-mendan-biz-custom-domain`
- Baseline commit: `11bd8e748cde4a4cc6a78b106ab2c42239ecb101`
- Date: 2026-05-14
- Operator: Codex
- Current status: `BLOCKED_DNS`

## Official Docs Checked

```yaml
firebase_app_hosting_custom_domain:
  official_doc_checked: true
  doc_url: https://firebase.google.com/docs/app-hosting/custom-domain
  selected_method: Firebase App Hosting custom domain direct assignment
  backend: projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay
  certificate_type: Firebase App Hosting managed SSL certificate
  certificate_status: CERT_VALIDATING
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
| DNS provider | `dnsv.jp` authoritative nameservers |
| DNS status | `BLOCKED_DNS` |
| TLS status | `BLOCKED_DNS`; certificate is `CERT_VALIDATING` |
| Port 443 status | `voice.mendan.biz:443` PASS; `roleplay.mendan.biz:443` pending DNS |

No Cloud DNS managed zone for `mendan.biz` exists in `adecco-mendan` or
`zapier-transfer`. No Value Domain / dnsv.jp DNS API credential was found in the
checked Google Secret Manager projects, so DNS must be updated by a DNS operator
or by providing an approved DNS API credential through the repository secret
flow. Value Domain's official API documentation is
`https://www.value-domain.com/api/doc/domain/`.

## Required DNS Records

Firebase App Hosting created custom domain
`projects/adecco-mendan/locations/asia-east1/backends/adecco-roleplay/domains/roleplay.mendan.biz`
and reported the following required DNS updates.

| Type | Name | Value | Action |
|---|---|---|---|
| A | `roleplay.mendan.biz` | `35.219.200.61` | ADD |
| TXT | `roleplay.mendan.biz` | `fah-claim=004-02-0d7d9b03-49a5-46a4-8022-c8a78efcafad` | ADD |
| CNAME | `_acme-challenge_7o5w5quluuyscfoe.roleplay.mendan.biz.` | `124e1455-6a0a-4ced-b50e-b104807eb7d1.16.authorize.certificatemanager.goog.` | ADD |

Do not remove `voice.mendan.biz A 34.149.106.144`.

## Current App Hosting State

- `APP_BASE_URL` remains
  `https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app`.
- This is intentional. The switch to `https://roleplay.mendan.biz` must happen
  only after DNS resolves, the managed certificate is ACTIVE, and the v25 page
  loads successfully on `roleplay.mendan.biz`.
- App Hosting backend location was confirmed from backend metadata, not inferred
  from `apphosting.yaml`: `asia-east1`.
- `apphosting.yaml` still contains `GCLOUD_LOCATION=asia-northeast1`; that value
  was not changed as part of this DNS-blocked closeout.

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

Not run against `roleplay.mendan.biz` because DNS is not yet resolving.

Required post-DNS command shape:

```bash
curl -sS https://roleplay.mendan.biz/api/v3/session \
  -X POST \
  -H "content-type: application/json" \
  -H "origin: https://roleplay.mendan.biz" \
  -H "referer: https://roleplay.mendan.biz/demo/adecco-roleplay-v25" \
  -H "cookie: roleplay_api_access=<SIG>" \
  -d '{"demoSlug":"adecco-roleplay-v25"}'
```

Expected summary:

| Field | Expected |
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
| Browser text E2E with `roleplay.mendan.biz` | BLOCKED_DNS | DNS records pending |
| Browser audio E2E with `roleplay.mendan.biz` | BLOCKED_DNS | DNS records pending |
| Cloud Logging required phases | BLOCKED_DNS | requires roleplay.mendan.biz E2E |
| Browser direct `api.x.ai` | BLOCKED_DNS | requires roleplay.mendan.biz E2E |
| v23/v4/v5 direct path | Not rerun | no runtime contract changed |

## Security

- Customer browser allowlist:
  - `https://roleplay.mendan.biz` TCP 443
  - `https://voice.mendan.biz` TCP 443
  - `wss://voice.mendan.biz` TCP 443
- Direct browser access to `api.x.ai`: not required for v25.
- `hosted.app`: internal rollback and verification only.
- Sensitive diff grep: pending after docs-only PR.
- Raw Cloud Logging JSON, secret values, relay tickets, cookies, transcripts,
  audio frames, and screenshots were not committed.

## ZAP / SSL / Port Notes

- ZAP passive/baseline scan: allowed.
- ZAP active scan: prior coordination required for time window, paths, and
  request rate.
- WebSocket fuzzing/load testing: not allowed without separate approval.
- SSL/TLS check: pending DNS/TLS ACTIVE.
- Port check: `voice.mendan.biz:443` reachable; `roleplay.mendan.biz:443`
  pending DNS.

## Final Verdict

- `roleplay.mendan.biz` domain cutover: `BLOCKED_DNS`
- v25 relay path: previously PASS on `hosted.app` + `voice.mendan.biz`; not
  rerun on `roleplay.mendan.biz`
- customer-facing allowlist simplification: docs prepared, pending DNS/TLS
- remaining risks:
  - DNS records must be added at `dnsv.jp`.
  - If the Value Domain DNS API is used later, fetch and preserve the full
    existing record set before updating because the API replaces the DNS record
    text as a whole.
  - Wait for Firebase App Hosting host, ownership, and certificate states to
    become ACTIVE.
  - Only then change `APP_BASE_URL`, deploy, run roleplay-domain E2E, Cloud
    Logging assertions, and final acceptance.
