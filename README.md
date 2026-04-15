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
pnpm eval:accounting
pnpm publish:scenario --scenario staffing_order_hearing_busy_manager_medium
pnpm smoke:eleven
pnpm smoke:liveavatar
pnpm verify:acceptance
```

## Manual Test Surfaces

- Text-only scenario tester: `/scenario-test/<scenarioId>`
- Static audio preview page: `/audio-preview/<scenarioId>`
- Full avatar roleplay: `/roleplay/<scenarioId>`
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

詳細は [docs/IMPLEMENTATION.md](/C:/AI_RPG/docs/IMPLEMENTATION.md)、[docs/OPERATIONS.md](/C:/AI_RPG/docs/OPERATIONS.md)、[docs/DELIVERY_STATUS.md](/C:/AI_RPG/docs/DELIVERY_STATUS.md)、[docs/PROMPTS.md](/C:/AI_RPG/docs/PROMPTS.md) を参照してください。
