# scripts/chat-orb.ps1
#
# Convenience wrapper: load all required keys from zapier-transfer Secret
# Manager into the current PowerShell session and start the interactive chat.
#
# Usage:
#   .\scripts\chat-orb.ps1                                          # default: openai:gpt-4.1-nano + cartesia
#   .\scripts\chat-orb.ps1 -Llm "anthropic:claude-haiku-4-5-20251001" -Tts fish
#   .\scripts\chat-orb.ps1 -Llm "google:gemini-2.5-flash" -Tts openai
#   .\scripts\chat-orb.ps1 -Llm "openai:gpt-4.1-mini" -NoTts
#
# Stage 3 Tier 1 candidates worth verifying:
#   - claude-haiku-4-5-20251001 + fish        (highest quality, p90 e2e 1378ms)
#   - gpt-4.1-mini + cartesia                  (mid quality, p90 e2e 1316ms)
#   - gpt-4.1-nano + cartesia                  (fastest, p90 e2e 1074ms)

param(
  [string]$Llm = "openai:gpt-4.1-nano",
  [string]$Tts = "cartesia",
  [switch]$NoTts,
  [int]$Temperature = 0
)

$ErrorActionPreference = "Stop"

function Get-Secret([string]$name) {
  return (gcloud secrets versions access latest --secret=$name --project=zapier-transfer 2>$null)
}

# --- LLM keys ---
$env:OPENAI_API_KEY = Get-Secret "openai-api-key-default"
$env:ANTHROPIC_API_KEY = Get-Secret "anthropic-api-key-default"
$env:GOOGLE_API_KEY = Get-Secret "gemini-api-key-default"
$env:INWORLD_API_KEY = Get-Secret "INWORLD_API_KEY"

# --- TTS keys + voices ---
$env:CARTESIA_API_KEY = Get-Secret "CARTESIA_API_KEY"
$env:CARTESIA_VOICE_ID = Get-Secret "CARTESIA_VOICE_ID"
$env:FISH_API_KEY = Get-Secret "FISH_API_KEY"
$env:FISH_REFERENCE_ID = Get-Secret "FISH_REFERENCE_ID"
$env:INWORLD_VOICE_ID = Get-Secret "INWORLD_VOICE_ID"

# --- TTS provider models / voices (literals, not secrets) ---
$env:OPENAI_TTS_MODEL = "gpt-4o-mini-tts"
$env:OPENAI_TTS_VOICE = "marin"
$env:CARTESIA_TTS_MODEL = "sonic-3"
$env:INWORLD_TTS_MODEL = "inworld-tts-1.5-mini"
$env:FISH_TTS_MODEL = "s2-pro"
$env:GOOGLE_CLOUD_PROJECT = "adecco-mendan"
$env:GOOGLE_CLOUD_LOCATION = "global"
$env:GOOGLE_TTS_MODEL = "gemini-2.5-flash-preview-tts"
$env:GOOGLE_TTS_VOICE = "Aoede"

# Verify required keys for the chosen provider before invoking tsx.
$llmProvider = $Llm.Split(":")[0]
$missing = @()
switch ($llmProvider) {
  "openai"    { if (-not $env:OPENAI_API_KEY) { $missing += "OPENAI_API_KEY" } }
  "anthropic" { if (-not $env:ANTHROPIC_API_KEY) { $missing += "ANTHROPIC_API_KEY" } }
  "google"    { if (-not $env:GOOGLE_API_KEY) { $missing += "GOOGLE_API_KEY" } }
  "inworld"   { if (-not $env:INWORLD_API_KEY) { $missing += "INWORLD_API_KEY" } }
  default     { Write-Warning "unknown LLM provider prefix: $llmProvider" }
}
if (-not $NoTts) {
  switch ($Tts) {
    "cartesia"      { if (-not $env:CARTESIA_API_KEY -or -not $env:CARTESIA_VOICE_ID) { $missing += "CARTESIA_API_KEY/CARTESIA_VOICE_ID" } }
    "fish"          { if (-not $env:FISH_API_KEY -or -not $env:FISH_REFERENCE_ID) { $missing += "FISH_API_KEY/FISH_REFERENCE_ID" } }
    "openai"        { if (-not $env:OPENAI_API_KEY) { $missing += "OPENAI_API_KEY (for openai TTS)" } }
    "inworld"       { if (-not $env:INWORLD_API_KEY -or -not $env:INWORLD_VOICE_ID) { $missing += "INWORLD_API_KEY/INWORLD_VOICE_ID" } }
    "google_gemini" { if (-not $env:GOOGLE_CLOUD_PROJECT) { $missing += "GOOGLE_CLOUD_PROJECT (uses ADC)" } }
  }
}
if ($missing.Count -gt 0) {
  Write-Host "Missing env: $($missing -join ', ')" -ForegroundColor Red
  exit 1
}

$cliArgs = @(
  "scripts/chat-orb.ts",
  "--llm", $Llm
)
if ($NoTts) { $cliArgs += "--no-tts" } else { $cliArgs += @("--tts", $Tts) }
if ($Temperature -gt 0) { $cliArgs += @("--temperature", $Temperature.ToString()) }

corepack pnpm exec tsx @cliArgs
