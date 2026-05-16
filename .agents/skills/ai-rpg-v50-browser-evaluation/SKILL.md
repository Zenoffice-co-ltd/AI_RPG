---
name: ai-rpg-v50-browser-evaluation
description: Use when implementing, verifying, or reporting v50/v51 Adecco browser evaluation result pages, Adecco scoring result APIs, scorecard/model_raw_output artifacts, browser-use result screenshots, or the separation of Claude scoring from Gmail delivery. Do not use this for voice naturalness E2E or fixed guard regression; use ai-rpg-grok-first-v50-guard-verification for those.
---

# AI RPG v50/v51 Browser Evaluation

Use this skill for browser evaluation result pages and scoring delivery evidence.
Keep it separate from v50 voice naturalness, fixed guard, relay, and production
voice E2E work.

## Canonical Sources

- `AGENTS.md` `## Browser Evaluation / Scoring Delivery SoT`
- `AGENTS.md` `## Secrets`
- `apps/web/server/use-cases/adeccoBrowserEval.ts`
- `apps/web/server/use-cases/adeccoOrderHearingEval.ts`
- `apps/web/components/roleplay/evaluation/*`
- `apps/web/tests/unit/adecco-browser-eval.test.tsx`
- `apps/web/tests/unit/adecco-evaluation-result-client.test.tsx`

## Core Contract

- Browser evaluation must call scoring core only.
- Browser evaluation must not call Gmail.
- Legacy ElevenLabs post-call webhook Gmail flow must remain compatible unless
  explicitly changing that workflow.
- Adecco order-hearing scoring now defaults to the shared customer-criteria v2
  bundle in `scripts/adecco_order_hearing_eval/prompts/`. That shared default
  intentionally affects v51 browser evaluation, v50-7 browser evaluation, and
  legacy ElevenLabs Gmail scoring. Add an explicit `evaluationProfile`/prompt
  bundle split before trying to preserve separate v1/v2 scoring behavior.
- Versioned browser routes should read `session.browserEvaluation` for the
  start endpoint, result base path, and source. Keep `browserEvaluationEnabled`
  only as a v50-7 compatibility fallback.
- Browser scorecard envelopes should include `evaluationProfile` and
  `runtimeVersion` while preserving
  `evaluationFormat=adecco_order_hearing_browser_v1`.
- Raw Claude output may be stored server-side as `model_raw_output`, but must not
  be returned by browser/result APIs.
- Result APIs must not expose raw audio, relay tickets, API secrets, prompt
  instructions, or hidden system prompts.
- Cloud Tasks payload may contain only the normalized transcript required for
  scoring.

## Safe Browser Confirmation

Use the mock result route first:

`/demo/adecco-roleplay-v50-7/result/mock-session?mock=1`

For customer criteria v2 / v51 work, use:

`/demo/adecco-roleplay-v51/result/mock-session?mock=1`

Expected browser checks at 1440x900:

- no horizontal scroll
- score visible
- Grade visible
- KPI cards visible
- Rubric Breakdown visible
- Must Capture 18 items visible
- learner feedback visible
- Next Training Actions visible
- Debug collapsed by default
- raw Claude output not visible
- `<table>` count is 0

v51/customer-criteria checks also expect schema/profile version, grouped
must-capture data, modality limitations, and sales compliance flags.

## Required Verification

- web typecheck
- web test
- web build
- changed-file eslint
- targeted unit tests
- browser-use or Playwright screenshot

## Do Not

- Do not run production Gmail smoke for browser evaluation DoD.
- Do not change ElevenLabs live webhook settings.
- Do not deploy Cloud Run/App Hosting unless the task explicitly asks.
- Do not mix vFinal, v50.8 guard, voice E2E, or fixed guard work into browser
  evaluation PRs.
