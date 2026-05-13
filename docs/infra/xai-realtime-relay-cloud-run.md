# xAI Realtime Relay on Cloud Run

This runbook publishes the v25 MENDAN relay at `voice.mendan.biz`.

## Service

- Cloud Run service: `xai-realtime-relay`
- Project: `adecco-mendan`
- Region: `us-east1`
- Public host: `voice.mendan.biz`
- Relay path: `/api/v3/realtime-relay`
- Upstream: `wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0`
- Current LB frontend IPv4: `34.149.106.144`

Build the container from the repository root so the workspace package
`@top-performer/grok-realtime-relay-auth` is included in the Docker context.

```bash
IMAGE="gcr.io/adecco-mendan/xai-realtime-relay:$(git rev-parse --short HEAD)"

gcloud builds submit \
  --project=adecco-mendan \
  --config=apps/xai-realtime-relay/cloudbuild.yaml \
  --substitutions=_IMAGE="$IMAGE" \
  .

gcloud run deploy xai-realtime-relay \
  --project=adecco-mendan \
  --region=us-east1 \
  --image="$IMAGE" \
  --service-account=xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --ingress=internal-and-cloud-load-balancing \
  --timeout=3600s \
  --min-instances=1 \
  --concurrency=100 \
  --no-cpu-throttling \
  --env-vars-file=apps/xai-realtime-relay/env.production.example.yaml \
  --update-secrets=XAI_API_KEY=XAI_API_KEY:latest,XAI_RELAY_TICKET_SECRET=XAI_RELAY_TICKET_SECRET:latest
```

Use an env file for deploys because comma-separated origin allowlists are easy
to misparse in shells. Do not set a long backend-service timeout on the
serverless NEG backend; Google Cloud rejects serverless NEG attachment when
the backend service has `timeoutSec: 3600`. Keep the LB backend timeout at the
default `30s`; the WebSocket connection lifetime is controlled by Cloud Run and
the load balancer, not by that HTTP request timeout field.

The service account should be:

```text
xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com
```

Grant `roles/secretmanager.secretAccessor` on:

```text
XAI_API_KEY
XAI_RELAY_TICKET_SECRET
```

## Load Balancer And DNS

Expose Cloud Run through a Global external Application Load Balancer with a
serverless NEG.

```text
Frontend:
  host: voice.mendan.biz
  protocol: HTTPS
  port: 443
  certificate: Google-managed certificate or Certificate Manager

Backend:
  serverless NEG
  Cloud Run service: xai-realtime-relay
  region: us-east1

Routing:
  host voice.mendan.biz
  path /*
  -> xai-realtime-relay

DNS:
  voice.mendan.biz A record -> LB frontend IP
```

Keep Cloud CDN and IAP disabled. Avoid Cloud Armor rules that strip or block
WebSocket upgrades. Enable LB request logs; relay tickets are carried in
`Sec-WebSocket-Protocol`, not URL query parameters.

For the current `mendan.biz` domain, authoritative nameservers are operated by
`dnsv.jp`. Create the load balancer and reserve the global IPv4 address in GCP,
then add the `voice.mendan.biz` A record in the external DNS console. The
Google-managed certificate stays in `PROVISIONING` until that DNS record points
at the load balancer IP.

As of the v25 relay rollout, the required external DNS record is:

```text
voice.mendan.biz.  A  34.149.106.144
```

Before this record is visible publicly, browsers fail the relay connection with
`net::ERR_NAME_NOT_RESOLVED`, the managed certificate reports
`FAILED_NOT_VISIBLE`, and Cloud Run relay logs will show `server.listening`
without `client.connected`.

## Verification

```bash
curl -i https://voice.mendan.biz/healthz
```

Expected: `200 {"ok":true}`.

After App Hosting deploy, run:

```bash
GROK_BROWSER_E2E_BASE_URL=https://mendan.biz \
GROK_BROWSER_E2E_VARIANTS=adecco-roleplay-v25 \
corepack pnpm grok:audio-e2e:browser:text
```

If the app is not yet available on `mendan.biz`, use the App Hosting URL only as
staging/internal evidence.

Cloud Logging DOD:

```text
jsonPayload.scope="grokVoice.realtimeRelay"
jsonPayload.demoSlug="adecco-roleplay-v25"
```

Required phases:

```text
client.connected
ticket.accepted
upstream.connected
first.upstream.audio.delta
```

There should be no `ticket.rejected`, `relay.error`, browser WebSocket 403, or
browser close code 1006 for the verified session.
