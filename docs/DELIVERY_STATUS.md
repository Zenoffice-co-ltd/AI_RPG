# Delivery Status

最終更新: 2026-04-02

## DOD Audit

| DOD item | Status | Evidence / note | Unblocker |
| --- | --- | --- | --- |
| トップパフォーマー transcript を import できる | done | `packages/scenario-engine/src/normalize.test.ts` と `scripts/import-transcripts.ts` で normalization と import path を確認済み | なし |
| playbook norms を build できる | blocked_by_secret | OpenAI mining と Firestore 書き込みの実接続が未検証 | `OPENAI_API_KEY`, `FIREBASE_PROJECT_ID` |
| 3 variants の scenario pack を compile できる | blocked_by_project | compile code は実装済みだが、acceptance では playbook seed の再利用先と target Firestore project が未確定 | `FIREBASE_PROJECT_ID` と既存 Firestore seed もしくは local transcript corpus |
| scenario を ElevenLabs に publish できる | blocked_by_secret | publish pipeline と tests は実装済み。voice id と Eleven key 未投入 | `ELEVENLABS_API_KEY`, `DEFAULT_ELEVEN_VOICE_ID`, `FIREBASE_PROJECT_ID` |
| LiveAvatar でアバター会話開始できる | blocked_by_secret | session runtime と `/api/sessions` は実装済み。vendor key と runtime secret 未設定 | `LIVEAVATAR_API_KEY`, `ELEVENLABS_API_KEY`, `FIREBASE_PROJECT_ID` |
| transcript bubble が会話中に更新される | blocked_by_secret | polling / dedupe path は実装済み。実 vendor 会話で未受入 | `LIVEAVATAR_API_KEY`, published binding, target project |
| session end 後 60 秒以内に scorecard が出る | blocked_by_secret | SLA checker と idempotency no-op は追加済み。実 OpenAI + queue + session で未受入 | `OPENAI_API_KEY`, `QUEUE_SHARED_SECRET`, `FIREBASE_PROJECT_ID` |
| result 画面でトップ基準との差分が見える | done | result UI に must-capture, rubric, evidence, misses, missed questions, next drills を表示 | なし |
| vendor smoke tests が通る | blocked_by_secret | `pnpm smoke:eleven -- --preflight` と `pnpm smoke:liveavatar -- --preflight` は追加済み。実 key 未投入 | `ELEVENLABS_API_KEY`, `LIVEAVATAR_API_KEY`, `DEFAULT_ELEVEN_VOICE_ID`, `FIREBASE_PROJECT_ID` |
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

- `FIREBASE_PROJECT_ID`
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `LIVEAVATAR_API_KEY`
- `QUEUE_SHARED_SECRET`
- `DEFAULT_ELEVEN_VOICE_ID`
- account-side confirmations for target project / Firestore reuse / LiveAvatar secret creation
