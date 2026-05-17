# Top Performer Roleplay MVP

派遣営業トップパフォーマーのオーダーヒアリングを、`transcript -> playbook -> scenario -> roleplay -> scorecard` の流れで再現する monorepo です。tenant は `adecco` 固定です。

現在は 2 系統を並行運用しています。

- `staffing_order_hearing`: legacy `transcripts/import -> playbooks/build -> scenarios/compile -> publish`
- `accounting_clerk_enterprise_ap`: Phase 3/4 v2 `xlsx -> source registry -> canonical transcript -> derived artifacts -> norms -> scenario pack -> local eval -> publish`

## Stack

- Frontend: Next.js 16 / React 19 / TypeScript / Tailwind CSS 4
- Hosting: Firebase App Hosting
- Data: Firestore
- Queue: Cloud Tasks
- Voice / Avatar: ElevenLabs Agents + LiveAvatar + LiveKit client
- Mining / Scoring: OpenAI Responses API + strict structured outputs
- Tooling: pnpm workspace + Turborepo + Vitest + Playwright

## Workspace

```text
apps/web
packages/domain
packages/firestore
packages/vendors
packages/scenario-engine
packages/scoring
scripts
data
docs
```

## Codex Repository Layout

This repo now follows Codex's repo-scoped guidance layout.

- Root guidance: [AGENTS.md](/C:/AI_RPG/AGENTS.md)
- Focused overrides:
  - [packages/scenario-engine/AGENTS.override.md](/C:/AI_RPG/packages/scenario-engine/AGENTS.override.md)
  - [config/voice-profiles/AGENTS.override.md](/C:/AI_RPG/config/voice-profiles/AGENTS.override.md)
- Repo skills: [`.agents/skills/`](/C:/AI_RPG/.agents/skills)
- Repo rules: [`.codex/rules/repo.rules`](/C:/AI_RPG/.codex/rules/repo.rules)
- Repo hooks: [`.codex/hooks.json`](/C:/AI_RPG/.codex/hooks.json)

Notes:

- Repo skills are intentionally thin and point back to canonical docs in `docs/`.
- Hooks are experimental and, per the official Codex hooks guide, currently disabled on Windows. The repo still checks in hook config so non-Windows Codex sessions can reuse the same guardrails.

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy env sample and fill secrets:

```bash
cp .env.local.example .env.local
```

3. Bootstrap vendor connectivity and runtime settings:

```bash
pnpm bootstrap:vendors
```

Acceptance の前に不足入力だけを確認したい場合:

```bash
pnpm verify:acceptance -- --preflight
```

4. Start local app:

```bash
pnpm dev
```

## Core Scripts

```bash
pnpm import:transcripts
pnpm build:playbooks
pnpm compile:scenarios
pnpm compile:scenarios -- --family staffing_order_hearing --reference ./docs/references/adecco_manufacturer_order_hearing_reference.json
pnpm eval:accounting
pnpm publish:scenario --scenario staffing_order_hearing_busy_manager_medium
pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium
pnpm smoke:eleven
pnpm smoke:liveavatar
pnpm verify:acceptance
pnpm grok-first:v50:xlsx-voice-e2e -- --xlsx "<path-to-v50-workbook.xlsx>" --tier smoke
```

## Manual Test Surfaces

- Text-only scenario tester: `/scenario-test/<scenarioId>`
- Static audio preview page: `/audio-preview/<scenarioId>`
- Full avatar roleplay: `/roleplay/<scenarioId>`

## Adecco Manufacturer Reference Scenario

Adecco の住宅設備メーカー向け初回派遣オーダーヒアリングは、`staffing_order_hearing` family の reference-based scenario として追加しています。

- Scenario ID: `staffing_order_hearing_adecco_manufacturer_busy_manager_medium`
- Runtime reference: [docs/references/adecco_manufacturer_order_hearing_reference.json](/C:/AI_RPG/docs/references/adecco_manufacturer_order_hearing_reference.json)
- Human memo: [docs/references/adecco_manufacturer_order_hearing_memo.md](/C:/AI_RPG/docs/references/adecco_manufacturer_order_hearing_memo.md)
- Voice normalization: live answers use spoken Japanese for amounts, times, ranges, counts, and business abbreviations so Orb does not speak raw symbols such as yen ranges or time separators. Grok Voice v2.1 additionally separates spoken forms from display/evaluation text; examples such as `たしゃ`, `月のおわり`, and `周囲と合わせて進められるタイプ` are logged/displayed back as `他社`, `月末`, and `協調型`.
- Current A/B voice profile: `staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2`. v1 remains checked in for rollback.
- Grok Voice browser A/B/C routes: `/demo/adecco-roleplay-v3` is the existing control, `/demo/adecco-roleplay-v4` is narrow fallback semantic, and `/demo/adecco-roleplay-v5` is guarded flexible generation. The variant is resolved from the demo slug, not a global env-only switch.
- v50.7 Option A production voice DoD is intentionally narrow: final conclusion is only `PASS` / `FAIL` / `BLOCKED`, human testing is allowed only on `PASS`, and the `$50` API-cost stop reports `BLOCKED`. A stricter `$15` residual run may report `BUDGETED_PASS`, but that only means the reused evidence plus 45 high-risk production voice sentinel cases passed; it is not Full Option A PASS and allows only limited internal human testing. The canonical checklist and `pnpm grok:first-v50-7:natural-voice-e2e` runner notes live in [docs/GROK_VOICE_ROLEPLAY.md](docs/GROK_VOICE_ROLEPLAY.md#v507-option-a-dod).
- v50.7 voice remediation should be targeted before it is broad: after a failed budgeted/full run, inspect `results.json`, `events.jsonl`, `report.md`, and `false_pass_audit.md`, rerun only the failing ids with `--case-ids`, and return to the 45-case budgeted residual only after the targeted subset is clean.
- v50-family harnesses must capture a variant identity matrix before latency or quality claims: route/API, `demoSlug`, `backend`, `promptVersion`, `guardrailVersion`, `promptHash`, `model`, `voiceId`, `realtimeTransport`, `runtimeControl.mode`, guard flags, latency fields, and turn detection settings. Speed-smoke PASS, guard PASS, naturalness PASS, and human-test approval are separate labels.
- Keep deploy out of the v50 remediation loop: local deterministic harness, unit/hook/fixture replay, targeted failing ids, then one batched deploy. Firebase App Hosting should auto-roll out from `main`; if the App Hosting GitHub check is absent or stuck, use the fixed gcloud scripts (`pnpm deploy:adecco-roleplay:v50-7:gcloud` / `pnpm deploy:adecco-roleplay:v50-8:gcloud`) as the manual fallback. Deploy success, route/session smoke, targeted sentinel, Budgeted Residual, Full Option A, and human-test approval are separate labels.
- For v50-family App Hosting deploys through the generic gcloud wrapper, run from `C:\dev\AI_RPG\_worktrees\deploy_clean` and pass the variant (`--variant v50-7` / `--variant v50-8` / `--variant v50-7-prompt-only`) so the post-check validates `/api/grok-first-v50*/session`; batch runtime/router/guard fixes and skip deploys for docs-only, runner-only, or unit-test-only edits.
- For v50-family production smoke, start with `pnpm grok:first-v50:prod-smoke -- --variant v50-7 --mode session`, then run `start` / `voice-turn` only when needed, and pair logs with `pnpm grok:first-v50:prod-logs -- --from-smoke out/.../evidence.json`.
- Internal/customer criteria route: `/demo/adecco-roleplay-v51` uses the v50-family Grok Voice runtime shape with `backend=grok-first-v51` and the customer-provided Adecco order-hearing evaluation v2 criteria. Use `/demo/adecco-roleplay-v51/result/mock-session?mock=1` for safe browser evaluation UI checks; it does not call Claude, Gmail, ElevenLabs, or production webhooks. The shared Adecco scoring prompt/schema now defaults to `schema_version=adecco_order_hearing_eval_v2`, so v51 browser evaluation, v50-7 browser evaluation, and legacy ElevenLabs Gmail scoring use the same v2 rubric unless a future PR adds explicit evaluation-profile routing.

代表コマンド:

```bash
pnpm compile:scenarios -- --family staffing_order_hearing --reference ./docs/references/adecco_manufacturer_order_hearing_reference.json
pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium
pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium --profile staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2 --ab-test
pnpm grok:audio-e2e:browser
pnpm grok:first-v50-7:natural-voice-e2e -- --case-set budgeted-residual-dod --case-ids NAT-BUD-06,REV-BUD-08 --runs 1 --max-api-cost-usd 3
pnpm grok:first-v50:prod-smoke -- --variant v50-7 --mode session
pnpm deploy:adecco-roleplay:v50-7:gcloud
```

通常 publish は `data/generated/publish/staffing_order_hearing_adecco_manufacturer_busy_manager_medium.json` を更新します。A/B publish は既存 MAIN agent を残したまま新規 Agent を作成し、`data/generated/publish/staffing_order_hearing_adecco_manufacturer_busy_manager_medium.ab-test.json` に B 側 `dashboard.agentUrl` / `dashboard.orbPreviewUrl` / canonical branch を残します。publish 後は ElevenLabs の default orb preview で `dashboard.orbPreviewUrl` を開き、初回メッセージ、浅い質問への浅い返答、金額・時刻・範囲表現の読み上げ、終盤の Adecco 強みの逆質問を確認します。
## Accounting Phase 3/4

Corpus SoT は transcript corpus のみです。

- Corpus SoT: `enterprise_accounting_ap_gold_v1`
- Acceptance reference artifact: [docs/references/accounting_clerk_enterprise_ap_100pt_output.json](/C:/AI_RPG/docs/references/accounting_clerk_enterprise_ap_100pt_output.json)
- Human-readable design reference: [docs/references/accounting_clerk_enterprise_ap_100pt_analysis.md](/C:/AI_RPG/docs/references/accounting_clerk_enterprise_ap_100pt_analysis.md)

代表コマンド:

```bash
pnpm import:transcripts -- --path "C:/Users/yukih/Downloads/【ビースタイルスマートキャリア】トランスクリプト格納.xlsx" --family accounting_clerk_enterprise_ap --mode v2
pnpm build:playbooks -- --family accounting_clerk_enterprise_ap --mode v2
pnpm compile:scenarios -- --family accounting_clerk_enterprise_ap --mode v2 --reference ./docs/references/accounting_clerk_enterprise_ap_100pt_output.json
pnpm eval:accounting -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium
pnpm publish:scenario -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium
```

音声 tuning の補足:

- staffing live/publish は active mapping で `busy_manager_ja_primary_v3_f06` を既定解決します。approved dictionary locator を持つ v3 profile が default です。
- accounting preview / benchmark は candidate voice profile を使い、live/publish は active mapping で `accounting_clerk_enterprise_ap_ja_v3_candidate_v1` を既定解決します。
- accounting pronunciation の repo SoT は `data/pronunciation/adecco-ja-accounting-v1.pls` です。
- remote locator は `0GxlLMOqlBr3dvEhX6Ji:GGzWcurA2ogrgciNu7u5` を反映済みです。Agents publish では transport 側で `eleven_v3 -> eleven_v3_conversational` に正規化し、raw TTS benchmark は `eleven_v3` をそのまま使います。
- staffing の v3 live publish も `busy_manager_ja_primary_v3_f06` override と default mapping の両方で通ることを確認済みです。
- accounting の v3 live publish は既定 mapping と explicit profile override の両方で通ることを確認済みです。repo SoT 上の `metadata.benchmarkStatus` は引き続き `candidate` ですが、runtime default は `activeProfiles` でこの profile を既定利用します。
- live 比較用に `config/voice-profiles/accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1.json` を追加しています。default にはせず、`pnpm publish:scenario -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium --profile accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1` の explicit override でだけ使います。

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Notes

- Admin pages and `/api/admin/*` are protected by basic auth via `proxy.ts`.
- Runtime settings are stored in Firestore at `/settings/runtime`.
- Session transcripts are stored in `/sessions/{sessionId}/turns/*`, scorecards in `/sessions/{sessionId}/artifacts/scorecard`.
- accounting v2 scorecards reuse the legacy scorecard storage shape and add `evaluationMode=accounting_v2`, `qualitySignals`, and `evaluationBreakdown`.
- `ENABLE_ELEVEN_WEBHOOKS=false` keeps Eleven webhook endpoints optional and out of the critical path.
- OpenAI key resolution is `OPENAI_API_KEY env -> Secret Manager(project: zapier-transfer, secret: openai-api-key-default) -> fail-closed`.
- ElevenLabs key resolution is `ELEVENLABS_API_KEY env -> Secret Manager(project: zapier-transfer, secret: ELEVENLABS_API_KEY) -> fail-closed`.
- LiveAvatar key resolution is `LIVEAVATAR_API_KEY env -> Secret Manager(project: zapier-transfer, secret: LIVEAVATAR_API_KEY) -> fail-closed`.
- `FIREBASE_PROJECT_ID` is always an explicit non-secret target project and is never inferred from Secret Manager or the active gcloud project.
- `zapier-transfer` is secret-source only. It must not be used as `FIREBASE_PROJECT_ID` for runtime data, Firestore, App Hosting, or Cloud Tasks.
- The current Adecco runtime project is `adecco-mendan`. If that id changes later, use another Adecco-owned dedicated runtime project, not `zapier-transfer`.
- `pnpm bootstrap:vendors` is idempotent by default. If `/settings/runtime.liveAvatarElevenSecretId` already exists, it is reused unless `--refresh-secret` is passed.
- `pnpm smoke:eleven -- --preflight`, `pnpm smoke:liveavatar -- --preflight`, and `pnpm verify:acceptance -- --preflight` print the exact required input block before touching vendor APIs.
- `pnpm verify:acceptance` is the canonical acceptance entrypoint. When `APP_BASE_URL` is local, it starts a local production server and directly delivers `/api/internal/analyze-session` after queue enqueue so the scorecard path can still be verified.
- `pnpm benchmark:tts:mvp -- --preflight` validates env for the offline TTS provider comparison MVP (Cartesia / Inworld / Fish / Google Gemini / OpenAI). See [docs/TTS_PROVIDER_BENCHMARK_MVP.md](docs/TTS_PROVIDER_BENCHMARK_MVP.md). Does **not** affect live runtime.
- `pnpm benchmark:tts:response -- --preflight` validates env for the offline LLM+TTS response latency benchmark (Phase 5). 3モード (llm-only / full-text / first-sentence) で「ユーザー発話完了→AI音声が聞こえるまで」を分解測定する。詳細は [docs/TTS_RESPONSE_LATENCY_BENCHMARK.md](docs/TTS_RESPONSE_LATENCY_BENCHMARK.md)。Does **not** affect live runtime.
- `pnpm benchmark:llm:latency -- --preflight` validates env for the offline LLM model latency matrix (Phase 6). reasoning effort制御つきで OpenAI fast model 群を横並べに測り、p50/p90 first sentence を比較する。詳細は [docs/LLM_MODEL_LATENCY_BENCHMARK.md](docs/LLM_MODEL_LATENCY_BENCHMARK.md)。Does **not** affect live runtime.
- `pnpm benchmark:quality-latency -- --preflight --models <csv>` validates env for the offline Quality-Latency Pareto benchmark (Phase 6 Stage 3). 24 cases × 6 LLM × repeats で fresh generation し、rule scoring + LLM judge (blind) + pairwise blind ranking + E2E TTS + Pareto frontier を出力する。詳細は [docs/QUALITY_LATENCY_BENCHMARK.md](docs/QUALITY_LATENCY_BENCHMARK.md)。Does **not** affect live runtime.
- `pnpm chat:orb -- --llm <id> --tts <provider>` で Stage 3 候補と多ターン会話して品質を体感できるインタラクティブ CLI。Windows なら `.\scripts\chat-orb.ps1 -Llm "anthropic:claude-haiku-4-5-20251001" -Tts fish` で zapier-transfer secrets を自動ロードして即起動。詳細は [docs/CHAT_ORB.md](docs/CHAT_ORB.md)。Does **not** affect live runtime.
- `pnpm chat:orb:web` (Windows: `.\scripts\chat-orb-web.ps1`) でブラウザ UI を `http://127.0.0.1:3030` に起動。LLM × TTS dropdown 切替・streaming token 表示・autoplay 音声・preset case ボタン付。詳細は [docs/CHAT_ORB.md](docs/CHAT_ORB.md) の「ブラウザ UI」セクション。

詳細は [docs/IMPLEMENTATION.md](/C:/AI_RPG/docs/IMPLEMENTATION.md)、[docs/OPERATIONS.md](/C:/AI_RPG/docs/OPERATIONS.md)、[docs/DELIVERY_STATUS.md](/C:/AI_RPG/docs/DELIVERY_STATUS.md)、[docs/PROMPTS.md](/C:/AI_RPG/docs/PROMPTS.md) を参照してください。
