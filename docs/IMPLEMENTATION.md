# Implementation Notes

## Runtime Flow

- tenant は `adecco` 固定
- `staffing_order_hearing` と `accounting_clerk_enterprise_ap` は同居する

## Family Flows

### `staffing_order_hearing` legacy

1. `POST /api/admin/transcripts/import`
   - `packages/scenario-engine/normalize.ts` で JSON / JSONL / CSV を正規化
   - Firestore `/transcripts/*` と `data/generated/transcripts/*` に保存
2. `POST /api/admin/playbooks/build`
   - OpenAI structured outputs で transcript ごとの behavior extraction を生成
   - deterministic aggregation で `PlaybookNorms` を構築
3. `POST /api/admin/scenarios/compile`
   - 3 variants の scenario pack と compiled assets を生成
   - `family=staffing_order_hearing` かつ `referenceArtifactPath` 指定時は、playbook ではなく reference artifact から単一 scenario を compile
   - Adecco manufacturer reference scenario は `docs/references/adecco_manufacturer_order_hearing_reference.json` を読み、`staffing_order_hearing_adecco_manufacturer_busy_manager_medium` を生成
   - この reference path は既存 3 variants を置換せず、publish も legacy fallback voice / `dictionaryRequired=false` を使う
   - Adecco manufacturer の live prompt と hidden facts は、ElevenLabs Orb 向けに金額、時刻、範囲、件数、英字略語を読み上げ形へ寄せる

### `accounting_clerk_enterprise_ap` Phase 3/4 v2

1. `POST /api/admin/transcripts/import`
   - workbook `シート1` を source registry 化
   - corpus manifest を `gold / silver / reject` で管理
   - Gold 6本, Silver 2本を manifest で固定
2. canonical transcript normalization
   - `seller / client / unknown` の話者推定
   - proper noun と direct identifier の不可逆 redact
   - `industry / companyScale / businessContext / systemContext / workflowCharacteristics` は抽象属性として保持
   - `unknown speaker ratio` と主話者推定で gold/silver/reject を gate
3. `POST /api/admin/playbooks/build`
   - transcript ごとに `scenarioSetting / roleSipoc / cultureFit / topPerformerBehavior` を生成
   - required field 欠落は artifact failed, optional field 欠落は `unknown` or `[]`
   - Gold のみから norms を構築
   - threshold: `coreNorm>=3`, `supportingNorm>=2`, `rareButImportant>=1 + human approved`
4. `POST /api/admin/scenarios/compile`
   - reference artifact は [docs/references/accounting_clerk_enterprise_ap_100pt_output.json](/C:/AI_RPG/docs/references/accounting_clerk_enterprise_ap_100pt_output.json)
   - exact match は取らず、semantic acceptance で判定
   - compiled assets に `promptSections`, `platformConfig`, `semanticAcceptance` を保持
5. `POST /api/admin/scenarios/[scenarioId]/publish`
   - local eval gate を先行実行
   - `rule-based + llm-based` が green の場合のみ ElevenLabs publish へ進む

## Shared Session Flow

1. `POST /api/admin/scenarios/[scenarioId]/publish`
   - ElevenLabs KB / agent / branch / tests を更新
   - pass 時に `/agentBindings/{scenarioId}` を更新
   - publish snapshot は `scenarioId`, `elevenAgentId`, `voiceId`, `ttsModel`, `testRunId`, `dashboard.agentUrl`, `dashboard.orbPreviewUrl` を追跡できる
2. `POST /api/sessions`
   - Firestore session record を作成
   - LiveAvatar LITE + ElevenLabs plugin で session を開始
3. `GET /api/sessions/[id]/transcript`
   - LiveAvatar transcript endpoint を差分取得
   - `/sessions/{id}/turns/*` に upsert
4. `POST /api/sessions/[id]/end`
   - transcript drain 後に Cloud Tasks を enqueue
5. `POST /api/internal/analyze-session`
   - staffing は legacy grading
   - accounting は `evaluationMode=accounting_v2` の grader を使い、`qualitySignals` と `evaluationBreakdown(rule_based / llm_based)` を保存
   - scorecard を `/sessions/{id}/artifacts/scorecard` に保存
   - duplicate delivery は idempotent lock で処理し、同じ `analysisVersion` の scorecard があれば no-op で completed を返す

## Package Boundaries

- `packages/domain`
  - zod schema と型の SoT
  - taxonomy / rubric / drill library / provider interface
- `packages/firestore`
  - Firestore admin client
  - repository / converter
- `packages/vendors`
  - env loader
  - timeout / retry / structured logging 付き HTTP clients
- `apps/web/server/secrets.ts`
  - shared secret helper
  - resolution order: `env -> Secret Manager(zapier-transfer) -> fail-closed`
  - OpenAI canonical secret: `openai-api-key-default`
  - ElevenLabs canonical secret: `ELEVENLABS_API_KEY`
  - LiveAvatar canonical secret: `LIVEAVATAR_API_KEY`
  - `zapier-transfer` is secret-source only; runtime Firestore/App Hosting/Cloud Tasks must use an Adecco-owned `FIREBASE_PROJECT_ID`
  - Firestore credentials are ADC-first; credential secret fallback is only needed when ADC is unavailable
- `packages/scenario-engine`
  - transcript normalization
  - workbook ingest / source registry / canonical transcript
  - accounting derived artifacts / norms v2 / semantic acceptance
  - behavior mining orchestration
  - playbook aggregation
  - scenario compilation
  - ElevenLabs publish flow
- `packages/scoring`
  - prompt assets
  - structured output schemas
  - legacy grading pipeline
  - accounting v2 grading pipeline

## UI Surface

- `/`
  - demo top + scenario cards
- `/roleplay/[scenarioId]`
  - avatar video
  - local preview
  - transcript bubbles
  - mic / camera / end
- `/result/[sessionId]`
  - overall score
  - top alignment
  - must capture
  - rubric breakdown
  - evidence turn ids
  - misses
  - missed questions
  - next drills
  - accounting v2 では `qualitySignals` と `evaluationBreakdown` も返る
- `/admin/*`
  - basic auth protected admin action pages

## Acceptance Flow

- `scripts/lib/acceptance.ts`
  - preflight blocker classification
  - required input block generation
  - 60 second scorecard SLA evaluation
- `scripts/lib/vendorFlows.ts`
  - idempotent bootstrap
  - `smoke:eleven`
  - `smoke:liveavatar`
- `scripts/verify-acceptance.ts`
  - canonical acceptance orchestrator
  - fail-fast on `missing_secret / missing_project / missing_seed / vendor_failure / app_failure`
  - local `APP_BASE_URL` の場合は web app を起動し、queue enqueue 後に `/api/internal/analyze-session` を直接 deliver できる
- `scripts/evaluate-accounting-scenario.ts`
  - accounting compile artifact に対する local eval gate
  - semantic acceptance と `rule-based + llm-based` checks を同時に確認する
