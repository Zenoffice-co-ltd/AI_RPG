# Delivery Status

最終更新: 2026-04-03

tenant: adecco

## DOD Audit

| DOD item | Status | Evidence / note | Unblocker |
| --- | --- | --- | --- |
| トップパフォーマー transcript を import できる | done | `packages/scenario-engine/src/normalize.test.ts` と `scripts/import-transcripts.ts` で normalization と import path を確認済み | なし |
| playbook norms を build できる | done | `pnpm build:playbooks` を実行し、`pb_2026_04_03_v1` を生成・保存済み | なし |
| 3 variants の scenario pack を compile できる | done | `pnpm compile:scenarios` を実行し、3 variants を Firestore / generated artifacts に保存済み | なし |
| scenario を ElevenLabs に publish できる | done | `pnpm publish:scenario --scenario staffing_order_hearing_busy_manager_medium` が pass。10 tests 通過後に binding 保存まで確認済み | なし |
| LiveAvatar でアバター会話開始できる | done | `pnpm bootstrap:vendors` と `pnpm smoke:liveavatar` が通過し、production server 上の `/api/sessions` でも `sess_41aa8f9f672f` を開始確認済み | なし |
| transcript bubble が会話中に更新される | done | headless browser で `/roleplay/staffing_order_hearing_busy_manager_medium` を実行し、`sess_fe73fbe1b558` で transcript polling に avatar turn 1 件が反映された | なし |
| session end 後 60 秒以内に scorecard が出る | done | `sess_fe73fbe1b558` で `endedAt=2026-04-03T05:42:42.633Z`、`generatedAt=2026-04-03T05:43:36.812Z`、差分 54.2 秒を確認 | なし |
| result 画面でトップ基準との差分が見える | done | result UI に must-capture, rubric, evidence, misses, missed questions, next drills を表示 | なし |
| vendor smoke tests が通る | done | `pnpm smoke:eleven` と `pnpm smoke:liveavatar` の実環境通過を確認済み | なし |
| README だけで再セットアップできる | done | `README.md`, `docs/OPERATIONS.md`, `docs/IMPLEMENTATION.md` を `verify:acceptance` 中心に更新済み | なし |

## Acceptance Tooling

| Item | Status | Evidence / note |
| --- | --- | --- |
| `docs/DELIVERY_STATUS.md` に DOD 監査を残す | done | このファイルを正本として追加 |
| `pnpm verify:acceptance` を追加 | done | `scripts/verify-acceptance.ts` と root `package.json` に追加 |
| `bootstrap:vendors` を idempotent にする | done | 既存 `liveAvatarElevenSecretId` を既定で再利用 |
| `smoke:* -- --preflight` を追加 | done | required input block を vendor call 前に出力 |
| secret 未設定時の fail-closed | done | preflight と script 実行時の blocker classification を追加 |

## Current Blocking Inputs

- なし
- `FIREBASE_PROJECT_ID=adecco-mendan` は runtime project として確定済み
- `QUEUE_SHARED_SECRET` and `DEFAULT_ELEVEN_VOICE_ID` remain required deployment inputs outside this workstation

## Secret Source Policy

- OpenAI: `OPENAI_API_KEY env -> projects/zapier-transfer/secrets/openai-api-key-default -> fail-closed`
- ElevenLabs: `ELEVENLABS_API_KEY env -> projects/zapier-transfer/secrets/ELEVENLABS_API_KEY -> fail-closed`
- LiveAvatar: `LIVEAVATAR_API_KEY env -> projects/zapier-transfer/secrets/LIVEAVATAR_API_KEY -> fail-closed`
- Firebase target project: explicit `FIREBASE_PROJECT_ID`, never inferred from Secret Manager, and never equal to `zapier-transfer`
- Firebase Admin credentials: ADC first, optional `FIREBASE_CREDENTIALS_SECRET_NAME` only when ADC is unavailable
