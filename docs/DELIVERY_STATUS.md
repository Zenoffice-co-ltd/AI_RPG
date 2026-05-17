# Delivery Status

最終更新: 2026-05-17

tenant: adecco

## Adecco AI Roleplay vFinal Submission Status

Status as of 2026-05-17 JST: **BLOCKED for customer submission DoD and security-checksheet submission DoD**.

The vFinal security foundation evidence is recorded in
`docs/security/adecco-ai-roleplay-final-security-closeout.md`. The closeout
records PASS evidence for the dedicated no-key vFinal App Hosting runtime,
relay-only browser WebSocket path, direct `api.x.ai` count 0, metadata-only
logging with 180-day retention, sensitive log scan 0, Cloud Armor preview/log
mode on the relay LB, live text/voice E2E, ZAP baseline/passive, and current
vFinal latency sampling and strict temporary-baseline comparison. It must
remain BLOCKED until #171 workbook finalization and final guard closure are
complete.

Current vFinal blockers:

| Issue | Blocker | Required resolution |
| --- | --- | --- |
| #138 | Submitted URL decision | APPROVED pending final guard: dedicated hosted.app submitted URL approval is recorded. |
| #139 | Legacy shared App Hosting `XAI_API_KEY` scope | APPROVED pending final guard: submitted scope is the dedicated no-key vFinal backend only; legacy shared access is out of submitted scope. |
| #140 | Strict pre-vFinal latency baseline | PASS pending final guard: temporary baseline/current comparison passed with closeCode1006=0 and `relay.error=0`. |
| #141 | Canonical `verify:acceptance` closure | APPROVED pending final guard: known legacy ConvAI judge blocker is outside submitted vFinal runtime/security scope. |
| #171 | Questionnaire workbook human confirmations | Confirm or rewrite the mapped questionnaire cells before treating the security-checksheet drafts as final submission artifacts. |

Umbrella tracker #128 must remain OPEN while the table above is unresolved and
must be CLOSED before the final PASS guard can succeed.

Final PASS guard:

```bash
corepack pnpm grok:vfinal-submission-dod-status -- --expect=pass \
  --check-github-issues \
  --allow-open-approved-issues \
  --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" \
  --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

If an OPEN blocker is resolved by approval comment instead of issue closure,
`--approval-author=<approver-github-login>` or
`VFINAL_SUBMISSION_DOD_APPROVAL_AUTHORS` is required.

Useful blocked-state prechecks before requesting approval:

```bash
corepack pnpm grok:vfinal-submitted-url-candidates -- --expect=blocked
corepack pnpm grok:vfinal-legacy-xai-scope -- --expect=blocked
corepack pnpm grok:first-vfinal:latency-artifact-inventory -- --expect=blocked \
  --root out\grok_first_vfinal_latency
```

Do not change the vFinal closeout final verdict to
`Customer submission DoD: PASS` until the guard above passes and the final PR is
merged.

## DOD Audit

| DOD item | Status | Evidence / note | Unblocker |
| --- | --- | --- | --- |
| トップパフォーマー transcript を import できる | done | `packages/scenario-engine/src/normalize.test.ts` と `scripts/import-transcripts.ts` で normalization と import path を確認済み | なし |
| playbook norms を build できる | done | `pnpm build:playbooks` を実行し、`pb_2026_04_03_v1` を生成・保存済み | なし |
| 3 variants の scenario pack を compile できる | done | `pnpm compile:scenarios` を実行し、3 variants を Firestore / generated artifacts に保存済み | なし |
| accounting workbook を source registry / canonical transcript として import できる | done | workbook ingest, corpus manifest, canonical transcript, review markdown を `data/generated/corpus/enterprise_accounting_ap_gold_v1/` に保存する v2 path を追加 | なし |
| accounting derived artifacts / norms v2 を build できる | done | `scenarioSetting / roleSipoc / cultureFit / topPerformerBehavior` の envelope 保存と norms threshold policy を実装 | なし |
| accounting scenario pack v2 を semantic acceptance 付きで compile できる | done | reference artifact 比較は exact match を禁止し、`required_field_presence / persona_consistency / hidden_fact_coverage / must_capture_coverage / reveal_rule_consistency / provenance_completeness` で評価 | なし |
| accounting local eval gate を publish 前に通せる | done | `scripts/evaluate-accounting-scenario.ts` と `publishScenarioJob` で semantic acceptance + `rule-based / llm-based` local eval を必須化 | なし |
| accounting session を `evaluationMode=accounting_v2` で採点できる | done | `apps/web/server/use-cases/analysis.ts` が family で grader を分岐し、scorecard に `qualitySignals` と `evaluationBreakdown` を保存 | なし |
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
| `pnpm eval:accounting` を追加 | done | accounting compile artifact の semantic acceptance と local eval gate を単独実行できる |

## Current Blocking Inputs

- Adecco vFinal customer/security-checksheet submission remains blocked by
  #171 workbook human confirmations and #128 final guard closure. #138, #139,
  #140, and #141 have recorded approval/evidence and are pending final guard.
- `FIREBASE_PROJECT_ID=adecco-mendan` は runtime project として確定済み
- `QUEUE_SHARED_SECRET` and `DEFAULT_ELEVEN_VOICE_ID` remain required deployment inputs outside this workstation

## Accounting DOD Notes

- Corpus SoT は `enterprise_accounting_ap_gold_v1` のみ
- `accounting_clerk_enterprise_ap_100pt_output.json` は acceptance reference artifact であり runtime/storage SoT ではない
- proper noun と direct identifier は redact するが、`industry / companyScale / businessContext / systemContext / workflowCharacteristics` は保持する
- norm threshold は `coreNorm>=3`, `supportingNorm>=2`, `rareButImportant>=1 + human approved`

## Secret Source Policy

- OpenAI: `OPENAI_API_KEY env -> projects/zapier-transfer/secrets/openai-api-key-default -> fail-closed`
- ElevenLabs: `ELEVENLABS_API_KEY env -> projects/zapier-transfer/secrets/ELEVENLABS_API_KEY -> fail-closed`
- LiveAvatar: `LIVEAVATAR_API_KEY env -> projects/zapier-transfer/secrets/LIVEAVATAR_API_KEY -> fail-closed`
- Firebase target project: explicit `FIREBASE_PROJECT_ID`, never inferred from Secret Manager, and never equal to `zapier-transfer`
- Firebase Admin credentials: ADC first, optional `FIREBASE_CREDENTIALS_SECRET_NAME` only when ADC is unavailable
