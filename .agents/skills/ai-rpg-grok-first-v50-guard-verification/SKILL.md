---
name: ai-rpg-grok-first-v50-guard-verification
description: Use when verifying or reporting Grok-first v50 normal sales conversation naturalness, voice E2E, fixed guard behavior, guard smoke, assistant-only drain, spreadsheet-defined test plans, or browser E2E evidence for `/demo/adecco-roleplay-v50*` and `/api/grok-first-v50*`.
---

# AI RPG Grok-first v50 Voice E2E Verification

Use this skill for v50 voice E2E and evidence. The 2026-05-16 source of truth
changed the priority from fixed-guard-first verification to
normal-sales-conversation naturalness first. Fixed guard evidence is still
required, but it can no longer stand in for normal sales Realtime quality.

Do not use this skill for browser evaluation result pages, scorecard UI, or
Claude scoring / Gmail delivery separation. Use
`.agents/skills/ai-rpg-v50-browser-evaluation/SKILL.md` for those.

## Canonical Sources

- `AGENTS.md` `## Voice E2E Natural Conversation SoT`
- `AGENTS.md` `## Secrets` and `## Working Defaults`
- `docs/GROK_VOICE_ROLEPLAY.md`
- `.agents/skills/ai-rpg-acceptance-verification/SKILL.md`
- `scripts/grok-first-v50-prod-smoke.mjs`
- `scripts/grok-first-v50-prod-logs.mjs`
- `scripts/grok-first-v50-voice-e2e.mjs`

## Current Evidence Boundary

As of the 2026-05-16 v50.8 CTO report, confirmed evidence is mainly
back-to-back `fixed_external` stabilization. Do not claim these are complete
unless an exact runner/evidence set exists:

- Excel `04_Turn_Cases`
- Excel `05_P0_Guards`
- full 93-turn E2E
- normal sales-turn Realtime quality
- human-test readiness

Scoped fixed_external evidence is valuable, but it is not final DoD.

## Harness-First Contract

Before changing v50 runtime behavior or reporting production evidence, write
down the smallest executable harness and its denominator. Every run must capture
a variant identity matrix before judging either speed or quality:

- route and API base
- `demoSlug`, `backend`, `promptVersion`, `guardrailVersion`, and `promptHash`
- commit SHA when available, `model`, `voiceId`, and `realtimeTransport`
- `runtimeControl.mode`, all guard flags, and response orchestration mode
- `latencyMode`, `streamAudioBeforeDone`, `audioHoldMs`,
  `turnDetection.silence_duration_ms`, and `turnDetection.create_response`

Use this ladder before spending on broad voice E2E: route/API 200, session
identity, relay connection, STT completed, response orchestration consistency,
first assistant audio delta, first audible audio, `response.done`,
`turn.completed`, then manual review or the wider DoD. Promote repeated checks
to `scripts/` and write evidence under `out/<workflow>/<timestamp>/`; do not
build release evidence from repeated `.codex_tmp` one-offs.

Speed and quality are separate gates. A speed smoke PASS does not imply
naturalness, guard correctness, prompt-only usability, or product human-test
readiness. Mark speed-only work as `Quality status: NOT EVALUATED` until the
relevant naturalness/guard denominator is rerun.

## v50.7 Prompt-Only Diagnostic Route

Use `/demo/adecco-roleplay-v50-7-prompt-only` only when measuring the v50.7.2
prompt without app-side runtime assistance. This route is diagnostic, not a
human-test rollout approval path.

Use `/demo/adecco-roleplay-v50-7-quality` when validating the v50.7.2
prompt-only base with runtime quality guards enabled. Expected identity:

- `demoSlug=adecco-roleplay-v50-7-quality`
- `backend=grok-first-v50-7-quality`
- `promptVersion=grok-first-v50.7.2-natural-interactive-sales-compact-2026-05-17`
- `guardrailVersion=grok-first-v50.7-quality-guard-2026-05-17`
- `runtimeControl.mode=default`
- `runtimeGuardrailsEnabled=true`
- `normalInputRouterEnabled=true`
- `boundedRewriteEnabled=false` for the first quality gate
- `streamAudioBeforeDone=false`
- `fullTurnBufferEnabled=false`
- `turnDetection.create_response=false`
- browser evaluation disabled

The quality route is not the speed hotfix. It holds Realtime audio until
`response.done` and uses `fullTurnBufferCount`, `tailAudioDroppedBytes`, and
raw/visible/audible transcript evidence for the quality guard DoD.
The v50.7-quality first message must also be audible: after `session.ready`, the
client records `opening.playback.started` and `opening.playback.completed` with
`firstAudibleAudioMs` for the cached static opening audio.
Bounded rewrite is disabled in the first production quality route because the
route starts from v50.7.2 prompt-only behavior and uses runtime guards for
input suppression, fixed responses, negative output detection, and audio
hold/drop.
For hard P0 actions (`cancel` / `suppress`), quality route drops held audio.
For tail-only actions (`strip_tail` / `drop_sentence`), quality route attempts
Approx Chunk release of the safe body without Runtime TTS. Low-risk complete
safe sentences may start after a short delayed hold; the boundary prefers
transcript-delta order, falls back to character ratio, and always drops the
trailing safety window/chunk for tail-only decisions. Boundary failure is reported as
`audioReleaseMode=tail_only_drop_fallback` and blocks
`ROLEPLAY_FUNCTIONAL_PASS`.
`ROLEPLAY_FUNCTIONAL_PASS` additionally requires normal-sales audible output,
customer-led safe-body audible output, no safe-body all-drop, no normal-sales
`tail_only_drop_fallback`, no chat-visible/audible transcript mismatch, opening
audio present, `turn.completed` completeness, audio leak `0`, false-pass audit
`0`, and `firstAudibleAudioMs` p50 `<3000ms` / p95 `<7000ms`.

## v50.7 In-place Speed Hotfix

As of 2026-05-17, `/demo/adecco-roleplay-v50-7` may be deployed in-place as a
speed-only hotfix. Do not create `v50.7.1` or `v50.7-speed` for that check. The
expected identity is still `demoSlug=adecco-roleplay-v50-7`,
`backend=grok-first-v50-7`, and `promptVersion=grok-first-v50.6-2026-05-15`,
but `guardrailVersion` becomes
`grok-first-v50.7-speed-hotfix-2026-05-17`.

Expected speed-hotfix fields:

- `latencyMode=fastest_streaming`
- `streamAudioBeforeDone=true`
- `audioHoldMs=0`
- `normalInputRouterEnabled=false`
- `boundedRewriteEnabled=false`
- `turnDetection.silence_duration_ms=350`
- `turnDetection.create_response=false`

The normal input router is intentionally bypassed for this speed-only hotfix to
avoid rewrite-response stalls during manual latency checks. Treat quality as NOT
EVALUATED.

This is not a quality or naturalness PASS. Report `Quality status: NOT
EVALUATED` and the known risk that audio may be heard before the final
transcript guard. Manual access is `manual speed check only`.

Expected identity:

- `demoSlug=adecco-roleplay-v50-7-prompt-only`
- `backend=grok-first-v50-7-prompt-only`
- `promptVersion=grok-first-v50.7.2-natural-interactive-sales-compact-2026-05-17`
- `guardrailVersion=prompt-only-no-runtime-guard-2026-05-17`
- `runtimeControl.mode=prompt_only`
- no prompt-only speed-hotfix latency fields
- `turnDetection.silence_duration_ms=650`
- all runtime guard/router flags false:
  `runtimeGuardrailsEnabled`, `inputGuardEnabled`, `normalInputRouterEnabled`,
  `negativeGuardEnabled`, `tailGuardEnabled`, `fixedGuardAudioEnabled`,
  `boundedRewriteEnabled`, `noiseIgnoredEnabled`, `fullTurnBufferEnabled`, and
  `replacementTtsEnabled`

The v50.7.2 prompt itself must not change. The prompt-only route uses manual
response orchestration (`turnDetection.create_response=false` and one app-side
`response.create` after non-empty STT), but must not use content-based
`response.cancel`, fixed guard audio, input guard, normal input router, negative
output guard, tail/audio guard, bounded rewrite, suppression, or `noise_ignored`.

Before manual review, run:

```bash
pnpm grok:first-v50-7-prompt-only-smoke -- \
  --base-url https://roleplay.mendan.biz \
  --route /demo/adecco-roleplay-v50-7-prompt-only \
  --api-base /api/grok-first-v50-7-prompt-only \
  --case-set prompt-only-smoke \
  --runs 1 \
  --out out/grok_first_v50_7_prompt_only/smoke_<timestamp>
```

Smoke PASS only means the route/session/realtime/guard-off/voice path is ready
for manual diagnostic review. It does not mean `PROMPT_ONLY_USABLE`.

Prompt-only conclusion rules:

- `PROMPT_ONLY_USABLE`: v50.6 prompt identity, runtime guard fully off, voice
  path established, guard event `0`, fixed guard audio `0`, content cancel `0`,
  manual review `P0=0`, and manual review `P1<=3`.
- `PROMPT_ONLY_NOT_USABLE`: voice path works, but prompt-only has at least one
  P0 naturalness, off-scope, sentence-count, or role-break failure.
- `PROMPT_ONLY_BLOCKED`: route, session, realtime, guard-off proof, or voice
  path fails.

For v50.7 Option A evidence, use
`scripts/grok-first-v50-7-natural-voice-e2e.mjs`. It is the runner that captures
route/API preflight, actual session identity, production voice-path events,
raw/visible/audible transcripts, false-pass audit, and the API-cost stop rule.
The runner's `$50` cost stop is unconditional: if the next runtime voice case or
the remaining required Option A production voice suites are projected to exceed
`$50`, stop and report `BLOCKED` with `human test allowed = no`. Do not continue
spending API budget to chase PASS, and do not replace missing production voice
suites with text-only, local-only, or fixed-guard-only evidence. The runner may
use a lower `--max-api-cost-usd` limit for stricter stops, but runtime case cost
estimates are clamped to at least the default conservative `$0.25`; do not lower
the estimate to bypass the `$50` stop.

The v50.7 Option A DoD is intentionally narrow and is documented in
`docs/GROK_VOICE_ROLEPLAY.md#v507-option-a-dod`. Final conclusion must be
exactly one of `PASS`, `FAIL`, or `BLOCKED`. PASS requires all 12 checklist
items: production route/API, actual identity, production voice events,
Evaluator calibration, IMG `15/15`, Natural Smoke `90/90`, Backchannel `150/150`,
Reveal Depth `90/90`, Natural Transition 12 voice scenarios with turn pass
`>=95%` and P0 `0`, Mixed Recovery `3/3`, Fixed Guard Smoke `39/39` with
`<missing>=0`, and all leak/false-pass counts `0`. Any non-PASS result means
`human test allowed = no`.

For the explicitly budgeted v50.7 residual gate, use the same runner with
`--case-set budgeted-residual-dod --reuse-existing-evidence <dir>
--existing-estimated-spent-usd 3.75 --max-api-cost-usd 15`. This gate reuses
existing preflight/session/evaluator/IMG evidence and runs exactly 45 high-risk
production voice sentinel cases. Its final conclusion is `BUDGETED_PASS`,
`FAIL`, or `BLOCKED`, never `PASS`. `BUDGETED_PASS` means only that the 15 USD
high-risk residual gate passed; Full Option A remains `NOT COMPLETE under full
denominator`, and human testing is limited to `limited_internal_only`.

### v50.7 Budgeted Remediation Ladder

When a budgeted residual or full Option A voice run fails, do not immediately
rerun the full denominator. Use this order:

1. Read `results.json`, `events.jsonl`, `report.md`, and
   `false_pass_audit.md`; do not diagnose from the report alone.
2. Build a `--case-ids` subset from the exact FAIL/BLOCKED/suspected false-pass
   cases. Name evidence directories `remediate_remaining_<n>` for known
   residual failures and `remediate_after_full_<n>` for new failures discovered
   by a full run.
3. Patch in one batch, then run local deterministic gates before deploy:
   `git diff --check`, `node --check scripts/grok-first-v50-7-natural-voice-e2e.mjs`,
   `corepack pnpm --filter @top-performer/web test -- grok-first-v50`, and
   `corepack pnpm --filter @top-performer/web typecheck`.
4. Deploy once for the batch, then run only the targeted production subset with
   a strict `--max-api-cost-usd`.
5. Only after the targeted subset is clean, rerun the 45-case
   `budgeted-residual-dod` suite. If that full run reveals new failures, repeat
   from step 1 with only the new case ids.

For v50.7 normal input routing, treat recurring STT confusion as runtime-router
data, not prompt work. Current known production confusions include
`炭火レンジ -> 単価レンジ`, `求人状況` / `会社状況 -> 他社状況`, and
`スピードバック -> フィードバック`. High-risk rewrites should prefer
`「...」とだけ一文で答えてください` fixed-safe wording over long negative
instruction lists; if a negative instruction leaks into raw/visible/audible
transcript, make it a guard pattern and a unit fixture.

### v50.7 Quality Guard Fast Loop

Use this loop for `/demo/adecco-roleplay-v50-7-quality`. It is a guarded clone
of the v50.7.2 prompt-only route, not the speed hotfix.

1. Start from the smallest failed denominator. Read `results.json`,
   `events.jsonl`, `report.md`, and `false_pass_audit.md` before editing.
2. Convert the failure into a deterministic unit/hook/fixture check when
   possible, especially for `noise_ignored`, false-positive negative guard,
   `tail_only_drop_fallback`, visible/audible mismatch, and latency accounting.
3. Patch router/guard/runtime behavior in one batch. Do not redeploy for every
   phrase-table or evaluator tweak.
4. After one main-branch rollout, run route smoke first:
   `pnpm grok:first-v50:prod-smoke -- --variant v50-7-quality --mode session`,
   then `--mode start`, then `--mode voice-turn`.
5. Run the targeted six-case sentinel before the 30-case workbook:

```bash
pnpm grok:first-v50-7:natural-voice-e2e -- \
  --base-url https://roleplay.mendan.biz \
  --route /demo/adecco-roleplay-v50-7-quality \
  --api-base /api/grok-first-v50-7-quality \
  --case-set quality-guard-focused-csv \
  --case-ids LIG-10,NFP-01,OUT-01,OUT-02,OUT-03,OUT-04 \
  --runs 1 \
  --out out/grok_first_v50_7_quality_guard/<timestamp>/targeted_6
```

If the targeted six fail, stop and report `human test allowed = no`. Rerun only
the failed or suspected false-pass ids with `--case-ids` after the next patch.
Run the full 30-case quality workbook only after the targeted six pass.

Human testing requires `ROLEPLAY_FUNCTIONAL_PASS`, not only
`QUALITY_GUARD_PASS`. The required functional signals are: opening audible,
normal-sales audible non-empty `5/5`, customer-led safe-body audible `4/4`
where a safe body exists, safe-body all-drop `0`, normal-sales
`tail_only_drop_fallback` `0`, audio leak `0`, false-pass audit `0`,
chat-visible/audible mismatch `0`, `turn.completed` `100%`, and production
`firstAudibleAudioMs` p50 `<3000ms` / p95 `<7000ms`.

### Deploy Productivity

App Hosting rollout time is minutes, so optimize for fewer deploys:

- First convert production failures into deterministic local evidence: unit
  tests, hook tests, fixture replay, and targeted `--case-ids` subsets. Do not
  use production deploy as the normal phrase-by-phrase test loop.
- Batch router/guard phrase fixes before deploying; do not deploy after each
  single phrase.
- Runner, docs, and unit-test-only edits do not need App Hosting deploy.
- Changes under `apps/web/lib/grok-first-roleplay/**`, route/session APIs, or
  client runtime behavior do need deploy before production voice evidence.
- The default post-merge deploy path is native Firebase App Hosting automatic
  rollout from the `main` live branch. Confirm the App Hosting GitHub check or
  Firebase Console rollout status before running production smoke.
- Use the gcloud deploy wrapper only as the manual fallback with the relevant
  v50 post-check:

```bash
corepack pnpm deploy:adecco-roleplay:gcloud -- --variant v50-7 --skip-tts-warm
```

The v50 post-check must inspect `/api/grok-first-v50-7/session`; a v3
`/api/v3/session` check is not sufficient evidence for v50-family changes.
After rollout, run `pnpm grok:first-v50:prod-smoke -- --variant v50-7 --mode
start`, then use a small targeted production voice sentinel only when needed.
Full/Budgeted DoD is reserved for release-candidate or human-test gates.

## Gate Order

Run or design evidence in this order:

1. Version / Route Sanity Gate
2. Natural Conversation Smoke
3. Customer-Led Output Gate
4. Backchannel / Low-Information Gate
5. Reveal Depth Gate
6. Normal Sales Voice E2E
7. Fixed Guard / P0 Guard
8. Full Regression

This order is intentional. A fixed guard pass cannot excuse a route that sounds
unnatural during normal sales conversation.

## Layer 0: Version / Route Sanity Gate

Before judging PASS/FAIL, capture:

- `route`
- `apiBase`
- `demoSlug`
- `backend`
- `promptVersion`
- `guardrailVersion`
- `promptHash`
- commit SHA
- `model`
- `voiceId`
- `realtimeTransport`

For v50.8 naturalness work, expected identity is:

- `promptVersion=grok-first-v50.6-2026-05-15`
- `guardrailVersion=grok-first-v50.8-guard-2026-05-16`

Require `session.created` and either `ws.connected` or an explainable fixed
guard bypass. If provenance is missing, report `INVALID RUN`, not PASS/FAIL.
Do not report a prompt improvement if only the guard runtime changed.

## Natural Conversation Smoke

The first mandatory regression is `IMG-REGRESSION-001`. One failure blocks
human testing.

| Turn | User input | Expected |
|---|---|---|
| T01 | `はい、今回よろしくお願いします。` | Do not ask the salesperson what to discuss. Do not say `どんなところからお話ししましょうか`. Silence or one short setup sentence is acceptable. |
| T02 | `そうですね、今回の募集背景を教えてください。` | Answer background only. Do not add `少し詳しくお話ししましょうか`. |
| T03 | `そうですね。少し詳しくお話しいただけますか。` | Reveal one deeper layer: 品番確認, 納期回答, 代理店/工務店への折り返し遅れ. Do not ask `何か他に`. |
| T04 | `そうですか。` | Do not start a new topic. Do not guide toward duties or conditions. |
| T05 | `うん。` | Do not start a new topic. Do not say `業務内容の大枠からお話ししましょうか`. |

Also encode these individual NC smoke cases:

- `NC-SMOKE-001`: greeting after `はい、今回よろしくお願いします。`; optional
  speech, max one sentence, `customer_led_sales_flow=false`.
- `NC-SMOKE-002`: background question answers background only; must mention one
  of `受注処理`, `確認負荷`, `増えて`; max two sentences.
- `NC-SMOKE-003`: deep-dive request reveals one deeper operational layer; max
  two sentences.
- `NC-SMOKE-004`: `そうですか。` is backchannel; no new topic.
- `NC-SMOKE-005`: `うん。` is backchannel; no new topic.

## Deterministic P0 Hard Fails

Evaluate these before semantic assertions. If any is true, status is FAIL:

- `customer_led_sales_flow_detected`
- `generic_closing_question_detected`
- `ask_salesperson_next_topic_detected`
- `low_information_input_new_topic_detected`
- `over_disclosure_detected`
- `forbidden_suffix_audible`
- `role_break`
- `prompt_leak`
- `evaluation_leak`
- `fixed_guard_missing`
- `turn_completed_missing`
- `audio_leak_before_trim`

Customer-led patterns are P0 hard fail in any normal sales turn:

```typescript
const CUSTOMER_LED_PATTERNS = [
  /どんなところから.*お話ししましょうか/u,
  /何から.*お話ししましょうか/u,
  /少し詳しく.*お話ししましょうか/u,
  /何か他に.*気になる点/u,
  /業務内容や条件.*お話しできます/u,
  /業務内容の大枠から.*お話ししましょうか/u,
  /どういうところから.*お聞きになりますか/u,
  /ご質問があれば/u,
  /具体的に知りたい部分があれば/u,
  /このあたりで大丈夫でしょうか/u,
  /進めていただけますか/u,
  /お聞きになりますか/u,
  /お話しできますよ/u,
];
```

Do not allow a semantic evaluator to override these deterministic failures.

## Backchannel / Low-Information Gate

Treat these as backchannel or low-information inputs unless the surrounding
context proves otherwise:

```text
はい。
うん。
そうですね。
そうですか。
なるほど。
分かりました。
ありがとうございます。
へえ。
あ、そうなんですね。
```

Expected behavior: no response, `routePath=noise_ignored`, or one short
acknowledgement. The assistant must not start a new topic, steer into duties or
conditions, ask the salesperson for the next question, request more questions,
or reveal deeper hidden facts.

For v50.7 Option A, the preferred runtime behavior for opening-only greetings
and low-information backchannels is `routePath=noise_ignored` with no assistant
audio. This is an input-router/runtime guard, not a v50.6 prompt change. A
customer-led or generic-closing phrase detected during
`response.output_audio_transcript.delta` must cancel the response and clear held
audio; deleting only the final visible transcript is not sufficient evidence.
Normal background/detail/business-flow inputs may be rewritten by the runtime
input router before Realtime generation to keep the customer answer bounded and
non-leading. Safe normal Realtime turns may report `fullTurnBufferCount=1`
because audio is held until the final transcript guard passes; held audio must be
dropped rather than played if a P0 phrase is detected.

Fail when:

- `backchannel_input_detected=true` and `new_topic_started=true`
- `customer_led_sales_flow=true`
- `deep_reveal=true`
- duties, conditions, or closing prompts are introduced after low-info input

## Reveal Depth / Over-Disclosure Gate

Judge answer shape before keyword success.

| Salesperson utterance type | Expected reveal | Forbidden |
|---|---|---|
| Shallow question | one topic only | business flow, rate, decision structure ahead of time |
| Background question | background only | work conditions, candidate requirements, vendor status |
| Deep-dive question | one deeper layer for that point | lateral expansion into unrelated facts |
| Hypothesis check | `その理解で近いです` plus one correction | checklist-style readout |
| Summary | agreement or one correction | many new topics |
| Backchannel | silence or short acknowledgement | new topic |

Over-disclosure examples are FAIL:

- Background-only question returns hours, overtime, rate, start date, and
  decision structure together.
- Job-duty question returns six-month expectations or manager strictness.
- `条件全部` causes a full job-order readout.
- Asking whether a job description exists advances to workplace tour or
  contract coordination.

## Audio Leak Rule

Normal response evaluation must persist and inspect all three streams:

- `rawAssistantTranscript`
- `visibleAssistantTranscript`
- `audibleTranscriptDelta` or `audibleTranscriptPreview`

If a P0 forbidden phrase appears in raw transcript or audible deltas, FAIL even
when the final visible text was trimmed clean. User experience is determined by
what was heard.

## Semantic Evaluator

Use semantic scoring only after deterministic hard-fail checks pass.

Score each axis `0=fail`, `1=weak`, `2=acceptable`, `3=strong`:

- `answer_relevance`
- `reveal_depth_fit`
- `customer_role_consistency`
- `sales_flow_not_led_by_customer`
- `business_fact_accuracy`
- `conversation_continuity`
- `natural_audio_style`

Semantic evaluator alone cannot produce PASS. Deterministic hard-fail count
must be zero.

## PASS Case False-Pass Audit

Every run must audit PASS cases, not only FAIL cases. Human review is required
for:

- all backchannel cases
- all customer-led risk cases
- semantic score `<= 2`
- raw transcript containing `お話し`, `聞き`, `質問`, or `他に`
- firstAudioDelta p95 outliers

Goal: false pass for unnatural normal sales conversation is zero.

## Excel Workbook Design

Future naturalness workbooks should use these sheets:

```text
00_Metadata
01_Global_Hard_Fail_Rules
02_Natural_Smoke
03_Backchannel_Low_Info
04_Customer_Led_Output_Guard
05_Reveal_Depth_Matrix
06_Natural_Transition_E2E
07_Overdisclosure
08_Anti_Pattern_Regression
09_STT_Normal_Conversation
10_Strong_Sales_Wrong_Premise
11_Closing_Naturalness
12_Fixed_Guard_Regression
13_Mixed_Normal_And_Guard
14_Evaluator_Calibration
15_Human_Review_Rubric
16_RunPlan
17_DoD
```

Every case should include:

```text
case_id
tier
priority
phase
input_mode
conversation_context
user_input
expected_input_intent
expected_reveal_level
should_speak
allowed_response_shape
max_sentences
must_contain_any
must_contain_all
must_not_contain_any
hard_fail_patterns
customer_led_forbidden
over_disclosure_forbidden
new_topic_forbidden
expected_guard_action
expected_route_path
expected_audio_source
expected_turn_completed
expected_latency_metric
semantic_assertion
manual_review_required
pass_condition
fail_condition
notes
```

`should_speak`, `expected_reveal_level`, `customer_led_forbidden`,
`new_topic_forbidden`, and `over_disclosure_forbidden` are mandatory for
naturalness coverage.

## Run Plan and DoD

| Run | Scope | DoD |
|---|---|---|
| Run 0 | Evaluator calibration, Golden Bad 100 + Golden Good 100 | Golden Bad false pass `0`; Golden Good false fail `<=5%` |
| Run 1 | Natural Smoke Text, 30 cases x 3 consecutive runs | `30/30 x3`, customer-led `0`, generic closing `0`, low-info new-topic `0` |
| Run 2 | Backchannel / Low-Info, 50 cases | false pass `0`, new topic `0`, over-disclosure `0` |
| Run 3 | Natural Transition E2E, 12 scenarios x 5-8 turns | scenario pass `>=11/12`, turn pass `>=95%`, P0 hard fail `0` |
| Run 4 | Voice/STT Natural Smoke, 30 cases | `>=27/30`, P0 hard fail `0`, audio leak `0`, raw customer-led phrase `0` |
| Run 5 | Mixed Normal + Guard, 20 scenarios | fixed guard missing `0`, normal turn missing `0`, customer-led leakage `0` |
| Run 6 | Full Regression | overall pass `>=95%`, P0 hard fail `0`, unnatural PASS audit `0` |

Human testing is not allowed until:

- Natural Smoke Text `30/30 x3`
- Backchannel `50/50`
- Customer-led Output Guard `100/100`
- Natural Transition E2E `>=11/12` and P0 hard fail `0`
- Voice/STT Natural Smoke P0 hard fail `0`
- Fixed Guard P0 pass
- PASS-case false-pass audit `0`

## Required Observability

Add these fields to `turn.completed` or equivalent event payloads before
claiming final naturalness DoD:

```text
rawAssistantTranscript
visibleAssistantTranscript
audibleTranscriptPreview
inputIntent
expectedRevealLevel
actualRevealLevel
customerLedSalesFlowDetected
genericClosingQuestionDetected
lowInformationInputDetected
newTopicStartedAfterLowInfo
overDisclosureDetected
hardFailReasons
naturalnessScore
semanticEvaluatorScore
audioLeakDetected
```

## Preflight First

Before any long-running run:

1. State the denominator: `Natural Smoke 30 x3`, `Backchannel 50`,
   `Customer-led 100`, `12 scenario transition`, `Voice/STT 30`,
   `5-case fixed harness`, `13/13 guard smoke`, `69 P0 guards`, or
   `93-turn full`.
2. If the plan is Excel/Sheets, inspect sheets and confirm a runner exists for
   every required case set. Missing runner is a blocker; do not call a narrower
   harness final DoD.
3. Confirm the runner/package script exists. For production smoke and logs:
   `pnpm grok:first-v50:prod-smoke` and `pnpm grok:first-v50:prod-logs`.
   For spreadsheet or case-set voice E2E:
   `pnpm grok:first-v50:voice-e2e` or the existing
   `pnpm grok-first:v50:xlsx-voice-e2e`.
   For v50.8 fixed guard browser evidence:
   `pnpm grok:first-v50-8:guard-e2e`. For spreadsheet `13/13 x3` fixed
   guard smoke, use:
   `pnpm grok:first-v50-8:guard-e2e -- --case-set guard-smoke --repeat 3`.
   Use `--list-cases` first when mapping the denominator without starting a
   browser run.
4. Confirm secrets without printing values:
   - `DEMO_ACCESS_TOKEN` env or Secret Manager `demo-access-token`
   - `XAI_RELAY_TICKET_SECRET` for relay-ticket v50/v25 routes
   - `XAI_API_KEY` for normal Grok realtime/voice paths
5. Check stale local Next dev servers and target ports before starting. Reuse an
   existing server only after one target event route capture succeeds.

## Production Diagnostic Ladder

Before redeploying or broadening the run:

1. Check `/api/grok-first-v50*/session` first. It must return the expected
   `demoSlug`, `backend`, `promptVersion`, `guardrailVersion`,
   `realtimeTransport=mendan_cloud_run_relay_wss`,
   `wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay`,
   `registeredSpeechPayloadIncluded=false`, and
   `lockedResponseAudioBundleIncluded=false`.
2. If the session API fails, investigate App Hosting, AccessGate cookies,
   rollout/build logs, and env/secret bindings. Do not start with relay logs.
3. If the session API succeeds but WebSocket startup fails, check
   `https://voice.mendan.biz/healthz`, then relay Cloud Logging for
   `client.connected`, `ticket.accepted`, `upstream.connected`, and
   `first.upstream.audio.delta`.
4. If browser E2E fails, immediately pull Cloud Logging for the same
   `sessionId`. `stt.completed` without `turn.completed` is a turn lifecycle
   failure, not a session-start failure.

Useful commands:

```bash
pnpm grok:first-v50:prod-smoke -- --variant <v50-x> --mode session
pnpm grok:first-v50:prod-smoke -- --variant <v50-x> --mode start
pnpm grok:first-v50:prod-smoke -- --variant <v50-x> --mode voice-turn
pnpm grok:first-v50:prod-smoke -- --variant v50-7-quality --mode session
pnpm grok:first-v50-7:natural-voice-e2e -- --case-set quality-guard-focused
pnpm grok:first-v50:prod-logs -- --from-smoke out/.../evidence.json
```

For v50.7 prompt-only guard-disabled diagnostic releases, the session smoke must
show `runtimeGuardrailsEnabled=false`; the voice-turn smoke must show
`routePath=grok_first_realtime`, `guardAction=pass`, `guardReasons=[]`,
`fullTurnBufferCount=0`, `tailAudioDroppedBytes=0`, and `audioBytes > 0`.
For v50.7 quality, session smoke must show the quality route identity, guards
enabled, `streamAudioBeforeDone=false`, `fullTurnBufferEnabled=false`, and
route-specific event endpoint `/api/grok-first-v50-7-quality/event`. Focused
quality evidence reports `QUALITY_GUARD_PASS`, `QUALITY_GUARD_FAIL`,
`QUALITY_GUARD_BLOCKED`, or `ROLEPLAY_FUNCTIONAL_PASS`. Human testing requires
`ROLEPLAY_FUNCTIONAL_PASS`; `QUALITY_GUARD_PASS` alone is not sufficient when
normal sales or safe-body tail turns are silent.
`prod-logs --expect start` treats missing `turn.completed` as normal for
start-only sessions, while `--expect voice-turn` treats `stt.completed` without
`turn.completed` as a lifecycle failure.

## Fixed Guard Checks

For fixed guard turns, require:

- `guard.detected`
- `fixed_guard.playback.started`
- `fixed_guard.playback.completed`
- `turn.completed`
- `routePath=fixed_guard`
- expected `guardAction`
- `audioSource=static_guard_pcm_base64`
- `audioBytes > 0`
- `firstAudibleAudioMs != null`
- fixed text exact match
- no `<missing>`
- no LLM response displayed

For ordinary voice turns, require `stt.completed`, `turn.completed`,
`audioBytes > 0`, `error=null`, and the naturalness gates above.

## Cloud Logging

v50-family logs use `jsonPayload.scope="grokFirstV50"` and route-specific event
endpoints. Relay logs use `jsonPayload.scope="grokVoice.realtimeRelay"`.

Interpret common patterns as follows:

| Pattern | Meaning |
|---|---|
| no `session.created` | Browser did not reach the session route or App Hosting failed before logging |
| `session.created` but no `ws.connected` | Browser/CSP/DNS/LB or client startup issue |
| relay `ticket.rejected` | relay ticket audience/path/secret mismatch |
| relay `upstream.connected` missing | relay `XAI_API_KEY`, IAM, or xAI upstream issue |
| `stt.completed` but no `turn.completed` | turn lifecycle / response creation / mic overlap issue |
| `fixed_guard.playback.started` but no `turn.completed` | fixed audio playback path or completion metric issue |

Latency note: `firstAudibleAudioMs` is turn-start based and includes STT time.
For fixed guard audio path health, prefer `sttCompletedToGuardDetectedMs`,
`guardDetectedToPlaybackStartedMs`, `fixedPlaybackDurationMs`, and
`fixedAudioBytes`.

## Reporting

Always distinguish:

- invalid run
- naturalness gate evidence, e.g. `Natural Smoke 30/30 x3`
- backchannel evidence, e.g. `50/50`
- transition evidence, e.g. `11/12 scenarios, 95% turns`
- scoped fixed harness evidence, e.g. `5/5 x3 back-to-back fixed_external`
- Excel guard smoke evidence, e.g. `13/13 x3`; name whether it is text-input
  browser evidence or Voice/STT evidence
- P0 guard evidence, e.g. `69/69`
- full E2E evidence, e.g. `93 turns`

If a broader runner is missing, report `NOT COMPLETE: runner missing` and list
the implemented narrower evidence separately.
