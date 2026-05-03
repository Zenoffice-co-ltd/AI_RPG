# scripts/grok-voice-batch.ps1
#
# Run all 24 quality-latency cases against xAI grok-voice-think-fast-1.0.
# Loads xAI key + OpenAI key (for TTS) from zapier-transfer Secret Manager.

param(
  [string]$RunDir = "data\generated\quality-latency-benchmark\p6s3-20260503T072554094Z",
  [string]$Voice = "ara",
  [int]$Limit = 24
)

$ErrorActionPreference = "Stop"

function Get-Secret([string]$name) {
  return (gcloud secrets versions access latest --secret=$name --project=zapier-transfer 2>$null)
}

$env:XAI_API_KEY = Get-Secret "XAI_API_KEY"
$env:OPENAI_API_KEY = Get-Secret "openai-api-key-default"
$env:OPENAI_TTS_MODEL = "gpt-4o-mini-tts"
$env:OPENAI_TTS_VOICE = "marin"

if (-not $env:XAI_API_KEY) { Write-Error "XAI_API_KEY missing"; exit 1 }
if (-not $env:OPENAI_API_KEY) { Write-Error "OPENAI_API_KEY missing"; exit 1 }

corepack pnpm exec tsx scripts/grok-voice-batch.ts --run-dir $RunDir --voice $Voice --limit $Limit
