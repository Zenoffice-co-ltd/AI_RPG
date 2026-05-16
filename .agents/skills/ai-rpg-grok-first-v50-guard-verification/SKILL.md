---
name: ai-rpg-grok-first-v50-guard-verification
description: Use when verifying or reporting Grok-first v50 normal sales conversation naturalness, voice E2E, fixed guard behavior, guard smoke, assistant-only drain, spreadsheet-defined test plans, or browser E2E evidence for `/demo/adecco-roleplay-v50*` and `/api/grok-first-v50*`.
---

# AI RPG Grok-first v50 Voice E2E Verification

Use this skill for v50 voice E2E and evidence. The 2026-05-16 source of truth
changed the priority from fixed-guard-first verification to
normal-sales-conversation naturalness first. Fixed guard evidence is still
required, but it can no longer stand in for normal sales Realtime quality.

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
pnpm grok:first-v50:prod-smoke -- --variant <v50-x> --mode start
pnpm grok:first-v50:prod-smoke -- --variant <v50-x> --mode voice-turn
pnpm grok:first-v50:prod-logs -- --session gfv50_...
```

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
