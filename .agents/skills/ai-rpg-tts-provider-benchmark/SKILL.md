---
name: ai-rpg-tts-provider-benchmark
description: Use when comparing non-ElevenLabs TTS providers (Cartesia / Inworld / Fish Audio / Google Gemini TTS / OpenAI) for the AI_RPG roleplay orb — running `pnpm benchmark:tts:mvp`, choosing voice IDs, fetching API keys from zapier-transfer Secret Manager, interpreting `metrics.csv` / `summary.csv`, judging adoption against the latency line, or adding a new provider adapter under `packages/vendors/src/tts/`. Also use when re-running benchmarks after voice changes, repeats sweeps, WebSocket replacement, or for monthly drift checks. **Do NOT use** for ElevenLabs ConvAI / publish / agent / branch / voice-profile work — that is `ai-rpg-repo-elevenlabs-voice`. Do NOT use for generic frontend audio playback or LiveAvatar work.
---

# AI RPG TTS Provider Benchmark MVP

Use this skill for the offline cross-provider TTS comparison workflow. The MVP runs entirely outside the live runtime (no LiveAvatar / ConvAI publish / Firestore / Next.js routing) and writes audio + CSV + HTML reports under `data/generated/tts-provider-benchmark/<runId>/`.

## Canonical Sources

- [docs/TTS_PROVIDER_BENCHMARK_MVP.md](../../docs/TTS_PROVIDER_BENCHMARK_MVP.md) — operator runbook (env, CLI, output schema, first-audio definition)
- [docs/OPERATIONS.md](../../docs/OPERATIONS.md) § "TTS Provider Benchmark MVP" — dated public-docs verification log per provider
- [packages/scenario-engine/src/ttsComparison/providerBenchmark.ts](../../packages/scenario-engine/src/ttsComparison/providerBenchmark.ts) — `runProviderBenchmark()` runner
- [packages/vendors/src/tts/](../../packages/vendors/src/tts/) — provider adapters (`openaiTts.ts`, `cartesia.ts`, `inworld.ts`, `fish.ts`, `googleGemini.ts`, `elevenlabsBaseline.ts`)
- [scripts/tts/compare-mvp.ts](../../scripts/tts/compare-mvp.ts) — CLI

## Default Workflow

1. **Fetch secrets from zapier-transfer Secret Manager** into env (see "Secret mapping" below). Never hard-code keys in commits or `.env.local`. The MVP CLI reads `process.env` directly — bypasses `getAppContext()` so Firebase is never initialized.
2. **Preflight** to confirm all required envs resolve: `pnpm benchmark:tts:mvp -- --preflight --providers <csv>`. Fix env gaps before any HTTP call.
3. **Single-provider smoke** (`--repeats 1 --mode warm`) when adding a new provider, changing a voice, or after a model-name change. Verify output schema before going to wide runs.
4. **Wide comparison run** (`--repeats 5 --mode warm`, all available providers) when the per-provider smokes are green.
5. **Read `summary.csv`** and rank against the adoption line (below). Cite p50/p90 first-audio for streaming providers and p50/p90 total for non-streaming providers.
6. **Inspect `index.html`** for blind试聴 only when latency numbers shortlist a provider — the toggle hides provider names so reviewer bias is reduced.

## Secret mapping (zapier-transfer)

All provider secrets live in `projects/zapier-transfer/secrets/<NAME>`. Fetch with `gcloud secrets versions access latest --secret=<NAME> --project=zapier-transfer` and assign to the matching env var. Voice IDs are stored as secrets too (not real secrets, but kept there so future runs don't need to re-discover them).

| env var | Secret Manager name | notes |
|---|---|---|
| `OPENAI_API_KEY` | `openai-api-key-default` | shared with the rest of the repo |
| `CARTESIA_API_KEY` | `CARTESIA_API_KEY` | |
| `CARTESIA_VOICE_ID` | `CARTESIA_VOICE_ID` | currently `e8a863c6-22c7-4671-86ca-91cacffc038d` (Daisuke - Businessman, ja) |
| `FISH_API_KEY` | `FISH_API_KEY` | Fish Audio account must have **prepaid credit** — HTTP 402 means top-up needed |
| `FISH_REFERENCE_ID` | `FISH_REFERENCE_ID` | currently `68fdd4419bd64b42a6e59927c67dfb92` (ビジネス男性ナレーション) |
| `INWORLD_API_KEY` | `INWORLD_API_KEY` | base64-encoded basic auth token (use `Authorization: Basic <key>`) |
| `INWORLD_VOICE_ID` | `INWORLD_VOICE_ID` | currently `Satoshi` (male professional, ja) |
| `ELEVENLABS_API_KEY` | `ELEVENLABS_API_KEY` | only for `--include-elevenlabs-baseline` |

Google Gemini TTS uses **ADC**, not a key:
- `GOOGLE_CLOUD_PROJECT=adecco-mendan` (Vertex AI is enabled here, NOT in zapier-transfer)
- `GOOGLE_CLOUD_LOCATION=global`
- `GOOGLE_TTS_VOICE=Aoede` (or another prebuilt voice — see "Voice discovery" below)
- `gcloud auth application-default login` must be active. The adapter shells out to `gcloud auth print-access-token` if `GOOGLE_ACCESS_TOKEN` is unset.

## Voice discovery (when adding or changing a voice)

| provider | endpoint | filter |
|---|---|---|
| Cartesia | `GET https://api.cartesia.ai/voices/?limit=200` (header `X-API-Key`, `Cartesia-Version: 2024-11-13`) | `data[]` where `language=="ja"` |
| Inworld | `GET https://api.inworld.ai/tts/v1/voices` (header `Authorization: Basic <key>`) | `voices[]` where `languages[] contains "ja"` |
| Fish | `GET https://api.fish.audio/model?language=ja&page_size=20&sort_by=score&title=<query>` (header `Authorization: Bearer <key>`) | `items[]._id`. For business roleplay query `title=ビジネス` |
| Google Gemini | no list endpoint; use the documented prebuilt set (Aoede / Charon / Fenrir / Kore / Leda / Orus / Puck / Schedar / Vega / Zephyr) | pick by docs |
| OpenAI | no list endpoint; documented voices: `alloy`, `ash`, `ballad`, `coral`, `echo`, `marin`, `sage`, `shimmer`, `verse` (verify against current docs) | pick by docs |

Save the chosen voice id to Secret Manager so the next run is one command. Use a male professional voice for busy-manager parity (current set is Daisuke / Satoshi / ビジネス男性ナレーション / marin / Aoede).

## Adoption line

A provider clears the adoption line for the live ConvAI orb use case when:

- p50 first audio < **500 ms**
- p90 first audio < **900 ms**
- success rate = **100%** in the wide run
- 日本語試聴で「自然さ」「滑らかさ」「読みの正確さ」が ElevenLabs baseline と同等以上

Non-streaming providers (Inworld REST, Google Gemini preview, ElevenLabs baseline render) cannot be ranked on first-audio. Cite `p50TotalMs` and mark them with `firstAudioAvailable=false` in the report; do not pretend they're directly comparable to streaming providers.

## Provider-specific gotchas

- **Cartesia**: HTTP `POST /tts/bytes` with `output_format={container:"raw",encoding:"pcm_s16le",sample_rate:24000}`. WebSocket transport is not yet implemented; replacing it should not change the adapter interface.
- **Fish Audio**: HTTP 402 `Insufficient Balance` is an account problem, not code. Do NOT modify the adapter — top up Fish dashboard. Fish returns a complete WAV (not raw PCM); duration estimation subtracts the 44-byte header.
- **Inworld**: REST returns base64-encoded PCM in `audioContent`. `requestToFirstAudioMs` is `null` because the response is non-streaming. Auth header is `Basic <key>` (not `Bearer`).
- **Google Gemini**: current preview model is **`gemini-2.5-flash-preview-tts`** (the plan's `gemini-3.1-flash-tts-preview` does not exist). Endpoint is `https://aiplatform.googleapis.com/v1/projects/<project>/locations/global/publishers/google/models/<model>:generateContent`. Response audio is at `candidates[0].content.parts[0].inlineData.data` as base64 PCM (mime `audio/L16;codec=pcm;rate=24000`). Total latency is ~5-6s — slow for orb use; suitable only for pre-rendered audio.
- **OpenAI**: `POST /v1/audio/speech` with `response_format=pcm` returns 24kHz mono s16le streamed via fetch body reader. First-chunk timestamp is the first non-empty chunk.

## Re-confirming public docs

Provider model names, endpoints, and streaming formats change frequently — especially preview models. **Before any new wide run that will be reported externally**, re-check each provider's current docs and append a dated line to `docs/OPERATIONS.md` § "公式 docs 確認" with the date, provider, finding, and any code change made. Existing precedent: 2026-05-03 entries for OpenAI, Cartesia, Google, Fish, Inworld.

## Adding a new provider

1. Add a class in `packages/vendors/src/tts/<provider>.ts` implementing `TtsProvider` (see existing adapters for the shape). Use `fetchStreamingAudio()` for binary HTTP streaming, `requestJson()` from `../http` only for JSON metadata calls.
2. Always return a `TtsSynthesisResult`. Use `envFailureResult()` / `vendorFailureResult()` from `providerHelpers.ts` rather than throwing — runner reliability depends on per-provider failure isolation.
3. If the API is non-streaming, set `requestToFirstAudioMs: null` and document the reason.
4. Add the provider id to the `TtsProviderId` union in `types.ts` and the factory switch in `providerBenchmark.ts`.
5. Re-export from `tts/index.ts`. Run `pnpm --filter @top-performer/vendors typecheck` before smoke.
6. Add envs to `.env.local.example`. Store keys in zapier-transfer Secret Manager — never commit.

## Representative commands

```bash
# Preflight (no HTTP calls)
pnpm benchmark:tts:mvp -- --preflight --providers cartesia,inworld,fish,google_gemini,openai

# Single-provider smoke (e.g. after a voice change)
pnpm benchmark:tts:mvp -- --providers cartesia --repeats 1 --mode warm

# Wide comparison run (200 calls with default 8-utterance CSV × 5 providers × 5 repeats)
pnpm benchmark:tts:mvp -- --providers cartesia,inworld,fish,google_gemini,openai --repeats 5 --mode warm

# Include ElevenLabs baseline (offline render only, does not touch ConvAI)
pnpm benchmark:tts:mvp -- --providers cartesia,fish,openai --include-elevenlabs-baseline --repeats 3 --mode warm

# Tests
pnpm vitest run packages/vendors/src/tts/audio.test.ts packages/scenario-engine/src/ttsComparison/providerBenchmark.test.ts
pnpm --filter @top-performer/vendors typecheck
pnpm --filter @top-performer/scenario-engine typecheck
```

## Output schema reminders

- `metrics.csv`: provider × utterance × repeat (one row per call). Streaming-only fields (`requestToFirstAudioMs`) are blank when null.
- `summary.csv`: provider × model × voice. `p50FirstAudioMs` / `p90FirstAudioMs` are blank when `firstAudioAvailable=false`.
- `review-sheet.csv`: success rows only. `providerHiddenId = sha1(runId|provider|voiceId).slice(0,8)` for blind eval.
- `index.html`: vanilla JS, single Toggle blind mode button hides `data-provider` cells.
- Generated audio under `audio/<provider>__<utteranceId>__r<NN>.{wav|mp3}` — **do NOT commit**.

## Guardrails

- **Never modify** `packages/vendors/src/elevenlabs.ts` ConvAI / publish / agent / branch / test methods, `packages/scenario-engine/src/benchmarkRenderer.ts` (the existing ElevenLabs benchmark), `config/voice-profiles/`, or `scenario-map.json` from this skill. Those are owned by `ai-rpg-repo-elevenlabs-voice`.
- **Never bypass** `getAppContext()` to add Firebase initialization — the MVP CLI must stay offline-only.
- **Never silence** vendor errors with `try {} catch {}`. The runner depends on errors landing in `metrics.csv` with `errorCode` / `errorMessage` so failed providers are visible in the report.
- **Never commit** generated audio files or filled-in `.env.local`. PR body should reference the run path (`data/generated/tts-provider-benchmark/<runId>/`) and quote the summary table only.
- **Never use** `@ts-ignore` or `as any` to paper over provider response shape mismatches. Update the Zod schema or response parsing instead.
- For preview models (current: Google Gemini), re-check public docs before each wide run and update `docs/OPERATIONS.md` log.

## Related skills

- `ai-rpg-quality-latency-benchmark` — When the question moves beyond TTS-only fixed-text speed (Phase 4) into "what does end-to-end latency look like with real LLM generation in front of TTS, and how good is the response quality?" (Phase 5/6/Stage 3). That skill covers `pnpm benchmark:tts:response`, `pnpm benchmark:llm:latency`, and `pnpm benchmark:quality-latency`. It reuses Phase 4's TTS providers (no changes here) but adds blind LLM judge, pairwise blind ranking, Pareto frontier, and the ElevenLabs ConvAI lane via temporary agent + workspace webhook detach.
- `adecco-eval-webhook` — Required reading before any ConvAI / WebSocket benchmark traffic; covers the production post-call webhook detach/restore pattern.

## Completion report template

Use this format when reporting a wide run to CTO. The Phase 4 report on 2026-05-03 (run `mvp-20260503T045340387Z`) is the canonical example.

```text
DOD判定: 達成 / 一部未達

実行コマンド:
- pnpm benchmark:tts:mvp -- --providers <csv> --repeats N --mode warm

生成run:
- data/generated/tts-provider-benchmark/<runId>/
- index.html: <relative path>

Provider結果 (8 utterances × repeats N, warm):
| 順位 | provider | model / voice | success | p50 first | p90 first | p50 total | p90 total | p50 RTF | first audio |

採用判断 (採用ライン p50 first<500ms / p90<900ms / 成功率100%):
- 本命:
- 対抗:
- baseline:
- streaming化待ち:
- 除外候補:

未達/既知制約:
- WebSocket transport (Cartesia / Fish ライブ系) 未実装
- voice比較は各 provider 1 voice のみ

次の判断 (CTO質問):
1. 採用候補
2. Round 2 で voice チューニングする provider
3. WebSocket化を進める provider
```
