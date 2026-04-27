---
name: adecco-eval-webhook
description: Set up, update, deploy, or verify the Adecco AI roleplay evaluation workflow where ElevenLabs post-call transcription webhooks trigger Claude Sonnet grading and Gmail/HTML email reports. Use for tasks involving AI_RPG, agent_2801kpj49tj1f43sr840cvy17zcc, Cloud Run mendan, Claude evaluation prompts, Secret Manager, Gmail service account delegation, or the Adecco evaluation report email.
---

# Adecco Eval Webhook

Use this skill when working on the Adecco roleplay MVP that connects:

ElevenLabs post-call transcription -> AI_RPG Cloud Run `/api/vendor/eleven/postcall` -> Claude Sonnet evaluation -> Gmail report to `iwase@zenoffice.co.jp`.

## Repositories

- AI_RPG: `C:\dev\AI_RPG` or the active AI_RPG worktree.
- Zapier_GCP_Migration: `C:\dev\Zapier_GCP_Migration`.
- Cloud Run project: `adecco-mendan`.
- Zapier/LLM secrets project: `zapier-transfer`.
- Cloud Run service: `mendan`, region `asia-northeast1`.
- Production endpoint: `https://mendan-mvk3ouxwza-an.a.run.app/api/vendor/eleven/postcall`.
- Target ElevenLabs agent: `agent_2801kpj49tj1f43sr840cvy17zcc`.

## Core Rules

- Keep the evaluator prompts and schema as canonical files; do not rewrite prompt wording casually.
- For Cloud Run, do not rely on local Python or `C:\dev\Zapier_GCP_Migration`; the deployed route must be able to run inside the Node container.
- If runtime files under `scripts/` are needed by Next standalone, make sure Docker copies them into the runner image.
- Preserve sandbox semantics in subject lines. The current report subject should include `[SANDBOX] [AIロープレ評価]`.
- Treat the HTML report file as the visual design template only. The delivered report content must be dynamically rendered from Claude's JSON response (`total_score`, rubric scores, must-capture items, strengths, improvements, learner feedback, and training actions); never send the sample HTML with fixed placeholder scores as the final report.
- Treat email delivery as incomplete until the route returns `mail.ok=true` and the user can visually confirm receipt.
- Keep the ElevenLabs vendor webhook fast. `/api/vendor/eleven/postcall` must acknowledge with `202` after filtering/saving/enqueueing work; Claude evaluation, Conversation Details fallback, and Gmail sending belong in the Cloud Tasks worker `/api/internal/adecco-eval` to avoid ElevenLabs 504 auto-disable.
- Before opening/merging a PR, re-check the user's DOD. Do not treat a visual-template match as sufficient when the user requires data to come from the LLM response.
- If the user asks for "PR作成 -> main merge", verify `gh auth status` first. If `gh` is not authenticated, run the login flow and wait for authentication; do not substitute a direct main push.
- HMAC webhooks may be registered in ElevenLabs, but endpoint-side signature verification is a separate hardening task unless explicitly implemented.

## Implementation Checklist

1. Confirm the current branch, dirty files, target Cloud Run service, and active gcloud account.
2. Confirm `ENABLE_ELEVEN_WEBHOOKS=true`, target agent ID filtering, and transcript extraction from both webhook payload and ElevenLabs Conversation Details API.
3. Run Claude via standard Messages API first. Avoid Structured Outputs unless the API contract has been freshly verified.
4. Validate model output with lightweight top-level JSON checks:
   - required: `total_score`, `rubric_scores`, `must_capture_items`
   - additional: `schema_version`, `session_id`, `scenario_id`, `score_confidence`, `agent_quality_flags`, `learner_feedback`
5. Send Gmail through service account domain-wide delegation when OAuth refresh tokens fail.
6. For HTML report updates, copy the requested HTML into `scripts/adecco_order_hearing_eval/email_templates/` and verify SHA-256 equality with the source file as a design-template integrity check.
7. Render the HTML part dynamically from the parsed Claude JSON while preserving the template layout/styles. Keep plain text as a fallback with raw JSON and validation metadata.
8. For ElevenLabs post-call webhooks, enqueue a Cloud Tasks job and return immediately:
   - vendor route expected response: `status=accepted`, `evaluation=enqueued`, `taskName=...`
   - worker route: `/api/internal/adecco-eval`, protected by `x-queue-shared-secret`
   - worker logs should include `adecco_eval_task_completed` with model, validation, and mail metadata
9. Run typecheck/tests before deploy:
   - `corepack pnpm --filter @top-performer/web typecheck`
   - `corepack pnpm --filter @top-performer/vendors test`
10. Build and deploy Cloud Run, then verify latest revision and health.
11. POST an ElevenLabs-shaped sample payload to the production webhook and confirm the immediate response includes:
    - `status=accepted`
    - `evaluation=enqueued`
    - `taskName=...`
12. Confirm Cloud Run logs for the task worker include:
    - `model=claude-sonnet-4-5-20250929`
    - `validation.ok=true`
    - `mail.routed_to=iwase@zenoffice.co.jp`
    - `mail.delivery=direct`
    - `mail.ok=true`
13. When the user identifies a concrete local JSON file, use that exact file for E2E. Record the input path, generated `sessionId`, validation status, and Gmail message id in the completion note.

## Cloud Run Notes

Use Artifact Registry image tags that describe the change, for example:

```powershell
$tag = "asia-northeast1-docker.pkg.dev/adecco-mendan/roleplay-ui/roleplay-ui:adecco-html-mail-$(Get-Date -Format yyyyMMdd-HHmmss)"
gcloud builds submit --project adecco-mendan --tag $tag .
```

Deploy with the existing required env vars and secrets. Keep these values set for the eval flow:

```text
ENABLE_ELEVEN_WEBHOOKS=true
ADECCO_EVAL_ELEVEN_AGENT_ID=agent_2801kpj49tj1f43sr840cvy17zcc
ADECCO_EVAL_SECRET_PROJECT_ID=zapier-transfer
GMAIL_DELEGATED_USER=iwase@zenoffice.co.jp
APP_ENV=dev
ADECCO_EVAL_PROMPTS_ROOT=/app/scripts/adecco_order_hearing_eval/prompts
ADECCO_EVAL_EMAIL_TEMPLATES_ROOT=/app/scripts/adecco_order_hearing_eval/email_templates
```

Grant the Cloud Run service account access to required cross-project secrets in `zapier-transfer`:

```powershell
gcloud secrets add-iam-policy-binding anthropic-api-key-default --project zapier-transfer --member="serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding gmail-client-secret --project zapier-transfer --member="serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
```

## ElevenLabs Setup

Use the valid ElevenLabs API key from Secret Manager. If `adecco-mendan/ELEVENLABS_API_KEY` is empty or invalid, sync it from `zapier-transfer/ELEVENLABS_API_KEY`.

Create or reuse a workspace webhook:

```powershell
Invoke-RestMethod -Method Post -Uri "https://api.elevenlabs.io/v1/workspace/webhooks" -Headers @{ "xi-api-key" = $apiKey; "Content-Type" = "application/json" } -Body (@{
  settings = @{
    auth_type = "hmac"
    name = "AI_RPG Adecco Eval MVP"
    webhook_url = "https://mendan-mvk3ouxwza-an.a.run.app/api/vendor/eleven/postcall"
  }
} | ConvertTo-Json -Depth 10)
```

Attach it to ConvAI settings:

```powershell
Invoke-RestMethod -Method Patch -Uri "https://api.elevenlabs.io/v1/convai/settings" -Headers @{ "xi-api-key" = $apiKey; "Content-Type" = "application/json" } -Body (@{
  webhooks = @{
    post_call_webhook_id = $webhookId
    events = @("transcript")
    send_audio = $false
  }
} | ConvertTo-Json -Depth 10)
```

## References

- For detailed verification commands and expected outputs, see `references/verification.md`.
