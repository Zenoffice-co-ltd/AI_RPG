# Operations

## Environment

Use `.env.local.example` as the source of truth for required variables.

Key values:

- `SECRET_SOURCE_PROJECT_ID=zapier-transfer`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CREDENTIALS_SECRET_NAME` (ADC が使えない場合のみ)
- `CLOUD_TASKS_QUEUE_ANALYZE`
- `QUEUE_SHARED_SECRET`
- `DEFAULT_ELEVEN_VOICE_ID`
- `DEFAULT_AVATAR_ID`

OpenAI は `OPENAI_API_KEY` を env で上書きできるが、未設定時は `projects/zapier-transfer/secrets/openai-api-key-default` を既定経路として参照する。

ElevenLabs は `ELEVENLABS_API_KEY` を env で上書きできるが、未設定時は `projects/zapier-transfer/secrets/ELEVENLABS_API_KEY` を既定経路として参照する。

LiveAvatar は `LIVEAVATAR_API_KEY` を env で上書きできるが、未設定時は `projects/zapier-transfer/secrets/LIVEAVATAR_API_KEY` を既定経路として参照する。

`FIREBASE_PROJECT_ID` は secret ではなく target project の明示値として扱う。active gcloud project や Secret Manager から推測しない。

`zapier-transfer` は secret source 専用であり、runtime project として使わない。Firestore / App Hosting / Cloud Tasks は Adecco 専用 project に載せる。現在の runtime project は `adecco-mendan`。

## Vendor Bootstrap

```bash
pnpm bootstrap:vendors
pnpm bootstrap:vendors -- --preflight
```

This script:

- checks ElevenLabs connectivity
- checks LiveAvatar connectivity
- checks that `SECRET_SOURCE_PROJECT_ID` is set and that `openai-api-key-default`, `ELEVENLABS_API_KEY`, and `LIVEAVATAR_API_KEY` exist in that project when env override is absent
- reuses `/settings/runtime.liveAvatarElevenSecretId` by default and creates a new LiveAvatar secret only when missing or `--refresh-secret` is passed
- fetches public avatars
- stores runtime settings in `/settings/runtime`
- writes `data/generated/vendors/bootstrap.json`

## Deploy

- App Hosting sample config lives in [apps/web/apphosting.yaml](/C:/AI_RPG/apps/web/apphosting.yaml)
- deploy target is `apps/web`
- keep all vendor secrets server-only in Secret Manager
- `FIREBASE_PROJECT_ID` is explicit config, not a Secret Manager-derived value
- `apphosting.yaml` の `FIREBASE_PROJECT_ID` sample は Adecco runtime project 候補を示すもので、`zapier-transfer` を入れてはいけない

## Smoke Tests

```bash
pnpm eval:accounting -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium
pnpm smoke:eleven
pnpm smoke:liveavatar
pnpm verify:acceptance -- --preflight
pnpm verify:acceptance
```

## Accounting Phase 3/4 Runbook

Source of Truth は transcript corpus のみです。

- Corpus SoT: `enterprise_accounting_ap_gold_v1`
- Acceptance reference artifact: [docs/references/accounting_clerk_enterprise_ap_100pt_output.json](/C:/AI_RPG/docs/references/accounting_clerk_enterprise_ap_100pt_output.json)
- Human-readable design reference: [docs/references/accounting_clerk_enterprise_ap_100pt_analysis.md](/C:/AI_RPG/docs/references/accounting_clerk_enterprise_ap_100pt_analysis.md)

標準実行順:

1. `pnpm import:transcripts -- --path "C:/Users/yukih/Downloads/【ビースタイルスマートキャリア】トランスクリプト格納.xlsx" --family accounting_clerk_enterprise_ap --mode v2`
2. `pnpm build:playbooks -- --family accounting_clerk_enterprise_ap --mode v2`
3. `pnpm compile:scenarios -- --family accounting_clerk_enterprise_ap --mode v2 --reference ./docs/references/accounting_clerk_enterprise_ap_100pt_output.json`
4. `pnpm eval:accounting -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium`
5. `pnpm publish:scenario -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium`

運用ルール:

- proper noun と direct identifier は canonical transcript で不可逆 redact する
- `industry / companyScale / businessContext / systemContext / workflowCharacteristics` は抽象属性として保持する
- local eval gate は semantic acceptance と `rule-based + llm-based` の両方が green でない限り publish しない
- publish snapshot と generated artifacts を `data/generated/` に残し、rollback は prior snapshot を基準に行う

## Voice Benchmark

```bash
pnpm voices:list
pnpm voices:collect:ja
pnpm voices:promote:shared
pnpm voices:design:ja
pnpm benchmark:render -- --scenario staffing_order_hearing_busy_manager_medium
pnpm benchmark:render -- --scenario staffing_order_hearing_busy_manager_medium --profile busy_manager_ja_baseline_v1 --profile busy_manager_ja_multilingual_candidate_v1 --profile busy_manager_ja_v3_candidate_v1 --seed 42
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-sanity
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-full
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round2-v3 --include-profile busy_manager_ja_v3_candidate_v1
pnpm review:summarize:ja -- --csv data/generated/voice-benchmark/<runId>/review-sheet.csv
```

`voices:list` writes the current voice inventory to `data/generated/voice-benchmark/voices/`.

`benchmark:render` writes `manifest.json`, `summary.csv`, `review-sheet.csv`, `index.html`, and rendered audio files to `data/generated/voice-benchmark/<runId>/`.

### Approved Voice Profile Blocker

- 2026-04-08 時点で remote dictionary `adecco-ja-business-v1` を作成済み
- approved profile の remote dictionary locator は primary / fallback の両方に設定済み
- current workspace では expressive TTS entitlement が無く、`busy_manager_ja_primary_v3_f06` / `busy_manager_ja_fallback_v3_m03` を agent publish に使うと `expressive_tts_not_allowed` が返る
- そのため active runtime mapping は `busy_manager_ja_baseline_v1` を使う
- locator を削除した場合は `pnpm smoke:eleven -- --preflight` と `pnpm verify:acceptance -- --preflight` が blocker を返す
- dictionary を更新した場合は profile JSON の locator も同時に更新すること

## JA Voice 15 Workflow

`busy_manager_ja_voice15` の運用は次の順序で進める。

1. `pnpm voices:collect:ja` で shared/workspace 候補を棚卸しする
2. `pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-sanity` で first pass を行う
3. `config/voice-profiles/ja_voice_variations/cohort.json` で Top 6 に `finalist: true` を付ける
4. `pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-full` で full pass を行う
5. `pnpm voices:design:ja` で rescue slots を explicit Voice Design に差し替える
6. `pnpm review:summarize:ja -- --csv data/generated/voice-benchmark/<runId>/review-sheet.csv` で shortlist を記録する

`R01` から `R03` は現時点では shared fallback の rescue slots であり、final approval 前に explicit Voice Design を実行する。

`data/voice-benchmark/review-sheet-ja-voice15.csv` は final shortlist の監査用記録で、manual review をスキップした場合も `pending` を残さず理由を閉じる。補足説明は `data/voice-benchmark/review-audit-ja-voice15.md` に残す。

`smoke:eleven` validates KB creation and optional agent/test execution.

`smoke:liveavatar` requires:

- `bootstrap:vendors` already run
- at least one published `AgentBinding`
- default avatar available

`verify:acceptance` is the canonical end-to-end acceptance entrypoint. It runs:

1. preflight
2. `bootstrap:vendors`
3. seed check and optional import/build/compile
4. `publish:scenario --scenario staffing_order_hearing_busy_manager_medium`
5. `smoke:eleven`
6. `smoke:liveavatar`
7. `/api/sessions` -> transcript polling -> `/api/sessions/[id]/end`
8. result polling and 60 second scorecard SLA check

If `APP_BASE_URL` is local, the script boots a local production server and delivers `/api/internal/analyze-session` directly after queue enqueue so the scorecard path remains verifiable.

## Accounting Runtime Assertions

accounting family の E2E では次を確認する。

- hidden facts が早漏しない
- shallow question では shallow response になる
- must-capture を取りに行くと十分な情報が返る
- close 時に自然な next action が返る

## Admin Auth

- `/admin/*` and `/api/admin/*` are protected by Basic Auth
- enforcement lives in [apps/web/proxy.ts](/C:/AI_RPG/apps/web/proxy.ts)
