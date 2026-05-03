---
name: ai-rpg-quality-latency-benchmark
description: Use when measuring or comparing LLM response speed × quality × audio E2E latency for the AI_RPG roleplay orb — running `pnpm benchmark:tts:response`, `pnpm benchmark:llm:latency`, or `pnpm benchmark:quality-latency`, deciding whether to use Phase 5 TTS-connected E2E or Phase 6 LLM-only matrix or Phase 6 Stage 3 quality-latency Pareto, configuring reasoning effort for OpenAI gpt-5 family, disabling Gemini thinking, adding new LLM streaming clients (Anthropic / Google AI Studio / Inworld Router / Z.AI), running blind LLM judge / pairwise blind ranking, or extending the 24-case quality benchmark set. Also covers the ElevenLabs ConvAI lane via temporary agent + workspace post-call webhook detach/restore. Do NOT use for pure offline TTS-only comparison (that's `ai-rpg-tts-provider-benchmark`). Do NOT use for ElevenLabs production publish/branch/voice-profile work (that's `ai-rpg-repo-elevenlabs-voice`).
---

# AI RPG Quality-Latency Pareto Benchmark

Use this skill for the **multi-LLM × multi-TTS × quality** offline benchmark suite. All commands run outside the live runtime (no LiveAvatar / ConvAI publish path / Firestore / Next.js routing) and write metrics + audio + Pareto frontier under `data/generated/{tts-response-latency-benchmark|llm-model-latency|quality-latency-benchmark}/<runId>/`.

This benchmark suite extended from the Phase 4 TTS-only baseline to answer different questions at three escalation levels:

| Phase | Command | Question answered |
|---|---|---|
| 4 | `pnpm benchmark:tts:mvp` | Which TTS provider has the fastest first audio when given a fixed Japanese sentence? |
| 5 | `pnpm benchmark:tts:response` | When real LLM generation precedes TTS, what does end-to-end "user input → first audio" look like (full-text vs first-sentence handoff)? |
| 6 Stage 1-2 | `pnpm benchmark:llm:latency` | Which LLM model returns the first natural Japanese sentence fastest, with reasoning controls (gpt-5 effort=minimal, Gemini thinkingBudget=0)? |
| 6 Stage 3 | `pnpm benchmark:quality-latency` | Combining LLM speed, response quality (rule + blind judge + pairwise), and TTS E2E, what does the Pareto frontier look like? Includes the ElevenLabs ConvAI lane via temp agent. |

Newer benchmarks reuse Phase 4's TTS providers, percentile helpers, sentence segmenter, and CSV/HTML idioms. They do NOT modify Phase 4 code or production runtime.

## Canonical Sources

- [docs/QUALITY_LATENCY_BENCHMARK.md](../../docs/QUALITY_LATENCY_BENCHMARK.md) — Phase 6 Stage 3 runbook (24 cases, blind judge rubric, Pareto algorithm, ElevenLabs lane)
- [docs/LLM_MODEL_LATENCY_BENCHMARK.md](../../docs/LLM_MODEL_LATENCY_BENCHMARK.md) — Phase 6 Stage 1-2 runbook (model registry, reasoning effort, thinkingBudget)
- [docs/TTS_RESPONSE_LATENCY_BENCHMARK.md](../../docs/TTS_RESPONSE_LATENCY_BENCHMARK.md) — Phase 5 runbook (3 modes, LLM cache, overlap gain)
- [docs/OPERATIONS.md](../../docs/OPERATIONS.md) § "Quality-Latency Pareto Benchmark", "LLM Model Latency Benchmark", "TTS Response Latency Benchmark" — dated env / API verification logs
- [packages/scenario-engine/src/qualityLatency/](../../packages/scenario-engine/src/qualityLatency/) — quality-latency module (cases, rule scorer, judge, pairwise, Pareto)
- [packages/scenario-engine/src/llmLatencyMatrix/](../../packages/scenario-engine/src/llmLatencyMatrix/) — LLM-only matrix runner + MODEL_REGISTRY
- [packages/scenario-engine/src/ttsResponseLatency/](../../packages/scenario-engine/src/ttsResponseLatency/) — Phase 5 LLM+TTS E2E with cache
- [packages/vendors/src/llm/](../../packages/vendors/src/llm/) — streaming clients (OpenAI Responses, Anthropic Messages, Google AI Studio, Inworld Router, Z.AI; ElevenLabs ConvAI WebSocket; Anthropic structured tool-use)
- [scripts/tts/compare-quality-latency.ts](../../scripts/tts/compare-quality-latency.ts) — Phase 6 Stage 3 CLI
- [scripts/tts/compare-llm-model-latency.ts](../../scripts/tts/compare-llm-model-latency.ts) — Phase 6 Stage 1-2 CLI
- [scripts/tts/compare-response-latency.ts](../../scripts/tts/compare-response-latency.ts) — Phase 5 CLI

## Default Workflow (Stage 3 quality-latency)

The full Phase 6 Stage 3 flow chains six subcommands against a single `<runId>`. Phase 5 / Phase 6 Stage 1-2 are simpler one-shot runs.

```bash
# 1. LLM fresh generation (24 cases × N models × repeats)
pnpm benchmark:quality-latency -- \
  --models openai:gpt-4.1-nano,anthropic:claude-haiku-4-5-20251001,google:gemini-2.5-flash,openai:gpt-4.1-mini,anthropic:claude-sonnet-4-5-20250929,openai:gpt-5-mini \
  --repeats 10
# Note the runId from output (e.g. p6s3-...).

# 2. Rule scoring (instant, no API)
pnpm benchmark:quality-latency -- --score-rules --run <runId>

# 3. Blind LLM judge (provider/model anonymized in prompt)
pnpm benchmark:quality-latency -- --judge --run <runId> \
  --judge-models anthropic:claude-sonnet-4-5-20250929,openai:gpt-4.1

# 4. Pairwise blind ranking
pnpm benchmark:quality-latency -- --pairwise --run <runId> \
  --judge-models anthropic:claude-sonnet-4-5-20250929 \
  --pairwise-candidates "openai:gpt-4.1-nano,anthropic:claude-haiku-4-5-20251001,google:gemini-2.5-flash,openai:gpt-4.1-mini,anthropic:claude-sonnet-4-5-20250929"

# 5. E2E TTS connection (LLM × TTS × mode)
pnpm benchmark:quality-latency -- --e2e --run <runId> \
  --tts-providers cartesia,fish,openai,inworld,google_gemini \
  --modes first-sentence,full-text \
  --repeats 5

# 6. ElevenLabs ConvAI lane (separate, optional)
pnpm benchmark:quality-latency -- --elevenlabs-agent --create-temp-agent --run <runId> --repeats 3

# 7. Pareto frontier + index.html (rebuilds with whatever data exists)
pnpm benchmark:quality-latency -- --pareto --run <runId>
```

`--cases-limit N` truncates the 24-case set to the first N for quick smoke runs (e.g. `--cases-limit 5`). The case ordering in `cases.ts` is intentional — first cases cover the most common categories.

## Secret mapping (zapier-transfer)

All secrets live in `projects/zapier-transfer/secrets/<NAME>`. Fetch with `gcloud secrets versions access latest --secret=<NAME> --project=zapier-transfer` and assign to the matching env var. Phase 4's TTS provider mappings still apply; Phase 5+ adds judge/LLM-only providers.

| env var | Secret Manager name | used by |
|---|---|---|
| `OPENAI_API_KEY` | `openai-api-key-default` | Phase 5/6 LLM streaming + judge (gpt-4.1) + TTS (gpt-4o-mini-tts) |
| `ANTHROPIC_API_KEY` | `anthropic-api-key-default` | Phase 6 Anthropic streaming + judge (claude-sonnet-4.5) |
| `GOOGLE_API_KEY` | `gemini-api-key-default` | Phase 6 Google AI Studio streaming (ADC NOT required for the LLM lane) |
| `ELEVENLABS_API_KEY` | `ELEVENLABS_API_KEY` | Phase 6 Stage 3 ElevenLabs ConvAI lane (REST + WebSocket) |
| `INWORLD_API_KEY` | `INWORLD_API_KEY` | Phase 6 Inworld Router LLM (shares the key with TTS) |
| `XAI_API_KEY` | `XAI_API_KEY` | xAI Grok Voice Realtime (native voice lane in chat-orb-server + grok-voice-batch). Saved 2026-05-04. |
| `CARTESIA_*` / `FISH_*` / `INWORLD_VOICE_ID` | (same as Phase 4) | Phase 5/6 E2E TTS lanes |

`GOOGLE_TTS_*` for the Gemini TTS provider still uses ADC + `GOOGLE_CLOUD_PROJECT=adecco-mendan` (not `GOOGLE_API_KEY`). Phase 6 Stage 1-2 specific: `OPENAI_RESPONSE_LATENCY_MODEL` may be set via env to override the LLM model fallback chain (`OPENAI_RESPONSE_LATENCY_MODEL` → `OPENAI_MINING_MODEL` → `OPENAI_ANALYSIS_MODEL`).

## Model registry (Phase 6)

[packages/scenario-engine/src/llmLatencyMatrix/modelMatrix.ts](../../packages/scenario-engine/src/llmLatencyMatrix/modelMatrix.ts) defines `MODEL_REGISTRY`. Currently registered:

| id | provider | category | default reasoning effort |
|---|---|---|---|
| `openai:gpt-4.1-nano` | openai | general-fast | (none) |
| `openai:gpt-4.1-mini` | openai | general-mid | (none) |
| `openai:gpt-4o-mini` | openai | general-fast | (none) |
| `openai:gpt-5-nano` | openai | reasoning | minimal |
| `openai:gpt-5-mini` | openai | reasoning | minimal |
| `openai:gpt-4.1` | openai | general-mid | (none) |
| `anthropic:claude-haiku-4-5-20251001` | anthropic | general-fast | (none) |
| `anthropic:claude-sonnet-4-5-20250929` | anthropic | general-mid | (none) |
| `google:gemini-2.5-flash-lite` | google | general-fast | (none) |
| `google:gemini-2.5-flash` | google | general-mid | (none) |
| `inworld:auto` | inworld | general-fast | (none) |

**Z.AI is intentionally not registered** (operational decision 2026-05-03). Streaming client + tests live in `packages/vendors/src/llm/zaiStreaming.ts` for future re-evaluation, but `MODEL_REGISTRY` does not surface it.

## Reasoning controls (gotchas)

- **OpenAI gpt-5 family** rejects custom `temperature` with HTTP 400 (verified 2026-05-03). The benchmark runner auto-omits `temperature` for `category === "reasoning"` models. Always set `reasoningEffort: "minimal"` (already the default for gpt-5-* in `MODEL_REGISTRY`) — without it, default `effort=medium` makes p90 first sentence ≈ 7000ms.
- **Google Gemini 2.5 Flash** consumes `maxOutputTokens` budget on internal thinking unless `generationConfig.thinkingConfig.thinkingBudget` is set. `GoogleAiStudioStreamingClient` defaults to `thinkingBudget: 0`. Without this, response text gets truncated to ~12 chars (verified 2026-05-03 — `"はい、〇〇株式会社の△△"`).
- **Anthropic** extended thinking is left disabled by default on Haiku/Sonnet 4.5 (no opt-in flag in our streaming client).
- **Inworld** `auto` router can return cold-start variance up to ~5x normal latency on the first conversation; expect occasional p90 outliers.

## Blind judge rubric (Stage 3C)

[packages/scenario-engine/src/qualityLatency/judgeRubric.ts](../../packages/scenario-engine/src/qualityLatency/judgeRubric.ts) defines the 100-point rubric. Score breakdown: intentFit 25, businessCorrectness 20, nextAction 15, conciseness 15, japaneseNaturalness 15, voiceReadiness 10. Penalties: meta-leak −50, unsupported guarantee −30, wrong numeric/date/count −25, does-not-answer −25, too-verbose −15, bullet/markdown −10.

**The judge is blind** — anonymousId is computed from `sha1(runId | provider | model | caseId | repeatIndex).slice(0, 12)` and the prompt explicitly says "candidate provider/model is not disclosed". Pairwise also anonymizes order via deterministic hash. Cross-validation with two judges (Anthropic Sonnet 4.5 + OpenAI gpt-4.1) is supported via `--judge-models <csv>`.

## Pareto frontier algorithm (Stage 3F)

[packages/scenario-engine/src/qualityLatency/paretoFrontier.ts](../../packages/scenario-engine/src/qualityLatency/paretoFrontier.ts) groups rows by `(llmProvider, llmModel, ttsProvider, mode)` and plots each group on `(p90E2eFirstAudioMs, avgQualityScore)`:

- **Tier 1**: not dominated by any other group on both axes
- **Tier 2**: dominated, but within 10% (`tier2Tolerance`) of a Tier 1 point on either axis
- **dominated**: everything else

Composite score (`compositeScore`):

```
0.35 * normalizedQuality
+ 0.25 * (1 - normalizedSpeed)         // p90 e2e first audio
+ 0.15 * (1 - normalizedDoneSpeed)     // p90 e2e done
+ 0.15 * rulePassRate
+ 0.10 * successRate
```

⚠️ Composite is **biased toward `full-text` mode** because `e2eDoneMs` is null for `first-sentence` rows (we don't currently measure full audio completion in chunked mode). Adoption decisions should treat `p90 e2eFirstAudioMs` as the primary axis and read composite as a tie-breaker.

## ElevenLabs ConvAI lane (Stage 3G, partial)

`--elevenlabs-agent` runs the agent against the 24-case set via WebSocket signed URL flow. Two sub-modes:

- **Without `--create-temp-agent`**: hits the production agent (`agent_2801kpj49tj1f43sr840cvy17zcc`, 住宅設備メーカー scenario). The agent's tuned system prompt + fixed `first_message` returns a constant opening greeting regardless of user input — measurement reflects greeting playback speed, not LLM behavior. **Not recommended for generic comparison.**
- **With `--create-temp-agent`**: clones `glm-45-air-fp8` LLM + voice + `eleven_v3_conversational` TTS into a temporary agent named `latency-benchmark-<runId>`, swaps in `QUALITY_LATENCY_SYSTEM_PROMPT`, runs the benchmark, and deletes the temp agent in `finally`. **Use this for apples-to-apples comparison with the text-LLM lanes.**

🚨 **Both modes detach the workspace post-call webhook before any conversation traffic**, then restore it in `finally`. See `.agents/skills/adecco-eval-webhook/SKILL.md` § "Workspace webhook fires on ALL agents" for the full hazard explanation. The CLI handles this automatically; ad-hoc ConvAI traffic must replicate the pattern manually.

The ElevenLabs lane is not LLM-judged in the default flow (its rows participate in rule scoring + Pareto via an empty quality default). True quality scoring on the ElevenLabs responses requires a follow-up `--judge` run with custom candidate filtering.

## Output schema reminders

| File | Stage | Notes |
|---|---|---|
| `metrics.csv` | 3A | one row per (model × case × repeat) LLM gen |
| `summary.csv` | 3A | aggregated p50/p90/p95 + bootstrap CI per model |
| `rule-scores.csv` | 3B | one row per LLM gen row, with knockout flags |
| `judge-scores.csv` / `judge-summary.csv` | 3C | one row per (gen row × judge model); summary is candidate × judge avg |
| `pairwise.csv` / `pairwise-summary.csv` | 3D | wins/losses/ties + simple log-odds BT score |
| `e2e-metrics.csv` / `e2e-summary.csv` | 3E | LLM × TTS × mode × case × repeat |
| `elevenlabs-agent-metrics.csv` | 3G | agent_id × case × repeat |
| `quality-latency-frontier.csv` | 3F | LLM × TTS × mode → Tier + composite |
| `index.html` | 3F | Pareto table + audio sample player |
| `audio/<llm>__<tts>__<mode>__<caseId>__r<rr>.{wav|...}` | 3E/3G | **do NOT commit** |
| `llm-text/<provider>-<modelSlug>__<caseId>__r<rr>.json` | 3A | **do NOT commit** (covered by `.gitignore`) |

## Re-confirming public docs

LLM provider model names and reasoning controls change frequently. **Before any new wide run that will be reported externally**, re-check each provider's current docs and append a dated line to `docs/OPERATIONS.md`. Existing precedent: 2026-05-03 entries for OpenAI Responses streaming, Anthropic Messages streaming, Google AI Studio streamGenerateContent, Inworld router.

## Related skills

- `ai-rpg-tts-provider-benchmark` — Phase 4 TTS-only comparison (offline, fixed text). Use that skill when the question is "which TTS provider streams Japanese audio fastest for a given utterance" without LLM in the loop.
- `adecco-eval-webhook` — production ConvAI agent + post-call eval pipeline. **Required reading** before running this skill's ElevenLabs lane (`--elevenlabs-agent`). The detach/restore pattern lives there.
- `ai-rpg-orb-chat-verification` — interactive multi-turn chat tooling (`pnpm chat:orb`, `pnpm chat:orb:web`) for hands-on quality verification of Stage 3 candidates. Includes the xAI Grok Voice Realtime native voice lane.
- `ai-rpg-staffing-reference-scenario` / `ai-rpg-repo-elevenlabs-voice` — production agent / voice profile work. Out of scope for benchmarks.

## Quality verification tooling (post-benchmark)

Once Stage 3 numbers are out, the next step is usually "let me actually talk to these candidates and feel the difference." Two interactive tools live alongside the benchmarks:

| Command | Purpose |
|---|---|
| `pnpm chat:orb -- --llm <id> --tts <provider>` | Terminal CLI multi-turn chat. Saves WAV per turn + `transcript.md`. |
| `pnpm chat:orb:web` (Windows: `.\scripts\chat-orb-web.ps1`) | Browser UI at `http://127.0.0.1:3030`. Streaming token display, autoplay TTS, mic input via Web Speech API, native voice lane (xAI Grok), 10 preset case buttons. |

The browser UI's **🎙 mic button** uses Web Speech API for browser-side ASR when paired with text LLM × external TTS. When paired with `xai:grok-voice-think-fast-1.0`, it switches to a server-proxied WebSocket flow (`/api/voice-realtime` → `wss://api.x.ai/v1/realtime`) that streams PCM16 24kHz both ways. The TTS dropdown is auto-disabled in native voice mode because Grok handles the full stack.

Reference doc: [docs/CHAT_ORB.md](../../docs/CHAT_ORB.md).

## Native voice model evaluation methodology (xAI Grok Voice example)

Grok Voice Think Fast 1.0 (and other native-voice candidates) cannot be scored on text generation directly because they emit audio. The pattern shipped 2026-05-04 in [scripts/grok-voice-batch.ts](../../scripts/grok-voice-batch.ts):

1. Take each case's `userInput` (text) and synthesize to PCM16 24kHz via OpenAI TTS (`gpt-4o-mini-tts`, voice=`marin`)
2. Open WS to xAI Realtime with the same `QUALITY_LATENCY_SYSTEM_PROMPT` via `session.update` (turn_detection=null, manual commit)
3. Send `input_audio_buffer.append` → `commit` → `response.create`
4. Capture `response.output_audio.delta` chunks (PCM16 base64) and assemble a WAV
5. **xAI does NOT emit `response.audio_transcript.delta`** — fall back to OpenAI Whisper-1 (`POST /v1/audio/transcriptions` with the assembled WAV) to recover the AI text
6. Save in schema-compatible form to `llm-text/xai-grok-voice-think-fast-1-0__<caseId>__r01.json` so the same Pareto / judge tooling can ingest it

Run it with:

```powershell
.\scripts\grok-voice-batch.ps1 -RunDir <p6s3 run dir> -Voice ara -Limit 24
```

This adds `XAI_API_KEY` to the secrets pulled from zapier-transfer and uses OpenAI for both the user-side TTS and the post-hoc Whisper transcription.

### ⚠️ TTS→ASR roundtrip caveat (real-audio re-eval recommended)

The synthetic-audio path produces ~16-25% knockout rate for Grok Voice on the 24-case set, but **2 of those knockouts (ql_019, ql_020) are caused by `gpt-4o-mini-tts` voice `marin` (English-leaning) producing audio that xAI's internal Whisper transcribes incorrectly** — e.g. "某A社さん" → "防衛者さん" → Grok hallucinates about NLP precision unrelated to staffing. Real native-Japanese-speaker audio likely cuts the knockout rate to ~8-12%. The chat-orb-web native voice lane is the way to verify with real microphone input.

## Cross-judge validation methodology (Claude in conversation as 2nd judge)

Stage 3C uses Anthropic Sonnet 4.5 as the LLM judge. Sonnet judging Anthropic candidates is a self-bias risk. Cross-validation pattern (used 2026-05-03):

1. Read all `(model, case)` r01 responses from `llm-text/`
2. In conversation, apply the same rubric (intentFit 25 / businessCorrectness 20 / nextAction 15 / conciseness 15 / japaneseNaturalness 15 / voiceReadiness 10 + meta-leak −50 / unsupported guarantee −30 / wrong numeric −25 / does-not-answer −25 / too-verbose −15) to each
3. Save to `claude-judge-scores.csv` (same shape as `judge-scores.csv` but with `judgeProvider=claude-opus-4-7`)
4. Aggregate to `claude-judge-summary.csv` and compare ranks vs `judge-summary.csv`
5. Document divergences in `claude-judge-report.md`

Result on run `p6s3-20260503T072554094Z`: ranks identical 6/6 across both judges; absolute scores differ by +13-19 points (Claude is more lenient on the upper band) but knockout patterns matched. **Sonnet self-bias did exist** (it missed ql_001 placeholder + ql_011 fabricated stat in its OWN responses) but did not flip the model ranking.

Future: add OpenAI gpt-4.1 as a 3rd judge to break the all-Anthropic dependency. Stage 3C `--judge-models` already supports the csv form.

## Guardrails

- **Never modify** the production agent (`agent_2801kpj49tj1f43sr840cvy17zcc`) when running benchmarks. Always use `--create-temp-agent` for the ConvAI lane.
- **Never run ConvAI traffic** without detaching the workspace post-call webhook first. The CLI does this automatically; ad-hoc curls / direct WebSocket scripts must replicate the pattern. Failure to do so will fire 1 production eval (Claude Sonnet API spend + email to `iwase@zenoffice.co.jp`) **per conversation**.
- **Never silence** vendor errors with `try {} catch {}`. The runner's reliability depends on errors landing in CSV with `errorCode` / `errorMessage`.
- **Never commit** generated audio, llm-text, metrics CSV, or filled-in `.env.local`. Reports cite the run path and quote summary tables only.
- **Never bypass blind anonymization** in judge / pairwise prompts. Provider/model name in the judge prompt destroys the comparison.
- **Never use** `@ts-ignore` / `as any` to paper over response shape mismatches. Update Zod schema or parser instead.

## Completion report template

```text
DOD判定: 達成 / 一部未達

実行コマンド:
- pnpm benchmark:quality-latency -- <args>

生成run:
- data/generated/quality-latency-benchmark/<runId>/

LLM speed (Stage 3A, fresh):
- model別 p50/p90/p95 first sentence + bootstrap 95% CI

Quality (Stage 3C, blind judge):
- judge model:
- model別 avg overall, knockout rate

Pairwise (Stage 3D):
- model別 winRate / btScore

E2E (Stage 3E):
- model × tts × mode の p90 e2eFirstAudioMs

Pareto (Stage 3F):
- Tier 1 / Tier 2 / dominated
- 採用判断 axis (p90 e2eFirstAudioMs and avg quality)

ElevenLabs lane (Stage 3G, optional):
- temp agent: latency-benchmark-<runId>
- p90 first audio (true response, not opening greeting)

未達/既知制約:
- (e.g. cases-limit reduced to N, judge models reduced to 1, …)

次の判断:
- 採用候補
- Reasoning model 候補 (gpt-5-nano など)
- Native voice lane への拡張 (OpenAI Realtime / Gemini Live)
```
