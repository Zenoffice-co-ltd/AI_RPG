---
name: ai-rpg-acceptance-verification
description: Use when the task is to validate release readiness, acceptance, publish readiness, smoke checks, or end-to-end evidence for this repository. Do not use for isolated feature implementation unless the task explicitly asks for verification or release evidence.
---

# AI RPG Acceptance Verification

Use this skill when the job is to prove that the repo is shippable.

## Canonical Sources

- `README.md`
- `docs/OPERATIONS.md`
- `docs/DELIVERY_STATUS.md`

## Default Workflow

1. Start from the narrowest preflight or targeted command that matches the task.
2. If release readiness is the goal, finish with `pnpm verify:acceptance`.
3. If the canonical acceptance command fails, identify whether the blocker is:
   - missing runtime input
   - vendor readiness
   - local app startup
   - actual product regression
4. For a blocker outside the touched scenario or package, run the narrow targeted command enough times to distinguish deterministic failure from a one-off vendor judge result.
5. When a legacy scenario fails during a new-scenario task, compare the relevant generated scenario/assets and live test definition before calling it a regression. If needed, use a temporary clean worktree at the pre-task baseline to establish causality.
6. Record concrete evidence, not just that scripts exist.

## Long-running E2E / Spreadsheet DoD Preflight

Before running a browser E2E, voice E2E, spreadsheet-defined plan, or final DoD,
spend the first pass proving that the run is executable:

1. Map the requested denominator to an exact command: e.g. `5-case harness`,
   `13/13 guard smoke`, `69 P0 guards`, or `93-turn full`.
2. If the plan is an Excel/Sheets file, inspect the workbook sheets and confirm
   there is a runner for each required case set. Missing runner = blocker; do
   not substitute a narrower harness and call it final DoD.
3. Confirm required secrets by env name and Secret Manager alias without printing
   values. For Adecco demo routes, check `DEMO_ACCESS_TOKEN`/`demo-access-token`;
   for v25/v50 relay routes, check `XAI_RELAY_TICKET_SECRET`; normal Grok voice
   paths also need `XAI_API_KEY`.
4. Confirm the package script still exists before invoking it. If a direct node
   script is used instead, report the reason.
5. Confirm no stale Next dev server is holding the app directory. Reuse a server
   only after a one-turn event-capture check proves the target `/api/.../event`
   route is being observed.

Report scoped evidence precisely. A `5/5 x3` back-to-back fixed-guard harness is
valuable, but it is not the same as Excel `13/13 x3` or `69/69` unless the same
case set was executed.

For v50-family voice E2E, `AGENTS.md` `## Voice E2E Natural Conversation SoT`
is the acceptance source of truth. As of 2026-05-16, v50.8 fixed_external
back-to-back stability is only scoped evidence. Human-test readiness requires
normal sales naturalness first: Natural Smoke Text `30/30 x3`, Backchannel
`50/50`, Customer-led Output Guard `100/100`, Natural Transition E2E `>=11/12`
with P0 hard fail `0`, Voice/STT Natural Smoke P0 hard fail `0`, Fixed Guard P0
pass, and PASS-case false-pass audit `0`.

## Enterprise Relay Closeout

Use this subsection when closing v25 or Grok-first v50-family work that routes
browser realtime traffic through the Cloud Run relay.

Minimum evidence:

1. PR URL and merge commit.
2. `origin/main` contains the intended unique lines via `git show
   origin/main:<path>`; do not rely only on the PR badge or local worktree.
3. App Hosting rollout id from a deploy that used the intended merged
   `origin/main` commit.
4. Cloud Run relay revision and traffic percent when relay code or env changed.
5. Session contract summary only: `realtimeTransport=mendan_cloud_run_relay_wss`,
   `wsUrl=wss://voice.mendan.biz/api/v3/realtime-relay`,
   `realtimeAuth.mode=mendan_relay_subprotocol`, and no browser
   `ephemeralToken`.
6. Browser E2E artifact paths only; do not commit `out/`, screenshots, audio,
   transcripts, or raw Cloud Logging JSON.
7. Browser WebSocket evidence shows `wss://voice.mendan.biz/api/v3/realtime-relay`
   and no direct `wss://api.x.ai` for relay routes.
8. Cloud Logging structured relay assertions use
   `jsonPayload.scope="grokVoice.realtimeRelay"` and read the phase from
   `jsonPayload.phase` (`client.connected`, `ticket.accepted`,
   `upstream.connected`). Filter to structured relay logs before running
   forbidden-content scans.
9. If a new relay-ticket `demoSlug` / `backend` pair was added, confirm the
   Cloud Run relay image was rebuilt from the merged commit. A production
   `ticket.rejected reason=malformed` for the new slug usually means App
   Hosting is newer than the relay verifier.

Customer-facing allowlist for relay trial routes:

- `https://roleplay.mendan.biz` TCP 443
- `https://voice.mendan.biz` TCP 443
- `wss://voice.mendan.biz` TCP 443
- Browser microphone permission

Direct browser access to `api.x.ai` is not required for relay routes. Keep
`api.x.ai` in CSP only while direct-path comparison routes still exist.

## vFinal Customer/Security-Checksheet Submission DoD

Use this subsection when closing Adecco AI Roleplay vFinal for customer
submission or security-checksheet submission.

Canonical sources:

- `docs/DELIVERY_STATUS.md`
- `docs/security/adecco-ai-roleplay-final-security-closeout.md`
- `docs/security/adecco-vfinal-customer-submission-dod-audit.md`
- `docs/security/adecco-vfinal-blocker-inventory-index.md`
- `docs/security/adecco-vfinal-approval-packet.md`
- `docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md`

Final PASS guard:

```bash
corepack pnpm grok:vfinal-submission-dod-status -- --expect=pass --check-github-issues --allow-open-approved-issues --approval-author=<approver-github-login> --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

Both source questionnaire workbooks are required in PASS mode; the final guard
rejects a PASS run that omits them.
`--check-github-issues` is also required in PASS mode so #138, #139, #140,
#141, and #171 are verified closed or approved, and umbrella #128 is verified
closed.

If approved open blockers are being relied on, `--approval-author=<approver-github-login>`
or `VFINAL_SUBMISSION_DOD_APPROVAL_AUTHORS` is required; the guard rejects
open-issue approvals without an expected approver list. Verify the approval
text is plain issue/PR comment text, not only a fenced template or blockquote.

While the submission is blocked, use BLOCKED mode as the honest default:

```bash
corepack pnpm grok:vfinal-submission-dod-status -- --expect=blocked --check-github-issues --workbook="C:\Users\yukih\Downloads\Adecco_データ保護アンケート_v01_回答ドラフト.xlsx" --workbook="C:\Users\yukih\Downloads\Adecco_TPISAアンケート_v01_回答ドラフト.xlsm"
```

Required blocker issues:

- #128 umbrella tracker. Keep it open while the submission is BLOCKED; close it
  only after the final PASS guard and final closeout PR are complete.
- #138 submitted URL / custom-domain decision.
- #139 legacy shared App Hosting `XAI_API_KEY` scope/de-scope decision.
- #140 strict latency baseline comparison. This must be resolved with passing
  comparison evidence, not by waiving the missing baseline.
- #141 clean `verify:acceptance` or approved legacy ConvAI blocker.
- #171 questionnaire workbook human confirmations.

Rules:

- Do not change closeout, Delivery Status, or questionnaire drafts to PASS until
  the PASS guard succeeds.
- While the submission is still BLOCKED, do not write PR titles or bodies with
  GitHub auto-closing phrases such as `close #128`, `fix #141`, or
  `resolve #138`. Use `remains BLOCKED`, `pending`, or `tracks` wording unless
  the PR is the final PASS closeout and the final PASS guard has already
  succeeded.
- #138 custom-domain approval must name a dedicated vFinal `mendan.biz` URL
  mapped to `adecco-roleplay-vfinal`. The legacy shared comparison domain
  `roleplay.mendan.biz` is not a valid submitted vFinal URL.
- #138 hosted.app or custom-domain approval must include submitted-URL smoke
  evidence: invite consume 307, session 200, `wsUrl`
  `wss://voice.mendan.biz/api/v3/realtime-relay`, direct `api.x.ai` count 0,
  and forbidden session keys absent. Custom-domain approval must also include
  active DNS/certificate status.
- #139 approval must name the submitted vFinal service account
  `firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com` and the
  legacy shared App Hosting service account
  `firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com` so the
  scope boundary is explicit.
- #140 cannot be closed by a current-vFinal-only sample or a missing-baseline
  waiver. It needs a same-environment, same-scenario, >=20-session pre-vFinal
  baseline, p95 comparison within thresholds, WSS close-code 1006 comparison,
  relay.error comparison, `corepack pnpm grok:first-vfinal:latency-compare`
  PASS, a comparison summary artifact, and `Comparison result: PASS`. Once
  baseline evidence exists, run `corepack pnpm grok:first-vfinal:latency-compare
  -- --baseline <pre-vFinal-summary.json> --current
  <current-vFinal-summary.json> --baseline-close-code1006 <count>
  --current-close-code1006 <count> --baseline-relay-error <count>
  --current-relay-error <count> --out <comparison-summary.json>` and cite its
  output.
- #171 keeps the questionnaire drafts non-final until the mapped workbook cells
  are human-confirmed or rewritten and the issue is closed or approved. If #171
  is approved while open, the approval comment must name both source workbooks,
  confirm `vFinal提出DOD照合` overall PASS, and state blocked-mode markers were
  removed.
- #141 approval must identify the legacy scenario
  `staffing_order_hearing_busy_manager_medium`, acknowledge the latest full
  rerun included `no-coaching`, `role-adherence`, and `no-hidden-fact-leak` so
  the no-coaching-only exception is not being applied, and state that no vFinal
  session, relay, WAF, logging, or no-key runtime regression is indicated.
- If `verify:acceptance` is blocked by Secret Manager IAM or current-shell
  secret access, record the blocker and required permission; do not claim
  acceptance PASS.
- Do not commit `out/`, raw Cloud Logging JSON, screenshots, audio,
  transcripts, prompt text, invite tokens, cookies, relay tickets, or workbook
  copies that contain customer submission answers.

## Workbook Voice E2E

Use this subsection when the operator provides an Excel workbook of v50-family
voice E2E cases.

For predeploy prompt-quality checks, first use `ai-rpg-predeploy-voice-e2e` so
the local/PR prompt is tested directly against xAI Realtime before any
production deploy. Use the command below for production session/relay evidence
after deploy.

Canonical command:

```bash
corepack pnpm grok-first:v50:xlsx-voice-e2e -- \
  --xlsx "<path-to-workbook.xlsx>" \
  --tier smoke
```

The harness reads `01_E2E_Scenarios` and `02_Turn_Cases`, generates local WAV
fixtures for sales utterances, streams PCM to the production relay, and records
both xAI STT transcript and assistant audio transcript. Evidence is written
under `out/v50_4_voice_e2e/<timestamp>/`; do not commit the generated audio,
transcripts, screenshots, or raw Cloud Logging JSON.

Follow the workbook run plan:

1. Run Smoke/P0 first.
2. If P0 fails, stop Core/Full and report the failure set.
3. If P0 passes, proceed to Core and then Full as requested.

Report at minimum:

- scenario count and turn count
- overall pass rate and P0 pass rate
- forbidden-hit count and top forbidden phrases
- first audio delta p50/p95 and done p50/p95
- session identity: `demoSlug`, `backend`, `promptVersion`, model, voice
- relay revision and traffic percent
- structured relay phases: `ticket.accepted`, `upstream.connected`, and
  `first.upstream.audio.delta`

For v50.4 specifically, the expected session identity is
`demoSlug=adecco-roleplay-v50-4`,
`backend=grok-first-v50-4`,
`promptVersion=grok-first-v50.4-2026-05-15`,
model `grok-voice-think-fast-1.0`, and voice `99c95cc8a177`.

## v50-family Production Evidence Order

For `/demo/adecco-roleplay-v50*` work, use this order before broad acceptance:

1. Targeted unit/typecheck for touched v50 files.
2. Version / route sanity capture for the exact route: `demoSlug`, `backend`,
   `promptVersion`, `guardrailVersion`, `promptHash`, commit SHA, model,
   voice, `realtimeTransport`, and `session.created`. Missing provenance is
   `INVALID RUN`, not PASS/FAIL.
3. Natural conversation gates before fixed-guard-only claims: customer-led
   output, backchannel/low-info, reveal depth, over-disclosure, audio leak, and
   PASS-case false-pass audit. Use
   `.agents/skills/ai-rpg-grok-first-v50-guard-verification/SKILL.md`.
4. Local focused fixed-guard or voice browser E2E, if the requested denominator
   has a runner.
5. Deploy through `pnpm deploy:adecco-roleplay` or
   `pnpm deploy:adecco-roleplay:gcloud`; avoid bare deploy except Cloud Build
   debugging.
6. Production session API smoke for `/api/grok-first-v50*/session`.
7. Production URL smoke with `pnpm grok:first-v50:prod-smoke`.
8. Relay health/log check if `realtimeTransport=mendan_cloud_run_relay_wss`.
9. Production `grokFirstV50` Cloud Logging query for the same `sessionId` via
   `pnpm grok:first-v50:prod-logs`.
10. Only then run spreadsheet/full E2E or `pnpm verify:acceptance`.

v50-family evidence is not emitted through `/api/v3/event`; use
`/api/grok-first-v50*/event` and `jsonPayload.scope="grokFirstV50"`.

## Grok Voice v2.1 PR58+ Release DOD

Use this subsection when validating, deploying, or closing follow-up work for
Grok Voice v2.1 on the Adecco manufacturer scenario.

Completion is not "PR merged" alone. Treat the release as done only after:

1. PR is merged to `main` and the merge commit is known.
2. App Hosting backend `adecco-roleplay` is deployed to project `adecco-mendan`.
3. Production smoke passes against the hosted URL and reports the expected
   `promptVersion`, `guardrailVersion`, model, voice, and VAD values.
4. Scenario E2E full regression passes:
   `corepack pnpm exec tsx scripts/grok-voice-v21-scenario-e2e.ts --rounds 2 --critical-rounds 3`.
5. New numeric/condition correction cases `case19` through `case24` pass in
   either the full run or a focused run.
6. Results are recorded on the PR as a follow-up comment, including the E2E
   evidence directory under `out/grok_voice_v21_e2e/<timestamp>/`.

Grok Voice v2.1 scope locks:

- VAD A/B is excluded unless explicitly requested.
- Do not change `threshold`, `silence_duration_ms`, or `prefix_padding_ms`.
- Do not change model, voice, or scenario facts.
- Do not relax existing PR57 E2E expectations to hide regressions.

Voice E2E gate:

- `scripts/grok-voice-v21-voice-e2e.ts --limit 5` is currently a harness gate:
  executable, evidence saved, clear pass/fail.
- Do not claim it is a 5/5 quality PASS gate unless that has been explicitly
  promoted in the task. STT drift such as `施工日→施工費` or `単価→短歌`
  should be reported separately from harness breakage.

xAI realtime failures:

- `429` can be balance-related or transient rate limiting. After top-up, wait a
  short interval and rerun a focused case before retrying the full regression.
- If a run fails only from `429`, do not call it a product regression.

Windows smoke note:

- `corepack pnpm exec tsx scripts/grok-voice-v21-prod-smoke.mjs` can print PASS
  and then exit non-zero on Windows due to a Node handle assertion. Re-run the
  `.mjs` directly with `node scripts/grok-voice-v21-prod-smoke.mjs` and use the
  direct `node` exit code as the smoke result.

Grok Voice audio-fix closure gate:

- Before calling a Grok Voice audio PR merge-ready, check active PR review
  threads with GraphQL and resolve any non-outdated P1/P0 thread. A green
  browser smoke does not override an unresolved race-condition review thread.
- For locked-response audio fixes, include browser WebAudio evidence from the
  production route, not only API responses. Minimum evidence is
  `greeting.playback.completed`, `locked_response.playback.completed`,
  `turn.completed` with `lockedResponse=true`, `audioBytes > 0`,
  `error=null`, and `audio.queue.flushed` absent except for `barge_in` or
  `locked_response_preempt_realtime`.
- For voice locked-response races, unit coverage must prove that late
  `response.created` / audio delta / `response.done` after deterministic TTS is
  cancelled or discarded and does not emit a second `turn.completed` or
  `no_audio` metric.
- After the final code commit, redeploy App Hosting and rerun at least:
  `node scripts/grok-voice-v21-prod-smoke.mjs`, one production browser
  locked-response smoke, and `node scripts/grok-voice-v21-prod-logs.mjs
  --session <sessionId>` for that browser session.

## Representative Commands

```bash
pnpm grok:vfinal-acceptance-input-inventory -- --expect=blocked
pnpm verify:acceptance -- --preflight
pnpm bootstrap:vendors
pnpm smoke:eleven
pnpm smoke:liveavatar
pnpm verify:acceptance
```

## Orb UI Evidence

For Adecco Orb web UI changes, prefer targeted evidence before broader gates:

```bash
pnpm --filter @top-performer/web exec eslint components/roleplay lib/roleplay --ext .ts,.tsx --ignore-pattern '**/*.test.ts' --ignore-pattern '**/*.test.tsx' --no-error-on-unmatched-pattern
pnpm --filter @top-performer/web test:e2e
pnpm --filter @top-performer/web test:visual
pnpm --filter @top-performer/web build
```

- Use `/demo/adecco-orb?fakeLive=1` to prove event-driven transcript behavior without external voice network calls.
- Use `/demo/adecco-orb?mock=1&visualTest=1` only for deterministic visual regression.
- Record live browser and microphone smoke evidence in `docs/qa.md`; if it is not run, report `実装済み・live未検証`.
- When root lint/typecheck fails from unrelated repo-wide blockers, capture the exact blocker and keep targeted evidence for the touched Orb files.

## Lint Baseline Lock (added 2026-04-26)

`pnpm lint` has a 162-error baseline rooted in pre-existing files (`accountingArtifacts.ts`, `benchmarkRenderer.ts`, `compileAccountingScenario.ts`, `phase34.ts`, `voiceProfiles.ts`). The baseline is captured at `docs/lint-baseline.json` with per-file error counts and rule-id breakdown.

Rule for any PR:

- All files modified or created by the PR must produce **zero** new lint errors. Confirm by filtering `pnpm lint` output to those file paths.
- Per-file error counts in `docs/lint-baseline.json` must NOT increase. If a refactor reduces the count, lower the number in the same PR — do not silently grow the baseline.
- Files NOT listed in `docs/lint-baseline.json` are at zero and must remain at zero. Adding a new file that triggers any lint error blocks release.

Reporting template for the PR:

```
Lint baseline check:
  - Total errors: 162 (unchanged from baseline)
  - New files (zero errors): <list>
  - Modified files (zero new errors): <list>
  - Files with reduced error count: <list> (baseline updated)
```

## DoD G §6.2 Legacy Acceptance Exception

When `pnpm verify:acceptance` (full) fails ONLY on the legacy `staffing_order_hearing_busy_manager_medium::no-coaching` ConvAI judge, the failure is treated as a documented baseline blocker (vendor judge flake observed since 2026-04-19) and is **out of scope** for any new-scenario PR.

The exception requires ALL of the following to hold before applying:

1. The new scenario's own `pnpm publish:scenario` PASSED (vendor smoke 8/8 if using the split, else 100% pass).
2. The new scenario's snapshot has `passed=true` and `binding != null`.
3. The new scenario's voice mirror (if any) is verified equal to its source profile.
4. The new scenario's post-publish SAP/ERP/AP grep is clean.
5. `pnpm smoke:eleven` passes for the new scenario (retry up to 3 within a single operator session is allowed for vendor flake; do not silently retry forever).
6. The `verify:acceptance` failure stack trace shows the exact legacy scenario name `staffing_order_hearing_busy_manager_medium::no-coaching` and nothing else from the new scenario.
7. The PR description and `docs/OPERATIONS.md` Latest execution log explicitly cite the exception.

If any of (1)–(6) fail, the exception does NOT apply and the PR must hold release until the legacy blocker is resolved or the new scenario's own gate is fixed.

## Vendor Judge Flake Retry Policy

For ConvAI / `smoke:eleven` failures that look like vendor judge variance (different test failing across runs of the same prompt):

- Retry up to **3 times** within a single operator session before treating it as a deterministic failure.
- If all 3 retries fail with the same single test name, treat it as a deterministic failure on that test.
- If retries fail with different test names, treat it as vendor judge non-determinism and escalate to `ai-rpg-convai-vendor-smoke-split` for redesign.
- Never retry-loop more than 3 times in CI — the failure must be addressed in code or in test design, not by retry.

## Guardrails

- Do not claim acceptance is done unless the canonical gate passed or you explicitly document the remaining blocker.
- For publish-facing work, include the exact scenario or profile that was exercised.
- If a local server is involved, prefer a fresh process over reusing stale output.
- If `verify:acceptance` remains blocked, add or update `docs/OPERATIONS.md` Known issues / Follow-up Backlog with status, scope, owner placeholder, and acceptance criteria.
- Do not invoke DoD G §6.2 for any failure that is NOT scoped to `staffing_order_hearing_busy_manager_medium::no-coaching`. Other legacy failures must be triaged separately — they are not pre-approved for exception.
