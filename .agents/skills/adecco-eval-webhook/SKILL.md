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
- Treat email delivery as incomplete until the Cloud Tasks worker completes with `mail.ok=true` and the user can visually confirm receipt.
- Keep the ElevenLabs vendor webhook fast. `/api/vendor/eleven/postcall` must acknowledge with `202` after filtering/saving/enqueueing work; Claude evaluation, Conversation Details fallback, and Gmail sending belong in the Cloud Tasks worker `/api/internal/adecco-eval` to avoid ElevenLabs 504 auto-disable.
- After the async Cloud Tasks split, do not expect `mail.ok=true` in the vendor webhook response. The webhook DOD is quick `202` with `evaluation=enqueued`; email DOD is confirmed from the worker log `adecco_eval_task_completed` plus inbox receipt.
- If ElevenLabs auto-disables the webhook after repeated failures, first fix/deploy the endpoint, then re-enable the existing webhook and confirm `is_disabled=false` and `is_auto_disabled=false`. A stale `most_recent_failure_error_code=504` can remain as historical metadata after recovery.
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
    - response latency should normally be a few seconds or less; it must not wait for Claude/Gmail
12. Confirm Cloud Run logs for the task worker include:
    - `model=claude-sonnet-4-5-20250929`
    - `validation.ok=true`
    - `mail.routed_to=iwase@zenoffice.co.jp`
    - `mail.delivery=direct`
    - `mail.ok=true`
13. Confirm the user sees the corresponding email in the inbox. Use received time and Gmail message id from logs to disambiguate multiple E2E emails.
14. When the user identifies a concrete local JSON file, use that exact file for E2E. Record the input path, generated `sessionId`, validation status, and Gmail message id in the completion note.

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

Re-enable an auto-disabled webhook after the endpoint has been fixed and deployed:

```powershell
$webhookId = "8de14d81bc624dcfa37e02f1b9e9a17e"
Invoke-RestMethod -Method Patch -Uri "https://api.elevenlabs.io/v1/workspace/webhooks/$webhookId" -Headers @{ "xi-api-key" = $apiKey; "Content-Type" = "application/json" } -Body (@{
  is_disabled = $false
  name = "AI_RPG Adecco Eval MVP"
  retry_enabled = $true
} | ConvertTo-Json)

$all = Invoke-RestMethod -Method Get -Uri "https://api.elevenlabs.io/v1/workspace/webhooks" -Headers @{ "xi-api-key" = $apiKey; accept = "application/json" }
$webhooks = if ($all.webhooks) { $all.webhooks } else { $all }
$webhooks | Where-Object { $_.webhook_id -eq $webhookId -or $_.id -eq $webhookId } | Select-Object name,webhook_id,is_disabled,is_auto_disabled,retry_enabled,most_recent_failure_error_code
```

## ⚠️ Workspace webhook fires on ALL agents — temporary detach for benchmarking

**Critical operational hazard (logged 2026-05-03)**: the workspace-level `post_call_webhook_id` (`8de14d81bc624dcfa37e02f1b9e9a17e`, `AI_RPG Adecco Eval MVP`) fires on every ConvAI conversation in the workspace, **including any temporary or test agent**. Running a quality/latency benchmark against ConvAI without disabling this webhook caused 72 unintended evaluation runs against `iwase@zenoffice.co.jp` in a single afternoon (each consumes Claude Sonnet API credit + sends an email).

Per-agent override does **not** suppress this. We verified that PATCHing `platform_settings.workspace_overrides.webhooks.events = []` on the agent left `events: ["transcript"]` in the response. Only workspace-level detach reliably stops post-call events.

### Safe pattern: detach → run → restore

```typescript
// Use the helpers shipped 2026-05-03 in packages/vendors/src/elevenlabs.ts:
//   ElevenLabsClient.getConvaiSettings()
//   ElevenLabsClient.setConvaiPostCallWebhookId(webhookId | null, options)
//
// Always wrap detach in try/finally so restore runs even on crash.

const settings = await el.getConvaiSettings();
const original = settings.webhooks; // snapshot post_call_webhook_id, events, transcript_format, send_audio
try {
  await el.setConvaiPostCallWebhookId(null, {
    events: original.events,
    transcriptFormat: original.transcript_format,
    sendAudio: original.send_audio,
  });
  // ... run ConvAI traffic that should NOT trigger the eval webhook
} finally {
  await el.setConvaiPostCallWebhookId(original.post_call_webhook_id, {
    events: original.events,
    transcriptFormat: original.transcript_format,
    sendAudio: original.send_audio,
  });
}
```

Equivalent PowerShell for emergency manual recovery (when a script crashed mid-run and webhook stayed detached):

```powershell
$apiKey = (gcloud secrets versions access latest --secret=ELEVENLABS_API_KEY --project=zapier-transfer)
$body = @{ webhooks = @{
  post_call_webhook_id = "8de14d81bc624dcfa37e02f1b9e9a17e"
  events = @("transcript")
  transcript_format = "json"
  send_audio = $false
} } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method PATCH -Uri "https://api.elevenlabs.io/v1/convai/settings" `
  -Headers @{ "xi-api-key"=$apiKey; "content-type"="application/json"; "accept"="application/json" } `
  -Body $body
```

### When to detach

- ✅ Running `pnpm benchmark:quality-latency -- --elevenlabs-agent` (the CLI handles detach/restore automatically in `finally`)
- ✅ Any other ad-hoc ConvAI WebSocket / `/v1/convai/conversation` traffic for testing
- ✅ Creating a temporary benchmark agent via `createAgent` and sending it user_messages
- ❌ Production traffic (the eval flow needs the webhook attached)

### Trade-off while detached

While `post_call_webhook_id` is `null`, **production conversations during the detach window also skip the eval pipeline**. Keep detach windows short (a single benchmark run, typically 5–30 minutes). If a production conversation lands during the window and needs evaluation, re-trigger it via the worker route `/api/internal/adecco-eval` after restore.

## ⚠️ Do not benchmark on the production agent directly

The production agent `agent_2801kpj49tj1f43sr840cvy17zcc` is tuned for the 住宅設備メーカー scenario with a fixed `first_message`. Sending generic test prompts to it returns the **same opening greeting** regardless of the user message, and the speed measurement reflects only how fast that fixed greeting plays back — not the underlying GLM-4.5 + ElevenLabs TTS performance.

To benchmark the same LLM + voice + TTS stack against generic cases, use the temporary-agent flow in `pnpm benchmark:quality-latency -- --elevenlabs-agent --create-temp-agent`. It clones `glm-45-air-fp8` + voice `g6xIsTj2HwM6VR4iXFCw` + `eleven_v3_conversational` from the production agent, runs the benchmark with `QUALITY_LATENCY_SYSTEM_PROMPT`, and deletes the temp agent in `finally`.

## Native voice lanes that DO NOT need detach

Other native-voice models (xAI Grok Voice Realtime, OpenAI Realtime, Google Gemini Live) connect directly to their own provider — they do **not** flow through the ElevenLabs workspace, so they do not trigger the AI_RPG Adecco eval webhook. The `chat-orb-web` browser UI's xAI Grok Voice lane (`/api/voice-realtime` proxy) and `scripts/grok-voice-batch.ts` therefore do not require workspace webhook detach. The detach/restore protocol above applies **only** to ConvAI traffic against agents in this ElevenLabs workspace.

## Related skills

- `ai-rpg-quality-latency-benchmark` — Phase 6 Stage 3 LLM × TTS Pareto benchmark, includes the ElevenLabs ConvAI lane that uses the detach/restore pattern above.
- `ai-rpg-orb-chat-verification` — interactive chat tooling for hands-on Stage 3 quality verification. Includes the xAI Grok Voice native lane.

## References

- For detailed verification commands and expected outputs, see `references/verification.md`.
