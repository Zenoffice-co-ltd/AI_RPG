# scripts/chat-orb-web.ps1
#
# Loads zapier-transfer secrets into the current PowerShell session and starts
# the local HTTP server that serves the browser-based chat UI.
#
# Usage:
#   .\scripts\chat-orb-web.ps1
#   .\scripts\chat-orb-web.ps1 -Port 4040
#
# Then open http://127.0.0.1:3030 in a browser. Stop with Ctrl+C.

param(
  [int]$Port = 3030
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
$env:XAI_API_KEY = Get-Secret "XAI_API_KEY"

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

$env:CHAT_ORB_PORT = $Port.ToString()

Write-Host ""
Write-Host "Open http://127.0.0.1:$Port in your browser." -ForegroundColor Cyan
Write-Host "Sessions are saved under data/generated/chat-orb-sessions/" -ForegroundColor DarkGray
Write-Host "Stop with Ctrl+C." -ForegroundColor DarkGray
Write-Host ""

corepack pnpm exec tsx scripts/chat-orb-server.ts
