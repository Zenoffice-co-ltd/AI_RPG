# Deploy: AI Roleplay UI

Production-like Adecco Orb deployments are pinned to:

- GCP project: `adecco-mendan`
- Region: `asia-northeast1`
- Cloud Run service: `roleplay-ui`

Do not deploy this UI to `rhc-analytics-prod`. Do not rely on the active gcloud
project for production commands; pass `--project adecco-mendan` explicitly.

Preflight:

```bash
gcloud config get-value project
gcloud config set project adecco-mendan
gcloud projects describe adecco-mendan --project adecco-mendan
```

## Required APIs

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
  --project adecco-mendan
```

## Artifact Registry

```bash
gcloud artifacts repositories create roleplay-ui \
  --repository-format=docker \
  --location=asia-northeast1 \
  --project adecco-mendan
```

## Secret Manager

```bash
printf "%s" "$ELEVENLABS_API_KEY" | gcloud secrets create ELEVENLABS_API_KEY \
  --data-file=- \
  --project adecco-mendan

printf "%s" "$DEMO_ACCESS_TOKEN" | gcloud secrets create demo-access-token \
  --data-file=- \
  --project adecco-mendan

gcloud secrets add-iam-policy-binding ELEVENLABS_API_KEY \
  --project adecco-mendan \
  --member serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com \
  --role roles/secretmanager.secretAccessor

gcloud secrets add-iam-policy-binding demo-access-token \
  --project adecco-mendan \
  --member serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com \
  --role roles/secretmanager.secretAccessor
```

Production Cloud Run must use `ELEVENLABS_API_KEY` and `demo-access-token`
from Secret Manager in `adecco-mendan`. The app still supports a local/dev ADC
fallback for developer machines, but `NODE_ENV=production` requires the
`ELEVENLABS_API_KEY` environment variable injected by Cloud Run and does not use
cross-project fallback.

## Build And Deploy

The web app pins `livekit-client` to `2.16.1` through the root `pnpm`
overrides. Keep this pin unless the upstream voice endpoint is confirmed to
support LiveKit's newer `/rtc/v1` signaling path.

```bash
gcloud builds submit \
  --tag asia-northeast1-docker.pkg.dev/adecco-mendan/roleplay-ui/roleplay-ui:latest \
  --project adecco-mendan

gcloud run deploy roleplay-ui \
  --image asia-northeast1-docker.pkg.dev/adecco-mendan/roleplay-ui/roleplay-ui:latest \
  --region asia-northeast1 \
  --project adecco-mendan \
  --allow-unauthenticated \
  --service-account firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com \
  --set-env-vars ELEVENLABS_AGENT_ID=agent_2801kpj49tj1f43sr840cvy17zcc,ELEVENLABS_BRANCH_ID=agtbrch_9701kpj49vbdepjr8szvwc6w7e6b,ELEVENLABS_ENVIRONMENT=production,NEXT_PUBLIC_APP_NAME="AI Roleplay",NEXT_PUBLIC_DEFAULT_SCENARIO_ID=adecco-orb \
  --set-secrets ELEVENLABS_API_KEY=ELEVENLABS_API_KEY:latest,DEMO_ACCESS_TOKEN=demo-access-token:latest
```

`PORT` is respected by the standalone Next.js server. Verify `/api/healthz` returns 200 after deployment.

## Access Cookie For Smoke

The demo route is protected by `DEMO_ACCESS_TOKEN`. For browser smoke, open:

```txt
https://mendan-mvk3ouxwza-an.a.run.app/demo/adecco-roleplay/access
```

Submit the demo token once. The app stores an HttpOnly `Path=/demo`
SameSite=Lax cookie, then redirects to `/demo/adecco-roleplay`.

For command-line token API checks, keep the token out of logs:

```bash
BASE="$(gcloud run services describe roleplay-ui --region asia-northeast1 --project adecco-mendan --format='value(status.url)')"
TOKEN="$(gcloud secrets versions access latest --secret=demo-access-token --project=adecco-mendan)"
curl -s -c cookie.txt -X POST -d "token=$TOKEN" "$BASE/demo/adecco-roleplay/access" >/dev/null
curl -s -b cookie.txt \
  -H "Origin: $BASE" \
  -H "Referer: $BASE/demo/adecco-roleplay" \
  -H "Content-Type: application/json" \
  -d '{"scenarioId":"adecco-orb","participantName":"demo-user"}' \
  "$BASE/api/voice/session-token"
rm -f cookie.txt
```

## Rollback

```bash
gcloud run revisions list \
  --service roleplay-ui \
  --region asia-northeast1 \
  --project adecco-mendan

gcloud run services update-traffic roleplay-ui \
  --region asia-northeast1 \
  --project adecco-mendan \
  --to-revisions REVISION_NAME=100
```

## Custom Domain Options

Cloud Run direct domain mapping is acceptable for preview use. For customer-facing demos, prefer either Firebase Hosting rewrites to Cloud Run or an HTTPS Load Balancer in front of Cloud Run.

Firebase Hosting rewrite outline:

```json
{
  "hosting": {
    "rewrites": [
      { "source": "**", "run": { "serviceId": "roleplay-ui", "region": "asia-northeast1" } }
    ]
  }
}
```

Load Balancer option: create a serverless NEG for the Cloud Run service, attach it to an HTTPS load balancer, and terminate TLS on the customer domain.

## Customer Demo Checklist

- GCP project is `adecco-mendan`; no deploy was made to `rhc-analytics-prod`.
- Cloud Run service is `roleplay-ui` in `asia-northeast1`.
- Runtime secrets `ELEVENLABS_API_KEY` and `DEMO_ACCESS_TOKEN` come from
  `adecco-mendan` Secret Manager.
- `/api/healthz` returns 200.
- `/demo/adecco-roleplay` initial live transcript is empty and shows no hidden
  history, voice settings, mock tool, transcript `...`, or clip icon controls.
- Real Chrome microphone smoke passes for agent audio, agent transcript, user
  voice transcript, composer response, mute ON/OFF, end session, and new
  conversation.
- Browser-visible UI, API responses, console, and Cloud Run logs do not expose
  API keys, tokens, provider names, agent id, branch id, or raw SDK objects.
