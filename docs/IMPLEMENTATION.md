# Implementation Notes

## Runtime Flow

- tenant は `adecco` 固定

1. `POST /api/admin/transcripts/import`
   - `packages/scenario-engine/normalize.ts` で JSON / JSONL / CSV を正規化
   - Firestore `/transcripts/*` と `data/generated/transcripts/*` に保存
2. `POST /api/admin/playbooks/build`
   - OpenAI structured outputs で transcript ごとの behavior extraction を生成
   - deterministic aggregation で `PlaybookNorms` を構築
3. `POST /api/admin/scenarios/compile`
   - 3 variants の scenario pack と compiled assets を生成
4. `POST /api/admin/scenarios/[scenarioId]/publish`
   - ElevenLabs KB / agent / branch / tests を更新
   - pass 時に `/agentBindings/{scenarioId}` を更新
5. `POST /api/sessions`
   - Firestore session record を作成
   - LiveAvatar LITE + ElevenLabs plugin で session を開始
6. `GET /api/sessions/[id]/transcript`
   - LiveAvatar transcript endpoint を差分取得
   - `/sessions/{id}/turns/*` に upsert
7. `POST /api/sessions/[id]/end`
   - transcript drain 後に Cloud Tasks を enqueue
8. `POST /api/internal/analyze-session`
   - session turns + scenario + playbook を OpenAI grading
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
  - Firestore credentials are ADC-first; credential secret fallback is only needed when ADC is unavailable
- `packages/scenario-engine`
  - transcript normalization
  - behavior mining orchestration
  - playbook aggregation
  - scenario compilation
  - ElevenLabs publish flow
- `packages/scoring`
  - prompt assets
  - structured output schemas
  - grading pipeline

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
