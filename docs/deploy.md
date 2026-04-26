# Deploy: AI Roleplay UI

## Required APIs

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com
```

## Artifact Registry

```bash
gcloud artifacts repositories create roleplay-ui \
  --repository-format=docker \
  --location=asia-northeast1
```

## Secret Manager

```bash
printf "%s" "$ELEVENLABS_API_KEY" | gcloud secrets create elevenlabs-api-key --data-file=-
```

Store `DEMO_ACCESS_TOKEN` as a secret or inject it as a Cloud Run env var. Do not expose the API key in public client env.

## Build And Deploy

```bash
gcloud builds submit \
  --tag asia-northeast1-docker.pkg.dev/$PROJECT_ID/roleplay-ui/roleplay-ui:latest

gcloud run deploy roleplay-ui \
  --image asia-northeast1-docker.pkg.dev/$PROJECT_ID/roleplay-ui/roleplay-ui:latest \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars ELEVENLABS_AGENT_ID=agent_2801kpj49tj1f43sr840cvy17zcc,ELEVENLABS_BRANCH_ID=agtbrch_9701kpj49vbdepjr8szvwc6w7e6b,ELEVENLABS_ENVIRONMENT=production,NEXT_PUBLIC_APP_NAME="AI Roleplay",NEXT_PUBLIC_DEFAULT_SCENARIO_ID=adecco-orb \
  --set-secrets ELEVENLABS_API_KEY=elevenlabs-api-key:latest
```

`PORT` is respected by the standalone Next.js server. Verify `/api/healthz` returns 200 after deployment.

## Rollback

```bash
gcloud run revisions list --service roleplay-ui --region asia-northeast1
gcloud run services update-traffic roleplay-ui \
  --region asia-northeast1 \
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
