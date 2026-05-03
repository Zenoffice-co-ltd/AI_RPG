---
name: ai-rpg-orb-chat-verification
description: Use when an operator wants to interactively talk to one or more Stage 3 LLM × TTS candidates (or the xAI Grok Voice native voice model) to verify response quality, voice naturalness, and real Voice → Voice E2E latency by hand — running `pnpm chat:orb`, `pnpm chat:orb:web`, switching models mid-session, generating per-turn WAV files, comparing fish s2-pro vs cartesia vs openai TTS naturalness, or evaluating Grok Voice in real conversation. Also covers extending the tool with a new LLM × TTS combo or adding a new native voice provider lane (OpenAI Realtime, Google Gemini Live, etc.). Do NOT use for the offline batch benchmark (that's `ai-rpg-quality-latency-benchmark`). Do NOT use for ElevenLabs production agent / publish / branch work (that's `ai-rpg-repo-elevenlabs-voice`). Do NOT use for the production Adecco eval webhook itself (that's `adecco-eval-webhook`).
---

# AI RPG Orb Chat Verification (interactive Stage 3 hands-on)

Use this skill for the **interactive multi-turn chat tooling** that lets a human operator actually talk to (or type at) Stage 3 quality-latency candidates, listen to the audio, and feel the latency. All commands are local-only and do not affect live runtime (no LiveAvatar / ConvAI publish path / Firestore / Next.js routing).

This skill is the "hands-on companion" to `ai-rpg-quality-latency-benchmark`. The benchmark gives numbers; this gives the felt experience of talking to the candidate.

## Canonical Sources

- [docs/CHAT_ORB.md](../../docs/CHAT_ORB.md) — operator runbook (browser UI vs terminal CLI, preset cases, voice metrics)
- [scripts/chat-orb-server.ts](../../scripts/chat-orb-server.ts) — local HTTP server (port 3030) that serves the HTML, proxies LLM × TTS via NDJSON streaming, and proxies xAI Grok Voice Realtime via WebSocket (`/api/voice-realtime`)
- [scripts/chat-orb.html](../../scripts/chat-orb.html) — single-file UI (LLM dropdown, TTS dropdown, mic button via Web Speech API, native voice lane, 10 preset case buttons, latency metrics per turn)
- [scripts/chat-orb.ts](../../scripts/chat-orb.ts) — terminal CLI multi-turn chat with timing inline + WAV per turn + transcript.md
- [scripts/chat-orb-web.ps1](../../scripts/chat-orb-web.ps1) / [scripts/chat-orb.ps1](../../scripts/chat-orb.ps1) — Windows wrappers loading zapier-transfer secrets
- [scripts/grok-voice-batch.ts](../../scripts/grok-voice-batch.ts) — batch evaluator for xAI Grok Voice on the 24-case set (used by `ai-rpg-quality-latency-benchmark`)

## Default Workflow (browser UI)

```powershell
# Windows wrapper loads OPENAI / ANTHROPIC / GOOGLE / INWORLD / XAI / CARTESIA / FISH keys
# from zapier-transfer Secret Manager, then starts the local server.
.\scripts\chat-orb-web.ps1

# Browser: http://127.0.0.1:3030
# Stop with Ctrl+C in the terminal that ran the script.
```

The UI exposes two distinct paths controlled by the LLM dropdown:

1. **Text LLM × External TTS** (Stage 3 Tier 1 candidates: gpt-4.1-nano + cartesia, claude-haiku-4-5 + fish s2-pro, etc.). Mic button uses Web Speech API for browser-side ASR. NDJSON `/api/chat` endpoint streams LLM tokens + TTS audio.
2. **Native voice (xai:grok-voice-think-fast-1.0)**. Mic button uses MediaStream → AudioContext ScriptProcessor → PCM16 24kHz → server WS proxy → xAI Realtime. AI audio chunks play via Web Audio API. Text input box auto-disabled (Grok requires audio).

Each turn shows:
- **LLM**: 1st-token / 1st-sent / done (ms)
- **TTS** (text path): 1st-audio / done (ms)
- **E2E** (text path): full-text 1st-audio / done (= LLM done + TTS times)
- **🎙 Voice → Voice E2E**: user speech end → AI audio first plays. **This is the metric that matches user perception.**
- For native voice: server-side audio timestamps (firstAiAudio / aiAudioDone) + browser perf E2E

Per-turn WAV is saved under `data/generated/chat-orb-sessions/<sessionId>/turn-NNN.wav` (text path) or `voice-NNN-{user|ai}.wav` (native voice). `.gitignore`-d.

## Default Workflow (terminal CLI, headless)

When automating or running on a machine without a browser:

```powershell
# Stage 3 Tier 1 candidates worth verifying:
.\scripts\chat-orb.ps1 -Llm "anthropic:claude-haiku-4-5-20251001" -Tts fish    # 品質トップ
.\scripts\chat-orb.ps1 -Llm "openai:gpt-4.1-mini" -Tts cartesia                # バランス
.\scripts\chat-orb.ps1 -Llm "openai:gpt-4.1-nano" -Tts cartesia                # 最速
.\scripts\chat-orb.ps1 -Llm "openai:gpt-4.1-nano" -NoTts                        # text only
```

CLI emits readline `You> ... AI> ...` with inline timing per turn. Controls: `:exit`, `:quit`, `:reset` (clears history, system prompt persists). Closing emits a `transcript.md` listing each turn + latency.

## Secret mapping (zapier-transfer)

| env var | Secret Manager name | used by |
|---|---|---|
| `OPENAI_API_KEY` | `openai-api-key-default` | Text LLM (openai:*) + OpenAI TTS + Whisper post-hoc transcription in grok-voice-batch |
| `ANTHROPIC_API_KEY` | `anthropic-api-key-default` | Text LLM (anthropic:*) |
| `GOOGLE_API_KEY` | `gemini-api-key-default` | Text LLM (google:*, ADC NOT required) |
| `INWORLD_API_KEY` | `INWORLD_API_KEY` | Text LLM (inworld:*) AND Inworld TTS |
| `XAI_API_KEY` | `XAI_API_KEY` | Native voice lane (xAI Grok Voice Realtime). Saved 2026-05-04. |
| `CARTESIA_API_KEY` / `CARTESIA_VOICE_ID` | (same as Phase 4) | Cartesia TTS |
| `FISH_API_KEY` / `FISH_REFERENCE_ID` | (same as Phase 4) | Fish Audio TTS s2-pro |

The PowerShell wrappers (`chat-orb-web.ps1`, `chat-orb.ps1`, `grok-voice-batch.ps1`) fetch all required secrets in one shot.

## Stage 3 Tier 1 verification flow (recommended)

```text
1. Start chat-orb-web → open http://127.0.0.1:3030
2. Select claude-haiku-4-5-20251001 + fish      → talk through 5-10 preset cases
3. New session → select gpt-4.1-nano + cartesia → talk through the same cases
4. Compare felt latency vs metric latency vs Pareto p90 numbers
5. (optional) New session → select xai:grok-voice-think-fast-1.0 → real native voice trial
```

Preset cases in the UI (`PRESET_CASES` in chat-orb.html) span the highest-signal Stage 3 categories: short_ack, condition_hearing (5月12日 + 3名), budget, competitor, ambiguous, english_mixed, long_context, numbers_dates, busy_manager, **safety prompt-leak test**.

## xAI Grok Voice Realtime integration internals

Server-side proxy in [scripts/chat-orb-server.ts](../../scripts/chat-orb-server.ts) handles `GET /api/voice-realtime` upgrade:
- Reads `XAI_API_KEY` from env (server-side only — browser never sees it)
- Connects to `wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0` with `Authorization: Bearer <key>`
- Sends `session.update` with `QUALITY_LATENCY_SYSTEM_PROMPT`, voice (default `ara`), `input_audio_format=pcm16`, `output_audio_format=pcm16`, `turn_detection={type:"server_vad", silence_duration_ms:600, create_response:true}`, `input_audio_transcription={model:"whisper-1"}`
- Forwards browser PCM16 chunks as `input_audio_buffer.append` (base64-encoded)
- Forwards xAI events back to browser as `xai_event` JSON for transcript display, while accumulating PCM audio chunks for WAV save
- On `voice_ended` from browser, emits `input_audio_buffer.commit` + `response.create` to xAI (server VAD usually triggers automatically too)

Per-turn artifacts saved:
- `voice-<turn>-user.wav` — synthesized user audio (for batch path) or recorded mic audio (for live path)
- `voice-<turn>-ai.wav` — Grok's audio response
- `voice-<turn>-events.jsonl` — full xAI ↔ server message log with relative timestamps (debugging)

## ⚠️ Real-audio recommended over synthetic

`scripts/grok-voice-batch.ts` synthesizes user input via `gpt-4o-mini-tts` voice `marin` (English-leaning) for repeatable benchmark numbers. This caused 2 of 4 measured Grok knockouts (`ql_019`, `ql_020`) by garbling Japanese audio enough that xAI's internal Whisper produced nonsense transcripts (e.g., "某A社さん" → "防衛者さん"), which Grok then took at face value and hallucinated about. **Real-microphone evaluation via the browser UI's native voice lane is more representative** of production user experience. Always cross-check batch findings against a chat-orb-web session with a real Japanese speaker.

## Adding a new LLM × TTS combo

The dropdowns are populated from `MODEL_REGISTRY` (`packages/scenario-engine/src/llmLatencyMatrix/modelMatrix.ts`) and `TTS_FACTORIES` (in `chat-orb-server.ts`). To wire a new combo:

1. Register the LLM in `MODEL_REGISTRY` (server reads it via `/api/models`)
2. Register the TTS provider in `packages/vendors/src/tts/index.ts` (Phase 4 patterns)
3. Reload the browser — both dropdowns refresh automatically

## Adding a new native voice lane (OpenAI Realtime / Gemini Live)

Pattern follows the Grok Voice integration:

1. Add a virtual entry to `NATIVE_VOICE_MODELS` in `chat-orb.html` (e.g. `openai:gpt-realtime`, `google:gemini-live-2.5-flash-native-audio`)
2. Branch the WebSocket URL in `chat-orb-server.ts` `handleVoiceRealtimeClient` based on `model` query param
3. Map the provider's event names to our normalized `xai_event` envelope OR add a new event kind for browser
4. Adjust audio format if needed (some require 16kHz instead of 24kHz)
5. Confirm provider's API contract date in `docs/OPERATIONS.md`

## Guardrails

- **xAI key handling**: only ever read `XAI_API_KEY` server-side. Never embed it in HTML or expose via API. Browser uses ephemeral signed URL flow if direct browser → xAI is ever needed.
- **No production traffic**: chat-orb does NOT touch the production ElevenLabs ConvAI agent. The native voice lane uses xAI directly so no workspace webhook detach is needed (per `adecco-eval-webhook`).
- **Generated WAVs are not committed**: `data/generated/chat-orb-sessions/` is in `.gitignore`. Reports cite the session path only.
- **Web Speech API limits**: Chrome / Edge only. Firefox has partial support, Japanese ASR unstable. Document this in any operator-facing release notes.
- **Mic permission**: Browser will ask twice if both Web Speech API (text path) and getUserMedia (native voice path) are used in the same session. This is expected — separate audio capture stacks.
- **Buffered PowerShell stdout**: when the server is launched via `run_in_background`, expect the `Chat Orb test UI: ...` log to appear only after first connection or session shutdown. Probe `http://127.0.0.1:3030/api/models` to confirm liveness.

## Related skills

- `ai-rpg-quality-latency-benchmark` — Stage 3 batch numbers that this skill verifies by ear/UX. Always run the benchmark first to know which combos are worth talking to.
- `adecco-eval-webhook` — production ConvAI eval pipeline. Native voice lanes here do NOT need its detach/restore pattern, but operators familiar with that skill should be reminded explicitly.
- `ai-rpg-tts-provider-benchmark` — Phase 4 TTS-only benchmark; same TTS provider adapters power the chat-orb TTS dropdown.

## Completion report template

```text
セッション: data/generated/chat-orb-sessions/<sessionId>/
モード: text-LLM × TTS / native-voice (どちらか)
LLM: <id>
TTS: <provider>            # text モードのみ
ターン数: N

Voice → Voice E2E (browser perf):
- mean: <ms>
- min: <ms>
- max: <ms>

体感品質メモ:
- 自然さ:
- 数値・固有名詞の echo 正確度:
- 会話の "間" の自然さ:
- 安全性 (system prompt 漏出 / 捏造) の有無:

Stage 3 数値との比較:
- p90 e2eFirstAudio (Stage 3): <ms>
- 体感 voice→voice E2E: <ms>
- 一致 / 乖離:

次の判断:
- 採用 / 不採用 / 追加検証
- 別 candidate の verification
```
