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
| LiveAvatar でアバター会話開始できる | needs_manual_account | `pnpm bootstrap:vendors` 実行時、LiveAvatar secret 作成が `Elevenlabs' third-party voice integration is only available to Elevenlabs' paid users.` で停止 | paid plan の ElevenLabs API key へ切替 |
| transcript bubble が会話中に更新される | needs_manual_account | polling / dedupe path は実装済みだが、LiveAvatar session bootstrap が上記 account blocker で未実行 | paid plan の ElevenLabs API key へ切替 |
| session end 後 60 秒以内に scorecard が出る | needs_manual_account | scorecard pipeline と SLA checker は実装済み。session start 自体が LiveAvatar bootstrap blocker で止まるため、end-to-end 受入は未完了 | paid plan の ElevenLabs API key へ切替 |
| result 画面でトップ基準との差分が見える | done | result UI に must-capture, rubric, evidence, misses, missed questions, next drills を表示 | なし |
| vendor smoke tests が通る | needs_manual_account | `pnpm smoke:eleven` は pass。`pnpm smoke:liveavatar` は runtime secret 未作成のため未通過で、原因は LiveAvatar bootstrap の paid-plan blocker | paid plan の ElevenLabs API key へ切替 |
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

- paid plan の ElevenLabs API key
- `FIREBASE_PROJECT_ID=adecco-mendan` は runtime project として確定済み
- `QUEUE_SHARED_SECRET` and `DEFAULT_ELEVEN_VOICE_ID` are already configured in the current local environment; they remain required deployment inputs outside this workstation
- `FIREBASE_CREDENTIALS_SECRET_NAME` only if ADC is unavailable
- LiveAvatar は current ElevenLabs workspace が free tier のため、`/v1/secrets` で third-party voice integration を拒否している

## Secret Source Policy

- OpenAI: `OPENAI_API_KEY env -> projects/zapier-transfer/secrets/openai-api-key-default -> fail-closed`
- ElevenLabs: `ELEVENLABS_API_KEY env -> projects/zapier-transfer/secrets/ELEVENLABS_API_KEY -> fail-closed`
- LiveAvatar: `LIVEAVATAR_API_KEY env -> projects/zapier-transfer/secrets/LIVEAVATAR_API_KEY -> fail-closed`
- Firebase target project: explicit `FIREBASE_PROJECT_ID`, never inferred from Secret Manager, and never equal to `zapier-transfer`
- Firebase Admin credentials: ADC first, optional `FIREBASE_CREDENTIALS_SECRET_NAME` only when ADC is unavailable
