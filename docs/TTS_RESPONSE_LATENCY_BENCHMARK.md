# TTS Response Latency Benchmark (Phase 5)

LLM込みの「ユーザー発話完了 → AI音声が聞こえるまで」の応答速度をオフライン測定するためのスクリプト。LiveAvatar / ConvAI publish / Firestore / Next.js UI には **一切影響しない**。

Phase 4 ([docs/TTS_PROVIDER_BENCHMARK_MVP.md](TTS_PROVIDER_BENCHMARK_MVP.md)) はTTS単体速度の比較。Phase 5は **LLM streaming + TTS** の合成レイテンシを3モードで分解測定する。

## 目的と問い

固定テキストTTS速度（Phase 4）だけでは、実会話で重要な「ユーザーが話し終えてからAI音声が出るまで」を判断できない。Phase 5で答えるべき問いは:

1. LLMが支配的か / TTSが支配的か
2. full-text方式（LLM全文待ち→TTS）で十分か
3. first-sentence方式（最初の1文だけ先にTTS）にどれだけ時短効果があるか
4. inworld / google_geminiのfirst audio未対応の影響
5. Cartesia / Fish / OpenAIのTTS差は、LLM込みでも体感差として残るか

採用判断はまだしない。速度の事実を3モードで取る。

## 測定モード

| モード | 内容 | TTSへ渡すテキスト | 主指標 |
|---|---|---|---|
| `llm-only` | LLM streamingのみ。TTSは呼ばない。 | — | `llmRequestToFirstTokenMs`, `llmRequestToFirstSentenceMs`, `llmRequestToDoneMs` |
| `full-text` | LLM全文を待ってからTTSへ全文を渡す | `responseText`（全文） | `e2eFirstAudioMs = llmRequestToDoneMs + ttsRequestToFirstAudioMs` |
| `first-sentence` | LLM streaming中にfirst sentence検出後、**その1文だけ**をTTSへ渡す | `firstSentenceText`（1文のみ） | `e2eFirstAudioMs = llmRequestToFirstSentenceMs + ttsRequestToFirstAudioMs` |

`first-sentence` modeの`ttsRequestToDoneMs`は **first sentence音声の完了時刻**（全文応答完了ではない）。`e2eDoneMs`はMVPでは`null`。

`overlapGainMs = (full-text同条件のe2eFirstAudioMs) − (first-sentence同条件のe2eFirstAudioMs)` を first-sentence rowに記録する。

## 日本語first sentence判定

`packages/vendors/src/llm/sentenceSegmenter.ts` の`detectFirstSentence`:

1. 「。」「？」「！」「?」「!」で終わる文があればそれをfirst sentenceとする
2. または text 40文字以上 + 読点「、」がある場合、最後の「、」までを first sentence として返す
3. **5文字未満の短すぎる相槌**（例: 「はい。」）はfirst sentenceとして扱わず、次の文を待つ

## LLM cache

provider失敗で再実行するとき、TTS provider間で **LLM応答文を揃える** ために、LLMの出力と速度値をrun横断で永続化する。

- 場所: `data/generated/tts-response-latency-benchmark/_llm-cache/openai/<cacheKey>.json`
- cacheKey入力: llmProvider, llmModel, systemPromptVersion, systemPromptHash, caseId, userInputHash, repeatIndex, temperature, maxOutputTokens, seed
- `--reuse-llm-cache`: cache hit時は live LLM を呼ばずに entry を再利用する。`llmCacheHit=true` / `llmLatencyFresh=false` でmetricsに記録される
- `--refresh-llm-cache`: cacheを無視して live LLM を再生成し、新値で上書きする
- **summary.csv の LLM latency p50/p90 は `llmLatencyFresh=true` のrowのみで計算する**（cached値の再集計を防ぐ）

## 対象ケース（8件）

`packages/scenario-engine/src/ttsResponseLatency/responseCases.ts` を参照。

| id | category | userInput |
|---|---|---|
| resp_001 | short_ack | はい、お願いします。 |
| resp_002 | busy_manager | 今立て込んでいるので、2分で要点だけお願いします。 |
| resp_003 | condition_hearing | 開始日は5月12日で、できれば3名ほしいです。 |
| resp_004 | budget_question | 時給はどのくらいまで見ておけばいいですか。 |
| resp_005 | objection | 他社にも相談しているので、まずは違いを教えてください。 |
| resp_006 | ambiguous | それってどのくらい現実的なんですか。 |
| resp_007 | english_mixed | ExcelとWMSが使える人を優先したいです。 |
| resp_008 | long_context | 物流部長と人事の確認が必要なので、候補者の見立てを明日14時までに欲しいです。 |

## env

`.env.local.example` に追記済:

```
OPENAI_RESPONSE_LATENCY_MODEL=
RESPONSE_LATENCY_SYSTEM_PROMPT_VERSION=v1
```

`OPENAI_RESPONSE_LATENCY_MODEL` 未設定時のfallback: `OPENAI_MINING_MODEL` → `OPENAI_ANALYSIS_MODEL`。実際に使ったmodel名は manifest.json と CLI ログに記録する。

## 実行コマンド

```bash
# preflight: 必要なenvと TTS provider keyをチェック
pnpm benchmark:tts:response -- --modes llm-only --preflight
pnpm benchmark:tts:response -- --modes llm-only,full-text,first-sentence --tts-providers cartesia,fish,openai,inworld,google_gemini --preflight

# Phase 5A: LLM only smoke (8 cases × 3 repeats = 24 rows)
pnpm benchmark:tts:response -- --modes llm-only --repeats 3

# Phase 5B: 3 TTS provider × 2 modes × 1 repeat (cache reuse)
pnpm benchmark:tts:response -- --tts-providers cartesia,fish,openai --modes full-text,first-sentence --repeats 1 --reuse-llm-cache

# Phase 5C: 5 TTS provider × 2 modes × 3 repeats (full benchmark)
pnpm benchmark:tts:response -- --tts-providers cartesia,fish,openai,inworld,google_gemini --modes full-text,first-sentence --repeats 3 --reuse-llm-cache
```

## CLI options

```text
--llm openai                                  default: openai (only openai supported)
--llm-model <model>                           default: env fallback解決値
--tts-providers <csv>                         cartesia,fish,openai,inworld,google_gemini
--modes <csv>                                 llm-only,full-text,first-sentence
--repeats <n>                                 default: 3
--output-dir <path>                           default: data/generated/tts-response-latency-benchmark/<runId>
--preflight                                   env / required key check のみ
--reuse-llm-cache                             cache hit時はlive LLMを呼ばない
--refresh-llm-cache                           cacheを無視して再生成・上書き
--seed <n>                                    cacheKeyに反映される seed equivalent
```

## 出力

```text
data/generated/tts-response-latency-benchmark/
  _llm-cache/openai/<cacheKey>.json        run横断の永続cache
  <runId>/
    audio/<provider>__<caseId>__<mode>__r<rr>.{wav|...}
    llm-text/<caseId>__r<rr>.json
    manifest.json
    metrics.csv
    summary.csv
    response-summary.csv
    index.html
```

`runId` は `p5-<ISO compact>`。

`.gitignore` で `data/generated/tts-response-latency-benchmark/` を除外済。**生成audioはcommitしない。**

### metrics.csv 主要カラム

```
runId, timestamp, mode, llmProvider, llmModel, systemPromptVersion,
ttsProvider, ttsModel, voiceId,
caseId, category, userInput, repeatIndex, status,
llmCacheHit, llmCacheKey, llmLatencyFresh,
llmRequestToFirstTokenMs, llmRequestToFirstSentenceMs, llmRequestToDoneMs,
llmOutputChars, llmOutputSentences,
ttsInputMode, ttsInputText, ttsInputChars,
ttsRequestToFirstAudioMs, ttsRequestToDoneMs,
audioDurationMs, rtf, firstAudioAvailable,
e2eFirstAudioMs, e2eDoneMs, overlapGainMs,
firstSentenceText, responseText,
outputFile, errorCode, errorMessage, vendorRequestId
```

### summary.csv 主要カラム

mode × llmProvider × llmModel × ttsProvider × ttsModel × voiceId 単位で集計。

```
mode, ..., total, success, failed, successRate, freshLlmRows,
p50LlmFirstTokenMs, p90LlmFirstTokenMs,
p50LlmFirstSentenceMs, p90LlmFirstSentenceMs,
p50LlmDoneMs, p90LlmDoneMs,
p50TtsFirstAudioMs, p90TtsFirstAudioMs,
p50TtsDoneMs, p90TtsDoneMs,
p50E2eFirstAudioMs, p90E2eFirstAudioMs,
p50E2eDoneMs, p90E2eDoneMs,
p50OverlapGainMs, p90OverlapGainMs,
firstAudioAvailable
```

LLM latency列は `llmLatencyFresh=true` のrowのみで計算する。

## 判定目安（採用判断はまだしない）

| 指標 | 良い | 許容 | 遅い |
|---|---:|---:|---:|
| `llmRequestToFirstSentenceMs` p90 (fresh) | < 600ms | < 1000ms | ≥ 1000ms |
| `e2eFirstAudioMs` (first-sentence) p90 | < 900ms | < 1300ms | ≥ 1300ms |
| `e2eFirstAudioMs` (full-text) p90 | < 1500ms | < 2200ms | ≥ 2200ms |
| `e2eDoneMs` (full-text) p90 | < 3000ms | < 4500ms | ≥ 4500ms |

最重要は **first-sentence の `e2eFirstAudioMs` p90**。

## 既知制約

- inworld / google_gemini は streaming 非対応のため `firstAudioAvailable=false`、`ttsRequestToFirstAudioMs=null`、`e2eFirstAudioMs=null`。`ttsRequestToDoneMs` と full-text の `e2eDoneMs` は出る。
- first-sentence mode は **計算上のE2E** であり、実パイプラインで LLM streaming 中に並行して TTS request を投げる「true pipeline」測定 (Phase 5D) は未実装。
- LLM provider は OpenAI Responses API streaming 1択。Claude / Gemini への拡張は今回スコープ外。

## OpenAI Responses API streaming docs 確認

`docs/OPERATIONS.md` の TTS response latency セクションを参照。
