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

## Adecco Manufacturer Staffing Reference Runbook

Adecco の住宅設備メーカー向け初回派遣オーダーヒアリングは、legacy staffing family の単一 reference scenario として運用する。

- Scenario ID: `staffing_order_hearing_adecco_manufacturer_busy_manager_medium`
- Runtime reference: [docs/references/adecco_manufacturer_order_hearing_reference.json](/C:/AI_RPG/docs/references/adecco_manufacturer_order_hearing_reference.json)
- Human memo: [docs/references/adecco_manufacturer_order_hearing_memo.md](/C:/AI_RPG/docs/references/adecco_manufacturer_order_hearing_memo.md)
- Voice: active voice mapping は追加せず、legacy fallback voice を使う
- Publish contract: `dictionaryRequired=false`
- ElevenLabs Agent display name: active orb agent は `[MAIN][Adecco Orb] ...`、過去の重複 Agent は `[ARCHIVE yyyy-mm-dd hh:mm][Adecco Orb] ...` として識別する
- Normalization: Orb live answers must use spoken Japanese for amounts, times, ranges, counts, and abbreviations. Examples include `時給は千五百円からです`, `千七百五十円から千九百円`, `八時四十五分から十七時三十分`, and `月十から十五時間`.

標準実行順:

1. `pnpm compile:scenarios -- --family staffing_order_hearing --reference ./docs/references/adecco_manufacturer_order_hearing_reference.json`
2. `pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium`
3. `data/generated/publish/staffing_order_hearing_adecco_manufacturer_busy_manager_medium.json` で `scenarioId`, `elevenAgentId`, `voiceId`, `ttsModel`, `testRunId`, `dashboard.agentUrl`, `dashboard.orbPreviewUrl` を確認
4. `dashboard.orbPreviewUrl` から ElevenLabs の default orb preview を開き、初回メッセージ、浅い質問への浅い返答、hidden facts の段階開示、金額・時刻・範囲表現の読み上げ、終盤の Adecco 強みの逆質問を確認

Latest execution:

- 2026-04-26: Updated the Adecco manufacturer reference, compiler prompt, pronunciation PLS, and docs to follow ElevenLabs normalization strategies for amounts, times, ranges, counts, and abbreviations.
- 2026-04-26: Published MAIN Adecco Orb successfully to `agent_2801kpj49tj1f43sr840cvy17zcc`; ElevenLabs test run `suite_7601kq3pv0jvf0e91hc0j5v7saj4` passed and orb preview is `https://elevenlabs.io/app/talk-to?agent_id=agent_2801kpj49tj1f43sr840cvy17zcc`.
- 2026-04-26: Verification passed for `pnpm compile:scenarios -- --family staffing_order_hearing --reference ./docs/references/adecco_manufacturer_order_hearing_reference.json`, targeted Vitest, `pnpm typecheck`, `pnpm test`, and `pnpm verify:acceptance -- --preflight`.
- 2026-04-26: Full `pnpm verify:acceptance` remained blocked by legacy `staffing_order_hearing_busy_manager_medium` ConvAI judge failures, not by the Adecco manufacturer scenario.

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
- 2026-04-15 時点の実測では `pcm_24000` と dictionary locator 自体は blocker ではなく、Agents PATCH payload の `tts.model_id` が `eleven_v3` のままだと `expressive_tts_not_allowed` が返る
- そのため v3 publish では Agents transport だけ `eleven_v3 -> eleven_v3_conversational` へ正規化して再検証する
- staffing live publish は `busy_manager_ja_primary_v3_f06` override と default mapping の両方で通過済み
- そのため active runtime mapping は `busy_manager_ja_primary_v3_f06` を使う
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

## Known lint debt

- `packages/scenario-engine/src/compileAccountingScenario.ts`: existing unsafe-any style lint findings.
- `packages/scenario-engine/src/accountingArtifacts.ts`: existing require-await style lint findings.
- `packages/scenario-engine/src/benchmarkRenderer.ts`: existing unused variable lint finding.
- `packages/scenario-engine/src/phase34.ts`: existing no-base-to-string / unnecessary assertion lint findings.
- `packages/scenario-engine/src/voiceProfiles.ts`: existing unused type and empty object type lint findings.

## Known issues

- 2026-04-19: `staffing_order_hearing_busy_manager_medium::no-coaching` failed 3/3 targeted publish reruns in the current working tree. Pre-Adecco baseline `4bcb980` passed on `suite_1301kpj8dk0yeezbwqj72sqf681f`; legacy scenario/assets and the no-coaching test definition had no Adecco-related diff, so this is not an Adecco reference-scenario regression.
- 2026-04-19: `accounting_clerk_enterprise_ap_busy_manager_medium::no-hidden-fact-leak` failed once during publish and passed on immediate rerun. Treat busy-manager ConvAI judge results as vendor-side unstable when a single run fails without code or prompt changes.
- 2026-04-26: Full `pnpm verify:acceptance` reached the legacy `staffing_order_hearing_busy_manager_medium` publish step and failed after 3 ConvAI judge attempts on `no-coaching`, with one retry also showing `no-hidden-fact-leak`. Adecco manufacturer publish and tests passed separately on `suite_7601kq3pv0jvf0e91hc0j5v7saj4`.

## Follow-up Backlog

- [ ] `staffing_order_hearing_busy_manager_medium::no-coaching` legacy live ConvAI judge mismatch
  - Status: 3/3 fail on 2026-04-19 in the current working tree; pre-Adecco baseline `4bcb980` passed on `suite_1301kpj8dk0yeezbwqj72sqf681f`
  - Scope: legacy compileScenarios path / system prompt / vendor transport payload / vendor judge prompt のいずれか
  - Owner: TBD
  - Acceptance: smoke:eleven 経由で 3/3 pass
