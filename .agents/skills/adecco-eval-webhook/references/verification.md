# Verification Reference

## Health

```powershell
Invoke-RestMethod -Method Get -Uri "https://mendan-mvk3ouxwza-an.a.run.app/api/healthz"
gcloud run services describe mendan --project adecco-mendan --region asia-northeast1 --format="value(status.latestReadyRevisionName,status.url)"
```

## ElevenLabs Settings

```powershell
$apiKey = (gcloud secrets versions access latest --secret=ELEVENLABS_API_KEY --project=adecco-mendan).Trim()
$hooks = Invoke-RestMethod -Method Get -Uri "https://api.elevenlabs.io/v1/workspace/webhooks?include_usages=true" -Headers @{ "xi-api-key" = $apiKey }
$settings = Invoke-RestMethod -Method Get -Uri "https://api.elevenlabs.io/v1/convai/settings" -Headers @{ "xi-api-key" = $apiKey }
@{ webhooks=$hooks; settings=$settings.webhooks } | ConvertTo-Json -Depth 20
```

Expected settings:

```json
{
  "post_call_webhook_id": "<webhook id>",
  "events": ["transcript"],
  "send_audio": false
}
```

## Webhook Smoke

Build a payload from `scripts/adecco_order_hearing_eval/fixtures/sample_transcript.json` and POST it to:

```text
https://mendan-mvk3ouxwza-an.a.run.app/api/vendor/eleven/postcall
```

Expected response fields:

```text
status=accepted
evaluation=enqueued
taskName=<Cloud Tasks task name>
sessionId=<session id>
conversationId=<conversation id>
agentId=agent_2801kpj49tj1f43sr840cvy17zcc
```

The vendor route must return quickly with HTTP 202. Do not expect Claude scoring
or Gmail delivery fields in this response; those run asynchronously in the
Cloud Tasks worker at `/api/internal/adecco-eval`.

Confirm email delivery from the worker log `adecco_eval_task_completed`:

```text
model=claude-sonnet-4-5-20250929
validation.ok=true
mail.routed_to=iwase@zenoffice.co.jp
mail.delivery=direct
mail.ok=true
```

The shared Adecco evaluator currently emits customer criteria v2:
`schema_version=adecco_order_hearing_eval_v2`. Validation should include
`must_capture_groups`, `next_training_actions`, `modality_limitations`, and
`sales_compliance_flags`; these are also used by v50-7/v51 browser evaluation.

When the user points to a specific JSON file such as an 8:06-generated temp file, inspect it first. If it is a transcript array, wrap it in an ElevenLabs-shaped `post_call_transcription` payload with:

```text
data.agent_id=agent_2801kpj49tj1f43sr840cvy17zcc
data.conversation_id=<test id>
data.transcript=[{ role, message, time_in_call_secs }]
data.conversation_initiation_client_data.dynamic_variables.session_id=<test id>
```

Then POST to the production webhook and report:

```text
input_path=<exact local path>
sessionId=<returned sessionId>
taskName=<returned taskName>
worker.validation.ok=<from adecco_eval_task_completed log>
worker.mail.ok=<from adecco_eval_task_completed log>
worker.gmail_message_id=<from adecco_eval_task_completed log mail.id>
```

## HTML Email Equality

When a user provides a new HTML report file, copy it into the AI_RPG repo and verify equality:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "C:\path\to\source.html"
Get-FileHash -Algorithm SHA256 -LiteralPath scripts\adecco_order_hearing_eval\email_templates\adecco_report_v2.html
```

Hashes must match when the user asks for the HTML email to be identical.

This only verifies design-template integrity. The sent HTML must still be dynamically rendered from Claude JSON; sending the static sample HTML is not sufficient.
