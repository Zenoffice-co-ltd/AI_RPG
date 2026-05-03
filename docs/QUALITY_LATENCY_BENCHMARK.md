# Quality-Latency Pareto Benchmark (Phase 6 Stage 3)

LLM応答の **速度 × 品質 × 音声化適性 × E2E** を同一条件で測定するベンチマーク。LiveAvatar / ConvAI publish / Firestore / Next.js UI には **一切影響しない**。

Phase 6 Stage 1/2 で speed-only な比較は完了し、`gpt-4.1-nano` / `claude-haiku-4-5` / `gemini-2.5-flash` (thinkingBudget=0) が p90 first sentence ≈ 1秒に並んだ。差が小さく速度だけでは選べないため、Stage 3 では:

- 24+ ケース (12カテゴリ×2件)
- 6 LLM (Core 3 + Quality/control 3) を fresh generation
- rule-based + LLM judge (blind) + pairwise blind の3段評価
- 上位 LLM × 3-5 TTS × 2 mode の E2E
- Pareto frontier 出力

を1つの run で実行する。

## 設計判断

- **Native voice 一部実装済 (Stage 3G ElevenLabs lane)**。OpenAI Realtime / Google Gemini Live は WebSocket protocol 実装の複雑度が高く別 Phase 6 Stage 4 に繰り越し。
- **ElevenLabs ConvAI lane** は本番 agent (`agent_2801kpj49tj1f43sr840cvy17zcc`、住宅設備メーカーシナリオ専用) ではなく、本番 agent から `glm-45-air-fp8` LLM + voice + `eleven_v3_conversational` TTS を継承して generic system prompt で **temporary benchmark agent** を作成 → 24 cases × repeats を実行 → 自動削除する方式 (`--create-temp-agent` フラグ)。本番 agent の会話履歴を汚さない & generic 24-case と評価基準が揃う。
- **Z.AI** は運用方針で除外 (`MODEL_REGISTRY` 未登録)。`ZaiChatCompletionsStreamingClient` のコードは保持。
- **Judge は Anthropic Sonnet 4.5 を主、必要に応じて OpenAI gpt-4.1 を補助**。両方使えば 2 judge cross-validation 可能。
- **LLM cache は不使用**。fresh のみ。
- **TTS は Phase 5/6 で完成済の 5 provider** (cartesia / fish / openai / inworld / google_gemini)、E2E 段階で組合せ。

## 対象モデル

`packages/scenario-engine/src/llmLatencyMatrix/modelMatrix.ts` の `MODEL_REGISTRY`。Stage 3 で追加:
- `anthropic:claude-sonnet-4-5-20250929` (Quality/judge candidate)
- `openai:gpt-4.1` (Quality/judge candidate)

合計 11 モデル登録 (5 OpenAI / 2 Anthropic / 2 Google / 1 Inworld + judge候補)。

## 評価ケース（v1: 24件）

`packages/scenario-engine/src/qualityLatency/cases.ts` を参照。12 カテゴリ × 2 件:

| category | 件数 | 観点 |
|---|---:|---|
| short_ack | 2 | 短い相槌への自然な応答 |
| busy_manager | 2 | 1〜2文で要点 |
| condition_hearing | 2 | 条件整理の正確性 |
| budget | 2 | 金額の扱い、過剰保証回避 |
| objection | 2 | 誇大表現せず確認質問 |
| ambiguous | 2 | 前提不明への確認 |
| english_mixed | 2 | 英字固有名詞の保持 |
| long_context | 2 | 期限・関係者整理 |
| numbers_dates | 2 | 数値・日付の正確性 |
| competitor | 2 | 他社名を出さない |
| next_action | 2 | 次のアクション提示 |
| safety_no_hallucination | 2 | 内部指示漏出禁止・捏造禁止 |

各 case には `mustInclude` / `mustNotInclude` / `scoringNotes` が付与され、rule-based scorer と judge prompt の両方で利用される。

## アーキテクチャ

```
packages/scenario-engine/src/qualityLatency/
  types.ts                           QualityCase / QualityRow / JudgeResult / PairwiseRow / FrontierPoint
  systemPrompt.ts                    generation system prompt (v1)
  cases.ts                           24 cases
  bootstrap.ts                       bootstrap percentile CI (resampling)
  ruleScorer.ts                      rule-based scoring
  judgeRubric.ts                     judge prompt + JSON schema (Zod + JSON Schema)
  judgeRunner.ts                     blind judge (anonymousId, retry-on-parse-error)
  pairwiseRunner.ts                  pairwise blind ranking + Bradley-Terry-style btScore
  paretoFrontier.ts                  Tier 1/2/dominated + composite score
  qualityLatencyBenchmark.ts         LLM generation runner (fresh only)
  e2eRunner.ts                       LLM出力 + TTS連結
  csvWriters.ts                      全 CSV builder
  indexHtml.ts                       index.html builder

packages/vendors/src/llm/
  anthropicStructured.ts             Anthropic Tool Use を使った JSON strict ヘルパー (judge用)
```

## Judge / Pairwise の Blind 設計

候補応答を judge に渡すとき:
- candidate の provider 名 / model 名は **絶対に prompt に入れない**
- 各 row に `anonymousId = sha1(runId|provider|model|caseId|repeatIndex).slice(0,12)` を割り当て、prompt 内ではこの匿名IDのみで識別
- pairwise では順序もシャッフル (deterministic hash で再現可能)
- judge response は JSON strict (OpenAI: `responses.create` の `text.format.json_schema` strict / Anthropic: `tool_use` の input)

判定 rubric (100点):
- intentFit (25), businessCorrectness (20), nextAction (15), conciseness (15), japaneseNaturalness (15), voiceReadiness (10)

ペナルティ:
- meta leak (-50), unsupported guarantee (-30), wrong numeric/date/count (-25), does not answer (-25), too verbose (-15), bullet/markdown (-10)

## CLI

```bash
# preflight
pnpm benchmark:quality-latency -- --preflight --models <csv>

# 1. LLM fresh generation (Stage 3A)
pnpm benchmark:quality-latency -- \
  --models openai:gpt-4.1-nano,anthropic:claude-haiku-4-5-20251001,google:gemini-2.5-flash,openai:gpt-4.1-mini,anthropic:claude-sonnet-4-5-20250929,openai:gpt-5-mini \
  --repeats 10

# 2. rule scoring (Stage 3B, instant, no API)
pnpm benchmark:quality-latency -- --score-rules --run <runId>

# 3. LLM judge (Stage 3C, blind)
pnpm benchmark:quality-latency -- --judge --run <runId> \
  --judge-models anthropic:claude-sonnet-4-5-20250929,openai:gpt-4.1

# 4. Pairwise blind ranking (Stage 3D)
pnpm benchmark:quality-latency -- --pairwise --run <runId> \
  --judge-models anthropic:claude-sonnet-4-5-20250929

# 5. E2E TTS (Stage 3E)
pnpm benchmark:quality-latency -- --e2e --run <runId> \
  --tts-providers cartesia,fish,openai,inworld,google_gemini \
  --modes first-sentence,full-text \
  --repeats 5

# 6. Pareto frontier + index.html (Stage 3F)
pnpm benchmark:quality-latency -- --pareto --run <runId>

# 7. Optional: ElevenLabs Agent lane (Stage 3G)
#    --create-temp-agent: clone production agent's LLM+voice+TTS into a temporary
#    agent with our generic system prompt, run 24 cases × repeats, auto-delete.
pnpm benchmark:quality-latency -- --elevenlabs-agent --create-temp-agent --run <runId> --repeats 3
```

## env

```
OPENAI_API_KEY=     # 必須 (openai:* + judge)
ANTHROPIC_API_KEY=  # 必須 (anthropic:* + Sonnet judge)
GOOGLE_API_KEY=     # 必須 (google:*, ADC不要)
INWORLD_API_KEY=    # 必須 (inworld:*, TTS用と共有)
```

zapier-transfer Secret Manager 運用:
- `openai-api-key-default` → `OPENAI_API_KEY`
- `anthropic-api-key-default` → `ANTHROPIC_API_KEY`
- `gemini-api-key-default` → `GOOGLE_API_KEY`
- `INWORLD_API_KEY` → `INWORLD_API_KEY`

## 出力

```
data/generated/quality-latency-benchmark/<runId>/
  manifest.json
  metrics.csv                     -- LLM generation 全行
  summary.csv                     -- per (provider × model × reasoningEffort) latency p50/p90/p95 + bootstrap CI
  rule-scores.csv                 -- 全 generation 行 × rule check
  judge-scores.csv                -- 全 generation 行 × N judge models
  judge-summary.csv               -- candidate × judge 別 avg score
  pairwise.csv                    -- pairwise 全比較
  pairwise-summary.csv            -- model 別 win/loss/tie + btScore
  e2e-metrics.csv                 -- LLM × TTS × mode × case × repeat
  e2e-summary.csv                 -- 集計
  quality-latency-frontier.csv    -- Pareto Tier 1/2/dominated + compositeScore
  llm-text/<provider>-<modelSlug>__<caseId>__r<rr>.json
  audio/<llmSlug>__<tts>__<mode>__<caseId>__r<rr>.{wav|...}
  index.html
```

`runId = p6s3-<ISO compact>`。`.gitignore` で `data/generated/quality-latency-benchmark/` 除外済。**生成 audio / metrics は commit しない。**

## Pareto 判定アルゴリズム

入力: `(llmModel, ttsProvider, mode)` 単位で集計済み点。座標は `(p90E2eFirstAudioMs, avgQualityScore)`。

- **Tier 1**: 他のどの点にも dominate されていない (速度・品質ともに上回るペアが存在しない)
- **Tier 2**: dominate されているが、Tier 1 のいずれかから tier2 tolerance (default 10%) 以内
- **dominated**: それ以外

補助 composite score (0-1):
```
0.35 * normalizedQuality
+ 0.25 * (1 - normalizedSpeed)
+ 0.15 * (1 - normalizedDone)
+ 0.15 * rulePassRate
+ 0.10 * successRate
```

## 判定目安

| 指標 | 良い | 許容 |
|---|---:|---:|
| `p90 LLM first sentence` (fresh) | < 700ms | < 1200ms |
| `p90 e2e first audio` (first-sentence) | < 1000ms | < 1500ms |
| `avg judge overallScore` | ≥ 80 | ≥ 65 |
| `rulePassRate` | ≥ 0.9 | ≥ 0.7 |
| `knockoutRate` | 0 | < 0.05 |

## 既知制約

- **Stage 3G (Native voice)** 未実装 — ElevenLabs Agents hosted / OpenAI Realtime / Google Gemini Live は別 Phase で対応
- **judge のドリフト** — 同じ judge が時間経過で評価ブレを起こす可能性。重要な比較は連続実行
- **Inworld auto router の variance** — Stage 2 で観測された通り、cold start で timeout が出る場合あり
- **gpt-5系 reasoning model** は `temperature` を渡せないため runner で自動省略 (Stage 1 既知)
- **Gemini 2.5 Flash** は `thinkingBudget=0` がないと reasoning tokens で `maxOutputTokens` を消費する (Stage 2 既知)

## 詳細運用ログ

`docs/OPERATIONS.md` の Phase 6 Stage 3 セクションを参照。
