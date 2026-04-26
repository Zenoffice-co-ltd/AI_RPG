# Adecco Order Hearing Evaluation MVP

This folder contains a one-shot MVP runner for the Adecco staffing order-hearing roleplay evaluator.

The script loads the checked-in System Prompt, User Prompt Template, and JSON Schema, calls Claude Sonnet 4.5 through the Zapier_GCP_Migration Python/GCP runtime, lightly validates the JSON text, and emails the full Claude response to `iwase@zenoffice.co.jp`.

The prompt files are stored unchanged. Because this MVP deliberately does not use Anthropic Structured Outputs, the runner appends the saved `schema.json` as a separate `<json_output_schema>` input block at call time so the plain Messages API response still targets the expected shape.

## Runtime

Use the Zapier_GCP_Migration Python environment. By default the pnpm script tries:

1. `ZAPIER_PYTHON`
2. `C:\dev\Zapier_GCP_Migration\.venv\Scripts\python.exe`
3. `python`

No Python dependency files are added to AI_RPG. The expected dependencies live in the Zapier_GCP_Migration environment.

## Environment

```powershell
$env:GCP_PROJECT = "zapier-transfer"
$env:APP_ENV = "dev"
$env:INTERNAL_NOTIFICATION_EMAIL = "iwase@zenoffice.co.jp"
$env:ZAPIER_GCP_MIGRATION_ROOT = "C:\dev\Zapier_GCP_Migration"
$env:ZAPIER_PYTHON = "C:\dev\Zapier_GCP_Migration\.venv\Scripts\python.exe"
```

When `APP_ENV=dev`, `notification_router` uses sandbox routing. The script subject is `[AIロープレ評価] <scenario_id> / <session_id>`, and the delivered subject is prefixed by the router as `[SANDBOX] [AIロープレ評価] ...`.

The script enables `GMAIL_SERVICE_ACCOUNT_FALLBACK=true` and `GMAIL_DELEGATED_USER=iwase@zenoffice.co.jp` by default so the existing router can still deliver mail if the legacy OAuth refresh token is invalid.

## Commands

```powershell
pnpm eval:adecco-order-hearing:mvp
```

Run with a real transcript:

```powershell
pnpm eval:adecco-order-hearing:mvp -- --transcript path\to\session.json --session-id real_001
```

Direct Python help:

```powershell
python scripts\adecco_order_hearing_eval\run_adecco_order_hearing_eval.py --help
```

## Validation

MVP validation checks only top-level JSON keys:

- `total_score`
- `rubric_scores`
- `must_capture_items`
- `schema_version`
- `session_id`
- `scenario_id`
- `score_confidence`
- `agent_quality_flags`
- `learner_feedback`

Full `jsonschema` validation and Anthropic Structured Outputs are out of scope for this MVP.
