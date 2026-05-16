# AI_RPG Codex Guide

## Repository Expectations

- Treat the repository root `AGENTS.md` as the default working agreement for every task in this repo.
- Keep both scenario families working: `staffing_order_hearing` is the legacy path, and `accounting_clerk_enterprise_ap` is the v2 path.
- Preserve the accounting Source of Truth split:
  - Corpus SoT: `enterprise_accounting_ap_gold_v1`
  - Acceptance reference: `docs/references/accounting_clerk_enterprise_ap_100pt_output.json`
  - Human-readable design reference: `docs/references/accounting_clerk_enterprise_ap_100pt_analysis.md`
- Do not treat generated references or publish artifacts as runtime storage SoT unless the code already does so explicitly.
- For reference-artifact staffing scenarios, keep the checked-in artifact under `docs/references/` as the human-reviewable SoT and treat `data/generated/*` as reproducible evidence unless the task explicitly asks to commit generated artifacts.
- When behavior, public contracts, or runbooks change, update the relevant docs in `docs/` in the same change.

## Secrets

- All API keys, tokens, and credentials are sourced from Google Secret Manager. The runtime (`apps/web/server/secrets.ts`) and any operational scripts must fetch from Secret Manager — never hard-code keys, never commit them to `.env*` files, and never paste them into the repo, PR descriptions, issue comments, or commit messages.
- **Resolution precedence** (every script and dev session must follow this order):
  1. Process env (`process.env["<NAME>"]`) if already set in the current shell.
  2. `apps/web/.env.local` (gitignored, local-only — never commit).
  3. Secret Manager via `gcloud secrets versions access latest --secret=<NAME> --project=<PROJECT>`. Project order: `SECRET_SOURCE_PROJECT_ID` env var → `zapier-transfer` (default) → `adecco-mendan` (per-tenant fallback for `XAI_API_KEY`, `ELEVENLABS_API_KEY`, etc.).
- **Canonical retrieval command** for ad-hoc local use:
  `gcloud secrets versions access latest --secret=<NAME> --project=<PROJECT>`
  Pull into the current shell only. Do not write the value into `apps/web/.env.local`, any tracked file, or any tool config.
- E2E and benchmark scripts must resolve secrets at runtime via the precedence above and exit with an explicit `BLOCKED: <NAME> not available` message if no source yields a real key (length ≥ 32, not a `test-…` placeholder). They must not silently fall back to placeholder strings or skip checks. The reference implementation is `loadXaiKeyFromSecretManagerIfNeeded()` in `scripts/grok-voice-v21-scenario-e2e.ts`.
- This `## Secrets` section is the cross-tool **Source of Truth**. Tool-specific surfaces re-state it (so each tool surfaces the rule natively) without owning the contract:
  - Codex command-approval guards for Secret Manager mutations (`gcloud secrets {delete,versions destroy,versions add,create,set-iam-policy,add-iam-policy-binding}`) live in [`.codex/rules/secrets.rules`](.codex/rules/secrets.rules).
  - Claude Code surface lives in [`.claude/rules/secrets.md`](.claude/rules/secrets.md).
  - Cursor surface lives in [`.cursor/rules/secrets.mdc`](.cursor/rules/secrets.mdc) (`alwaysApply: true`).
  - Any change to the retrieval contract above must update **all four** files in the same change.

## Deploy (App Hosting)

- Production roleplay UI is the Firebase **App Hosting** backend `adecco-roleplay` in `adecco-mendan` / `asia-east1`. The customer-facing URL is `https://roleplay.mendan.biz`; the default App Hosting `hosted.app` URL is an internal verification / short-term rollback URL only. The legacy Cloud Run service `roleplay-ui` covered in [`docs/deploy.md`](docs/deploy.md) is kept for older A/B routes only; do NOT run `gcloud run deploy roleplay-ui` for Grok Voice or registered-speech changes — they will not reach the live App Hosting URL.
- **Always deploy via `pnpm deploy:adecco-roleplay`.** The wrapper records the baseline rollout, runs `firebase deploy --only apphosting`, polls until rollout `SUCCEEDED`, executes `pnpm grok:warm-tts-cache`, and post-deploy verifies via `/api/v3/session`. Bare `firebase deploy` is acceptable for Cloud Build debugging only.
- **App Hosting is NOT auto-deployed on main push** for `adecco-roleplay`. Merging a PR to main does NOT make code live. Run the wrapper explicitly after every merge that needs to ship.
- **Production Source of Truth / drift prevention.** Customer-facing or closeout deploys must be from a worktree whose `HEAD` is the intended merged `origin/main` commit. If a local unmerged commit is deployed for emergency validation, treat production as drifted until the diff is PR'd, merged, verified with `git show origin/main:<path>`, and redeployed from `origin/main`.
- **Auth credential gotcha — load-bearing.** Firebase CLI uses Application Default Credentials. The default ADC at `<gcloud-config-dir>/application_default_credentials.json` is often signed in as a lower-privilege account that can read Secret Manager + list rollouts but **cannot** `firebaseapphosting.backends.get` or run `firebase deploy`. The first failure surfaces as a misleading `Failed to create backend due to missing delegation permissions for firebase-app-hosting-compute@adecco-mendan...` (the backend already exists; this is the owner-vs-non-owner identity problem).
- **The fix:** point `GOOGLE_APPLICATION_CREDENTIALS` at the **owner-level** ADC file at `<gcloud-config-dir>/legacy_credentials/<owner-account>/adc.json`. Canonical operator-workstation path: `C:/Users/yukih/AppData/Roaming/gcloud/legacy_credentials/iwase@zenoffice.co.jp/adc.json`. Do NOT run `gcloud auth application-default login` to "fix" it — that overwrites the default ADC for every other workflow on the machine.
- **Required env block** (every deploy session):
  ```bash
  export GOOGLE_APPLICATION_CREDENTIALS="<gcloud-config-dir>/legacy_credentials/<owner-account>/adc.json"
  export GROK_VOICE_VOICE_ID=99c95cc8a177
  export GOOGLE_CLOUD_PROJECT=adecco-mendan
  pnpm deploy:adecco-roleplay
  ```
- **Post-deploy verification — always run.** The wrapper's verify step only checks `guardrailVersion`. For deploys that change registered-speech artifacts, also fetch `/api/v3/session` and confirm `registeredSpeech.buildId` matches the just-promoted buildId. For relay routes, verify the session contract from `https://roleplay.mendan.biz` and confirm browser WebSocket traffic uses `wss://voice.mendan.biz/api/v3/realtime-relay`, not direct `wss://api.x.ai`. Snippets live in [`docs/deploy-app-hosting.md`](docs/deploy-app-hosting.md) §Step 3.
- **AccessGate / `セッションの開始に失敗しました`** — the demo URL `https://roleplay.mendan.biz/demo/<slug>` is gated by an HMAC-signed cookie of `DEMO_ACCESS_TOKEN`. 401 ≈ cookie missing or 8-hour `maxAge` expired; re-enter the demo access token via the AccessGate form. Token via `gcloud secrets versions access latest --secret=demo-access-token --project=adecco-mendan`. Cookie surface in [`docs/deploy-app-hosting.md`](docs/deploy-app-hosting.md) §Step 4.
- This `## Deploy (App Hosting)` section is the cross-tool **Source of Truth**. Tool-specific surfaces re-state it (so each tool surfaces the rule natively) without owning the contract:
  - Full runbook (canonical procedure + rollback + pitfalls): [`docs/deploy-app-hosting.md`](docs/deploy-app-hosting.md).
  - Agent-runnable form (`.agents/skills`): [`.agents/skills/ai-rpg-app-hosting-deploy/SKILL.md`](.agents/skills/ai-rpg-app-hosting-deploy/SKILL.md).
  - Codex command-approval guards (prompt on `firebase deploy` and the legacy Cloud Run roleplay-ui deploy) live in [`.codex/rules/deploy-app-hosting.rules`](.codex/rules/deploy-app-hosting.rules).
  - Claude Code surface lives in [`.claude/rules/deploy-app-hosting.md`](.claude/rules/deploy-app-hosting.md).
  - Cursor surface lives in [`.cursor/rules/deploy-app-hosting.mdc`](.cursor/rules/deploy-app-hosting.mdc) (`alwaysApply: true`).
  - Any change to the deploy contract above must update **all six** files in the same change.

## Working Defaults

- Prefer root `pnpm` scripts over ad hoc one-off commands so operational flows stay reproducible.
- Keep generated files out of commits unless the task explicitly needs checked-in artifacts or reviewer evidence.
- For code changes, run `pnpm typecheck` and `pnpm test` before closing the task when feasible.
- **Performance / latency claims require production observation** (Cloud Logging, browser E2E, or equivalent live measurement) before being reported as DOD. Unit / typecheck / harness PASS is a necessary but NOT sufficient signal — Layer B harness improvements do not translate 1:1 to production user-perceived metrics. See `docs/standard_migration_pipeline.md` for the canonical Phase 0 → Phase N workflow.
- For publish, release, or acceptance work, treat `pnpm verify:acceptance` as the canonical final gate.
- If `verify:acceptance` is blocked, capture the blocker explicitly and verify the underlying substeps you touched.
- When an acceptance blocker appears in a legacy path while working on a new scenario, isolate causality before closing: run the targeted scenario, compare relevant generated scenario/assets and test definitions, and record any non-task blocker in `docs/OPERATIONS.md`.
- Before any long-running browser E2E, voice E2E, spreadsheet-driven test plan, or final DoD run, perform a short preflight and report blockers before spending runtime:
  - Confirm the exact runner exists for the requested case set. If the plan is in Excel/Sheets, map each required sheet/case set to an executable command first; a narrower harness is scoped evidence, not final DoD.
  - Confirm required secrets by name and alias without printing values.
  - Confirm the package script still exists, or run the underlying script directly and note why.
  - Confirm local dev-server ports and stale Next/Turbo processes before starting; reuse an existing server only after a one-turn event-capture check passes.
  - State the DoD denominator up front, for example `5-case back-to-back harness`, `13/13 guard smoke`, `69 P0 guards`, or `93-turn full`.
- For production voice / relay regressions, use the shortest diagnostic ladder before redeploying or running broad E2E:
  1. Verify the route session API returns 200 and the expected identity fields (`demoSlug`, `backend`, `promptVersion`, `guardrailVersion`, `realtimeTransport`, `wsUrl`, auth mode, and payload-inclusion flags).
  2. If the session API fails, inspect App Hosting rollout/build status, Cloud Build logs, cookie/access state, and App Hosting env/secret bindings. Do not investigate the relay first.
  3. If the session API succeeds and the route uses Cloud Run relay, check `https://voice.mendan.biz/healthz`, then relay Cloud Logging for `client.connected`, `ticket.accepted`, `upstream.connected`, and `first.upstream.audio.delta`.
  4. Run a focused browser smoke for the exact route and event endpoint. For v50-family routes, events are under `/api/grok-first-v50*/event` and Cloud Logging scope is `grokFirstV50`, not `/api/v3/event` / `grokVoice.*`.
  5. Only after the focused smoke and same-session Cloud Logging are understood, run spreadsheet/full E2E or redeploy again.
- App Hosting and Cloud Run relay are separate failure domains. App Hosting owns `/demo/*`, `/api/grok-first-v50*/session`, AccessGate cookies, env/secret binding, prompt/guardrail identity, and relay ticket issuance. Cloud Run relay owns `wss://voice.mendan.biz/api/v3/realtime-relay`, relay ticket validation, xAI upstream connection, and upstream audio deltas. `ticket.rejected` means ticket/audience/path/secret; missing `upstream.connected` means relay `XAI_API_KEY`/IAM/xAI upstream; missing `client.connected` means browser/CSP/DNS/LB before relay logic.
- Do not repeatedly run one-off `.codex_tmp` harnesses for reusable release evidence. Promote recurring E2E/logging flows to `scripts/`, add a package script, make secret resolution fail closed, and write evidence under `out/<workflow>/<timestamp>/`.

## Voice E2E Natural Conversation SoT

- As of the 2026-05-16 v50.8 CTO report, confirmed evidence is mainly `fixed_external` back-to-back stabilization. It does **not** prove Excel `04_Turn_Cases`, `05_P0_Guards`, full E2E, normal sales-turn Realtime quality, or human-test readiness.
- The top voice E2E goal is now: **do not allow unnatural normal sales conversation to pass**. Fixed guard remains required, but normal sales naturalness is the first gate.
- The gate order is:
  `Version / Route Sanity` → `Natural Conversation Smoke` → `Customer-Led Output` → `Backchannel / Low-Information` → `Reveal Depth` → `Normal Sales Voice E2E` → `Fixed Guard / P0 Guard` → `Full Regression`.
- A run without route/version provenance is an **invalid run**, not PASS/FAIL. Capture `route`, `apiBase`, `demoSlug`, `backend`, `promptVersion`, `guardrailVersion`, `promptHash`, commit SHA, `model`, `voiceId`, and `realtimeTransport`; require `session.created` plus either `ws.connected` or an explainable fixed-guard bypass.
- For v50.8 naturalness work, expected identity is `promptVersion=grok-first-v50.6-2026-05-15` and `guardrailVersion=grok-first-v50.8-guard-2026-05-16` unless a later explicit version is under test.
- These are P0 hard fails even when meaning/facts are otherwise correct:
  `customer_led_sales_flow_detected`, `generic_closing_question_detected`, `ask_salesperson_next_topic_detected`, `low_information_input_new_topic_detected`, `over_disclosure_detected`, `forbidden_suffix_audible`, `role_break`, `prompt_leak`, `evaluation_leak`, `fixed_guard_missing`, `turn_completed_missing`, and `audio_leak_before_trim`.
- Any normal sales turn containing customer-led phrases is P0 FAIL. Examples include `どんなところからお話ししましょうか`, `何からお話ししましょうか`, `少し詳しくお話ししましょうか`, `業務内容や条件についてもお話しできます`, `業務内容の大枠からお話ししましょうか`, `どういうところからお聞きになりますか`, `何か他に気になる点はありますか`, `何か他に`, `ご質問があれば`, `具体的に知りたい部分があれば`, `このあたりで大丈夫でしょうか`, `進めていただけますか`, `お聞きになりますか`, and `お話しできますよ`.
- Backchannel or low-information user inputs (`はい`, `うん`, `そうですね`, `そうですか`, `なるほど`, `分かりました`, `ありがとうございます`, `へえ`, `あ、そうなんですね`) must not start a new topic, invite the salesperson to choose the next topic, move into conditions/job duties, or over-disclose hidden facts. No response or a single short acknowledgement is acceptable.
- Reveal depth is judged before keyword success: shallow questions get one point only, background questions get background only, deep-dive questions get one deeper layer, hypothesis checks get confirmation plus one correction, summaries get agreement or one correction, and backchannels get no new topic.
- PASS ordering is strict: invalid-run check → P0 hard fail check → conversation ownership → reveal-depth fit → required semantic elements → sentence/forbidden phrase checks → audible leak checks → final PASS. Semantic evaluators cannot override deterministic hard fails.
- Audio leak evaluation must inspect `rawAssistantTranscript`, `visibleAssistantTranscript`, and `audibleTranscriptDelta`/preview separately. If a P0 forbidden phrase is audible or appears in raw deltas before trimming, the turn FAILS even if the final visible transcript is clean.
- Required `turn.completed`/event observability for naturalness runners: `rawAssistantTranscript`, `visibleAssistantTranscript`, `audibleTranscriptPreview`, `inputIntent`, `expectedRevealLevel`, `actualRevealLevel`, `customerLedSalesFlowDetected`, `genericClosingQuestionDetected`, `lowInformationInputDetected`, `newTopicStartedAfterLowInfo`, `overDisclosureDetected`, `hardFailReasons`, `naturalnessScore`, `semanticEvaluatorScore`, and `audioLeakDetected`.
- Human testing is blocked until, at minimum: Natural Smoke Text `30/30 x3`, Backchannel `50/50`, Customer-led Output Guard `100/100`, Natural Transition E2E `11/12` or better with P0 hard fail `0`, Voice/STT Natural Smoke P0 hard fail `0`, Fixed Guard P0 pass, and PASS-case false-pass audit `0`.
- `IMG-REGRESSION-001` is the first mandatory scenario: greeting must not ask "どんなところから", background question must answer background only, deep-dive request may reveal only one deeper layer, and `そうですか` / `うん` must not start a new topic. One failure blocks human testing.

## Always Before Merge

- Update `README.md` and the relevant `docs/` runbook when commands, behavior, operational flow, or acceptance evidence expectations change.
- Update or add repo skills under `.agents/skills/` when a workflow becomes reusable or when canonical commands/guardrails for an existing workflow change.
- Update `.codex/rules/` or `.codex/hooks/` when you introduce a new safety-sensitive command flow, destructive operation, or recurring prompt-routing need.
- Keep tests, smoke checks, and acceptance scripts aligned with any changed runtime, compile, publish, scoring, or vendor contract.
- When voice-profile mapping changes, update the profile JSON, `config/voice-profiles/scenario-map.json`, and publish-readiness evidence together.
- Do not mark orb preview DoD as complete from generated snapshots or ConvAI tests alone. Human orb utterances must be captured in the relevant memo; otherwise leave the memo as a blocker with the preview URL.

## Always After Merge

- **Verify the squash actually captured your latest commits.** Immediately after `gh pr merge` returns, run `git show origin/main:<path>` against a unique signature line from your latest change. Squash can pick up an older parent commit if the merge was queued before a late push (cf. PR #80 → PR #81 mismatch incident). The PR's "merged" badge, the PR body, and the head SHA are leading indicators, NOT authoritative.
- **Every behavior-changing PR must ship with an env-flag rollback that does NOT require a client redeploy.** The flag is read fresh on the next request (typical pattern: surface it through `/api/v3/session`), so flipping the env immediately reverts behavior. Document the flag in the PR body, verify it in a unit test, and re-document it in the relevant skill. Reference implementations: `GROK_VOICE_STRICT_PLAYBACK_MODE` (PR #85), `GROK_VOICE_LOCKED_AUDIO_BUNDLE_ENABLED` (PR #87). Additive route-only prompt variants may use the prior stable route as the rollback path instead of adding an env flag, but only if existing URLs and APIs remain unchanged, the PR body names the rollback URL, and the relevant repo skill/runbook records the exception.
- For Firebase App Hosting deploys, see the dedicated [`## Deploy (App Hosting)`](#deploy-app-hosting) section above (cross-tool SoT) and the runbook at [`docs/deploy-app-hosting.md`](docs/deploy-app-hosting.md). The legacy Cloud Run flow at [`docs/deploy.md`](docs/deploy.md) is for the older `roleplay-ui` service only.
- For v50-family deploy evidence, the `/api/v3/session` post-check is not enough. Also run `pnpm grok:first-v50:prod-smoke -- --variant <v50-x> --mode start` and, for voice behavior changes, `pnpm grok:first-v50:prod-smoke -- --variant <v50-x> --mode voice-turn`, then fetch same-session logs with `pnpm grok:first-v50:prod-logs -- --session <gfv50_...>`.

## Directory Map

- `apps/web`: Next.js app, admin surface, internal APIs, session runtime.
- `packages/scenario-engine`: transcript import, playbook generation, compile, eval, publish orchestration.
- `packages/scoring`: scorecard generation and grading.
- `config/voice-profiles`: ElevenLabs profile definitions and active scenario mapping.
- `scripts`: operational entrypoints invoked by `pnpm`.
- `docs`: human-facing implementation, runbook, and reference material.

## Local Overrides

- `packages/scenario-engine/AGENTS.override.md` adds accounting pipeline rules.
- `config/voice-profiles/AGENTS.override.md` adds voice-profile and publish-readiness rules.

## Repo-Scoped Skills

- Codex repo skills live under `.agents/skills/`.
- Keep each skill focused on one workflow and point back to canonical repo docs instead of duplicating long instructions.

## Repo-Scoped Rules And Hooks

- Repo command-approval rules live under `.codex/rules/` (Codex) with cross-tool mirrors at `.claude/rules/` (Claude Code) and `.cursor/rules/` (Cursor). The Codex mirror uses `prefix_rule()` DSL; the Claude / Cursor mirrors are markdown / `.mdc` thin wrappers that point back to AGENTS.md as SoT.
- When introducing a safety-sensitive command flow, destructive operation, or canonical retrieval pattern, update AGENTS.md as the SoT first, then add (or amend) the matching surface in each of `.codex/rules/`, `.claude/rules/`, and `.cursor/rules/`.
- Repo hooks live under `.codex/hooks.json` and `.codex/hooks/`.
- Hooks are experimental and currently disabled on Windows in Codex, so do not rely on hooks as the only safety mechanism for this repo.
