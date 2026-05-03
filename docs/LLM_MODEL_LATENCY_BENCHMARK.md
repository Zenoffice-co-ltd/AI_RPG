# LLM Model Latency Benchmark (Phase 6)

LLMモデル単体の応答速度を、複数provider・複数reasoning effortで横並べ測定するためのオフラインスクリプト。LiveAvatar / ConvAI publish / Firestore / Next.js UI には **一切影響しない**。

Phase 5 ([docs/TTS_RESPONSE_LATENCY_BENCHMARK.md](TTS_RESPONSE_LATENCY_BENCHMARK.md)) で「LLM込み応答速度」を3モードで測ったが、`gpt-5-mini` の p90 first sentence が **約7050ms** で TTS provider差 (300-720ms) を完全に隠した。`gpt-5-mini` は reasoning-class model でデフォルト reasoning effort が medium。会話AIに使うには不適切。

Phase 6 では、reasoning を切れる/不要なfast modelを横並べに測り、**1秒前後で first sentence を返せる候補を見つける** ことを目的とする。

## Stage分割

| Stage | 内容 | 状態 |
|---|---|---|
| 6A (Stage 1) | OpenAI 4 fast model + reasoning effort 制御 | 実装済み |
| 6B (Stage 2) | Anthropic Haiku 4.5、Google Gemini Flash Lite/Flash、Z.AI GLM-4.5、Inworld Router の追加 | 実装済み (Z.AI key未登録のためsmokeはprovider 4) |
| 6C | LLM × TTS E2E マトリクス（上位モデル × 5 TTS provider × 2 mode） | 未実装 |
| 6D | Native voice（ElevenLabs Agents hosted、OpenAI Realtime、Google Gemini Live） | 未実装 |

## Stage 1 仕様

### 対象 model

`packages/scenario-engine/src/llmLatencyMatrix/modelMatrix.ts` の `MODEL_REGISTRY` を参照。

| id | category | default reasoning effort | 備考 |
|---|---|---|---|
| `openai:gpt-4.1-nano` | general-fast | (none) | 最速・非reasoning |
| `openai:gpt-4.1-mini` | general-mid | (none) | 中位・非reasoning |
| `openai:gpt-4o-mini` | general-fast | (none) | 既存 baseline |
| `openai:gpt-5-nano` | reasoning | minimal | gpt-5系最速、effort=minimal推奨 |
| `openai:gpt-5-mini` | reasoning | minimal | Phase 5 baseline (effort未指定で7s)。Phase 6では minimal で再測定可 |

### reasoning effort 制御

`packages/vendors/src/llm/streamingText.ts` の `OpenAiResponsesStreamingClient` に `reasoningEffort` オプションを追加した。Responses APIの request body に `reasoning: { effort: <value> }` を注入する。

- 各モデルに `defaultReasoningEffort` を設定（gpt-5系はminimal、それ以外は未指定）
- CLI `--reasoning-effort minimal|low|medium|high` で全モデルに上書き
- 非reasoning model に effort を渡しても無視されるが、誤解を避けるため **デフォルトでは渡さない**

### 速度測定指標

- `llmRequestToFirstTokenMs` — リクエスト送信から最初の delta 受信まで
- `llmRequestToFirstSentenceMs` — 最初の自然な日本語文（句点系終端 / 40文字+読点）が完成するまで
- `llmRequestToDoneMs` — 全文完成まで
- `llmOutputChars` / `llmOutputSentences`
- `llmOutputCharsPerSec` — `llmOutputChars / (llmRequestToDoneMs / 1000)`

8 case × 5 repeats × N models が basis。

LLM cacheは Phase 5と異なり **無効**（速度測定なので毎回 fresh call）。

### env

```
OPENAI_API_KEY=     # 必須 (openai:* model)。zapier-transfer の openai-api-key-default を使用
ANTHROPIC_API_KEY=  # 必須 (anthropic:*)。zapier-transfer の anthropic-api-key-default を使用
GOOGLE_API_KEY=     # 必須 (google:*)。zapier-transfer の gemini-api-key-default を使用 (ADC不要)
ZAI_API_KEY=        # 必須 (zai:*)。zapier-transfer 未登録なので追加が必要
INWORLD_API_KEY=    # 必須 (inworld:*)。既存TTS用と共有
```

`--preflight` を使うと、要求モデルの provider 別に必要 env を一覧して missing を表示する。system prompt は Phase 5 と同じ `RESPONSE_LATENCY_SYSTEM_PROMPT` を流用。

### 実行コマンド

```bash
# preflight（env / model 妥当性チェックのみ）
pnpm benchmark:llm:latency -- \
  --models openai:gpt-4.1-nano,openai:gpt-4.1-mini,openai:gpt-4o-mini,openai:gpt-5-nano \
  --preflight

# Stage 1 推奨smoke（4 OpenAI fast models）
pnpm benchmark:llm:latency -- \
  --models openai:gpt-4.1-nano,openai:gpt-4.1-mini,openai:gpt-4o-mini,openai:gpt-5-nano \
  --modes llm-only \
  --repeats 5

# Phase 5 baseline 再現用（gpt-5-mini を effort=minimal で並走）
pnpm benchmark:llm:latency -- \
  --models openai:gpt-4.1-nano,openai:gpt-5-mini \
  --modes llm-only \
  --repeats 5

# Stage 2 横断比較（OpenAI / Anthropic / Google / Inworld。Z.AIはkey登録後に追加）
pnpm benchmark:llm:latency -- \
  --models openai:gpt-4.1-nano,anthropic:claude-haiku-4-5-20251001,google:gemini-2.5-flash-lite,google:gemini-2.5-flash,inworld:auto \
  --modes llm-only \
  --repeats 5
```

### CLI options

```
--models <csv>           default: 全 OpenAI registered models
--modes <csv>            "llm-only" のみ。それ以外を渡すとerror。E2Eは Phase 5 (TTS connected) を使う
--repeats <n>            default: 5
--reasoning-effort <e>   全モデルに適用 (minimal|low|medium|high)
--temperature <n>        default: 0.2
--max-output-tokens <n>  default: 200
--seed <n>               LLM seed（responses APIが受け付ける場合のみ実効）
--output-dir <path>
--preflight              env / model 一覧のみ表示して exit
```

### 出力

```
data/generated/llm-model-latency/
  <runId>/
    metrics.csv
    summary.csv
    manifest.json
    index.html
    llm-text/<provider-modelSlug>__<caseId>__r<rr>.json
```

`runId = p6-<ISO compact>`。`.gitignore` で `data/generated/llm-model-latency/` を除外済。**生成物はcommitしない。**

#### metrics.csv 列

```
runId, timestamp, provider, model, modelCategory, reasoningEffort,
caseId, category, userInput, repeatIndex, status,
llmRequestToFirstTokenMs, llmRequestToFirstSentenceMs, llmRequestToDoneMs,
llmOutputChars, llmOutputSentences, llmOutputCharsPerSec,
firstSentenceText, responseText,
temperature, maxOutputTokens, seed,
errorCode, errorMessage, vendorRequestId
```

#### summary.csv 列

集計単位: provider × model × reasoningEffort

```
provider, model, modelCategory, reasoningEffort,
total, success, failed, successRate,
p50FirstTokenMs, p90FirstTokenMs,
p50FirstSentenceMs, p90FirstSentenceMs,
p50DoneMs, p90DoneMs,
p50CharsPerSec, p90CharsPerSec
```

## 判定目安（採用判断はまだしない）

| 指標 | 良い | 許容 | 遅い |
|---|---:|---:|---:|
| `p90FirstSentenceMs` | < 700ms | < 1200ms | ≥ 2000ms |
| `p90DoneMs` (短いcase) | < 1500ms | < 2500ms | ≥ 4000ms |
| `p50CharsPerSec` | > 80 | > 40 | ≤ 40 |

最重要は **`p90FirstSentenceMs`**（会話AIで「相手の声が聞こえ始めるまで」のLLM寄与分の上限）。

## Stage 2 (実装済み)

- **Anthropic** `claude-haiku-4-5-20251001` — `AnthropicMessagesStreamingClient` ([packages/vendors/src/llm/anthropicStreaming.ts](packages/vendors/src/llm/anthropicStreaming.ts))。Messages API SSE。`x-api-key` header + `anthropic-version: 2023-06-01`。`content_block_delta` の `delta.type === "text_delta"` のみ採用（thinking/citation deltas は無視）。
- **Google** `gemini-2.5-flash-lite` / `gemini-2.5-flash` — `GoogleAiStudioStreamingClient` ([packages/vendors/src/llm/googleAiStudioStreaming.ts](packages/vendors/src/llm/googleAiStudioStreaming.ts))。`generativelanguage.googleapis.com` の `:streamGenerateContent?alt=sse` を使用。API key auth (ADC不要)。`candidates[].content.parts[].text` を逐次抽出。
- **Z.AI** `glm-4.5-air` / `glm-4.5-airx` / `glm-4.5-flash` — `ZaiChatCompletionsStreamingClient` ([packages/vendors/src/llm/zaiStreaming.ts](packages/vendors/src/llm/zaiStreaming.ts))。OpenAI-compatible chat completions stream。`thinking: {"type": "disabled"}` を常に body に同梱して reasoning を抑制。
- **Inworld Router** `auto` — `InworldRouterStreamingClient` ([packages/vendors/src/llm/inworldRouterStreaming.ts](packages/vendors/src/llm/inworldRouterStreaming.ts))。`https://api.inworld.ai/v1/chat/completions` で `Authorization: Basic <key>` (TTS用と同じ key)。OpenAI-compat body + `model: "auto"` で route。

共通の SSE 行 buffer は [packages/vendors/src/llm/sseParser.ts](packages/vendors/src/llm/sseParser.ts) の `readSseEvents` に切り出し、各 client は event 名 + JSON shape の解釈だけ担当する。

## Stage 3 (未実装)

- **ElevenLabs Agents hosted LLM** `GLM-4.5-Air` / `Qwen3-30B-A3B` / `GPT-OSS-120B` （temporary agent作成、本番agentに影響を出さない）
- **OpenAI Realtime** `gpt-realtime` / `gpt-4o-realtime-preview` (WebSocket)
- **Google Gemini Live** `gemini-live-2.5-flash-native-audio` (WebSocket)

これらは text streaming ではなく native voice path のため、別の measurement schema (`native-voice-summary.csv`) で扱う。

## OpenAI Responses API reasoning effort 確認ログ

`docs/OPERATIONS.md` の Phase 6 セクションを参照。
