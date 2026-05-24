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
- Browser evaluation must fail closed when the normalized transcript does not
  include at least one non-empty sales-side (`user`/`sales`) turn and at least
  one non-empty client-side (`agent`/`client`) turn.
- Missing sales-side transcript is evaluation-incomplete. Do not produce or
  accept a valid zero-score report from an agent-only transcript.
- The browser-held roleplay transcript is the scoring Source of Truth. Cloud
  Logging reconstruction is useful diagnostics, but not a substitute when
  sales STT text is absent.
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

## Result Page UX Contract

Keep these as targeted unit/browser checks when touching
`apps/web/components/roleplay/evaluation/*`; they are cheap and prevent the
most common production regressions:

- Polling must continue while the page is open until the result endpoint returns
  `completed` or `failed`. Do not reintroduce a fixed 90-second stop for normal
  queued/running states.
- `startFailed=1` means evaluation start failed before a queued job exists; do
  not poll the result endpoint forever in that state.
- A successful retry should restart result polling.
- Loading copy should avoid vendor naming and set expectation that scoring can
  take several minutes.
- Customer-facing report UI must not show debug JSON, raw/model output,
  relay/API secrets, hidden prompts, or internal-only sections such as
  nonverbal limitations / compliance flags unless a future customer-facing
  design explicitly asks for them.
- User-facing text should hide mechanical turn identifiers such as
  `turn_id 12`, `turn 12`, `(t012)`, or `(g12)`, while preserving likely
  business codes such as `型番G12` or `T012部品`.
- Keep `evidence.turn_id` in the scorecard data model for internal grounding;
  hide it only in customer-facing copy.

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

Mock confirmation is necessary but not sufficient when changing result polling,
result API shape, or scorecard rendering. Also check one real completed
scorecard payload through the normal result endpoint with the demo access cookie
and confirm the report renders without sensitive fields. Do not call production
`/api/grok-first-v50-7/evaluation/start` directly unless an operator explicitly
approves scoring work.

For access-gated result API smoke, compute the HMAC cookie from
`demo-access-token` and send it with the same origin/referer as the route under
test. A bare curl to `/api/grok-first-v50-7/evaluation/result` commonly returns
401 and is not evidence that the scorecard is missing.

```bash
DEMO_TOKEN=$(gcloud secrets versions access latest --secret=demo-access-token --project=adecco-mendan)
SIG=$(python -c "import hmac,hashlib,sys; t=sys.argv[1]; print(hmac.new(t.encode(),t.encode(),hashlib.sha256).hexdigest())" "$DEMO_TOKEN")
curl -sS "https://roleplay.mendan.biz/api/grok-first-v50-7/evaluation/result?sessionId=<sessionId>" \
  -H "origin: https://roleplay.mendan.biz" \
  -H "referer: https://roleplay.mendan.biz/demo/<slug>/result/<sessionId>" \
  -H "cookie: roleplay_api_access=$SIG"
```

## Required Verification

- Transcript capture E2E:
  `pnpm eval:adecco-browser-transcript:e2e`
  This is the 2-case minimum denominator for transcript capture changes:
  `missing_sales_transcript_blocks_evaluation` and
  `sales_stt_transcript_is_sent_to_evaluation_start`. It writes evidence under
  `out/adecco_browser_eval_transcript_e2e/<timestamp>/`.
- web typecheck
- web test
- web build
- changed-file eslint
- targeted unit tests
- browser-use or Playwright screenshot

For v50-7-4-d style customer-ready checks, record a compact PR comment instead
of committing generated artifacts:

- merge SHA
- App Hosting build / rollout / Cloud Run revision
- roleplay URL and mock result URL status
- session contract summary (`demoSlug`, `backend`, relay mode,
  `browserEvaluation`)
- completed scorecard status / score summary when available
- browser check for report render and sensitive-output non-exposure

## Do Not

- Do not run production Gmail smoke for browser evaluation DoD.
- Do not change ElevenLabs live webhook settings.
- Do not deploy Cloud Run/App Hosting unless the task explicitly asks.
- Do not mix vFinal, v50.8 guard, voice E2E, or fixed guard work into browser
  evaluation PRs.
- Do not leave the Codex/in-app browser pointed at `127.0.0.1` after stopping a
  local dev server; `ERR_CONNECTION_REFUSED` is only a stopped-local-server
  artifact. For handoff screenshots, prefer production URLs or keep the server
  running.
