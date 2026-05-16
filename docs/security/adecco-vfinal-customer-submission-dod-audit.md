# Adecco vFinal Customer Submission DoD Audit

Status as of 2026-05-17 JST: **BLOCKED**.

This audit maps the active thread goal's 25 close conditions to the current
evidence in `docs/security/adecco-ai-roleplay-final-security-closeout.md`,
issue tracker state, and merged PR history. It is intentionally conservative:
weak, partial, approval-dependent, or scope-dependent evidence is not counted as
final PASS.

## Blocking Summary

Customer submission remains blocked by four tracked items:

- #138: submitted URL decision. Approve the dedicated hosted.app URL or map an
  active dedicated vFinal `mendan.biz` custom domain.
- #139: submitted runtime scope decision. Approve legacy shared App Hosting
  `XAI_API_KEY` access as outside vFinal submission scope, or migrate/de-scope
  the legacy dependency and remove that access.
- #140: formal latency comparison. Approve or collect a same-environment,
  same-scenario, >=20-session pre-vFinal baseline.
- #141: canonical acceptance. Obtain clean `verify:acceptance` PASS or approve
  the legacy ConvAI judge blocker as outside vFinal submission scope.

## Latest Read-Only Rechecks

- 2026-05-17 submitted URL recheck:
  `roleplay-vfinal.mendan.biz` and `adecco-roleplay.mendan.biz` still had no
  DNS result in this environment. The dedicated hosted.app URL returned HTTP
  200. This supports hosted.app availability but does not replace #138
  approval.
- 2026-05-17 Secret Manager IAM recheck:
  `gcloud secrets get-iam-policy XAI_API_KEY --project=adecco-mendan
  --format=json` showed `roles/secretmanager.secretAccessor` includes
  `serviceAccount:xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com`
  and
  `serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com`.
  It did not show
  `serviceAccount:firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com`.
  This confirms the dedicated submitted vFinal runtime remains no-key, while
  the legacy shared backend scope decision remains open.
- 2026-05-17 acceptance preflight rerun:
  `corepack pnpm verify:acceptance -- --preflight` failed before product checks
  with Secret Manager `secretmanager.versions.access` permission denied. The
  current shell had no process-local
  `OPENAI_API_KEY`/`ELEVENLABS_API_KEY`/`LIVEAVATAR_API_KEY`/
  `QUEUE_SHARED_SECRET` and no `apps/web/.env.local`. This does not replace the
  earlier full-run legacy ConvAI judge evidence; it means a fresh clean rerun
  currently needs process-local secrets or a stronger execution identity.
- 2026-05-17 00:44 JST acceptance full rerun:
  process-local secrets were resolved from Secret Manager without printing or
  persisting values, preflight was ready, and the full gate again failed at the
  legacy `staffing_order_hearing_busy_manager_medium` publish scenario. Retry 1
  failed `no-coaching`; retry 2 failed `role-adherence` plus `no-coaching`;
  retry 3 failed `no-hidden-fact-leak` plus `no-coaching`. This is not eligible
  for the no-coaching-only exception and does not indicate a vFinal
  session/relay/WAF/logging/no-key runtime regression.
- 2026-05-17 workbook alignment recheck:
  the two source questionnaire drafts in `C:\Users\yukih\Downloads\` now include
  first sheet `vFinal提出DOD照合`, mark overall customer submission DoD as
  `BLOCKED`, list #138, #139, #140, and #141 as unresolved, and no longer
  contain the old `プランが完了した前提` opening wording. The TPISA `.xlsm`
  still contains `vbaProject.bin`.

## DoD Matrix

| # | Requirement | Status | Current evidence / blocker |
|---|---|---|---|
| 1 | vFinal dedicated Web/App Hosting runtime is separated | PASS | Dedicated App Hosting backend `adecco-roleplay-vfinal` and dedicated service account are recorded in the closeout. |
| 2 | vFinal Web/App Hosting runtime / service account cannot access `XAI_API_KEY` | PASS for submitted runtime | Closeout IAM proof and 2026-05-17 read-only IAM recheck show `firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com` has no `XAI_API_KEY` access. |
| 3 | Only Cloud Run relay service account can access `XAI_API_KEY` | BLOCKED by #139 | True for the dedicated submitted vFinal runtime, but project-wide `XAI_API_KEY` still includes legacy shared App Hosting access for non-submitted comparison/direct routes. 2026-05-17 read-only IAM recheck confirmed `firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com` still has secretAccessor/viewer access. |
| 4 | Metadata-only Cloud Logging bucket or sink retention is >=180 days | PASS | Closeout records metadata bucket `adecco-vfinal-metadata`, metadata sink, and 180-day retention. |
| 5 | Sensitive log scan is 0 for raw invite token, raw cookie, raw participantId, relay ticket, Authorization/Bearer, `XAI_API_KEY`, transcript body, prompt/instructions, and base64 audio | PASS scoped to collected evidence | Post same-SHA text/voice E2E sensitive metadata bucket scan recorded 0 hits for the required sensitive markers. |
| 6 | Cloud Armor / WAF is applied to relay LB in preview/log mode | PASS | Closeout records `xai-realtime-relay-preview-policy` attached to `xai-realtime-relay-backend` with preview rules. |
| 7 | WebSocket upgrade is not broken | PASS | Relay WSS smoke and post-deploy browser text/voice E2E completed through `wss://voice.mendan.biz/api/v3/realtime-relay`. |
| 8 | WebSocket audio frame body inspection is not used | PASS | Closeout records Cloud Armor applies to HTTP(S) LB handshake/request metadata only; no WAF/DLP/body inspection is applied to streaming audio frames. |
| 9 | vFinal live session can start | PASS | Post-deploy browser text/voice E2E and session contract evidence are recorded. |
| 10 | `/api/grok-first-vFinal/session` returns 200 | PASS | Closeout records production session 200 for the dedicated vFinal backend. |
| 11 | Session response omits forbidden keys: instructions, firstMessage, hiddenAssistantHistory, ephemeralToken, `XAI_API_KEY`, transcript, audioBase64, tools | PASS | Closeout session contract evidence records all forbidden keys absent. |
| 12 | Browser WebSocket destination is only `wss://voice.mendan.biz/api/v3/realtime-relay` | PASS | Browser WebSocket capture records only the relay WSS URL. |
| 13 | Browser direct `api.x.ai` connection count is 0 | PASS | Post-deploy text and voice browser evidence record direct `api.x.ai` count 0. |
| 14 | Cloud Logging relay phases are present: `client.connected`, `ticket.accepted`, `upstream.connected`, `first.upstream.audio.delta` | PASS | Closeout records all required relay phases after dedicated vFinal browser text/voice E2E. |
| 15 | Live text E2E PASS | PASS | `corepack pnpm grok:first-vfinal:browser-e2e -- --mode text` is recorded as PASS after same-SHA deploy. |
| 16 | Live voice E2E PASS | PASS | `corepack pnpm grok:first-vfinal:browser-e2e -- --mode voice` is recorded as PASS after same-SHA deploy. |
| 17 | Latency baseline comparison PASS: session API p95 <= baseline + 50ms, firstAudioDeltaMs p95 <= baseline + 100ms, firstAudibleAudioMs p95 <= baseline + 100ms | BLOCKED by #140 | Current-vFinal 20-session sample exists and passed, but no approved same-environment, same-scenario, >=20-session pre-vFinal baseline exists. |
| 18 | WSS close code 1006 increase absent | PASS for current-vFinal sample; blocked for formal comparison | Current-vFinal sample window recorded closeCode1006=0. Formal comparison remains tied to #140. |
| 19 | `relay.error` increase absent | PASS for current-vFinal sample; blocked for formal comparison | Current-vFinal sample window recorded relay.error=0. Formal comparison remains tied to #140. |
| 20 | ZAP baseline/passive scan PASS | PASS | ZAP baseline/passive exitCode 0, FAIL=0, WARN=8 documented; no active scan was run. |
| 21 | `verify:acceptance` PASS or Secret Manager IAM blocker formally issue-tracked and approved outside customer submission | BLOCKED by #141 | Latest 2026-05-17 00:44 JST full rerun had process-local secrets, reached the legacy publish scenario, and failed `no-coaching`, `role-adherence`, and `no-hidden-fact-leak` across retries. This is not a vFinal runtime regression, but it is not PASS and is not eligible for the no-coaching-only exception without customer/operator approval. |
| 22 | Closeout BLOCKED count is 0, or only customer-approved out-of-scope items remain | BLOCKED | Closeout still intentionally lists #138, #139, #140, and #141 as unresolved. |
| 23 | Closeout records official docs checked, backend/rollout/revision/traffic, relay image/revision/traffic, same Git SHA deploy, service account/IAM proof, log retention proof, WAF proof, session contract, browser WS capture, direct `api.x.ai` 0, relay phases, sensitive scan, live E2E, latency, ZAP, and acceptance | PASS for recorded evidence; blockers remain explicit | The closeout contains the required evidence sections. Latency and acceptance sections are recorded as BLOCKED rather than PASS. |
| 24 | Final PR is created, CI green, and merged | BLOCKED for final PASS PR | Evidence/docs PRs through #148 are merged, but no final PASS PR can be honestly created until #138-#141 are resolved or approved. |
| 25 | Closeout Final Verdict is `Customer submission DoD: PASS` | BLOCKED | Closeout final verdict remains BLOCKED and must stay that way until #138-#141 are closed or formally approved out of scope. |

## Minimal Restart Path

1. Resolve or formally approve #138.
2. Resolve or formally approve #139.
3. Resolve #140 with an approved pre-vFinal baseline and comparison, or obtain
   explicit approval for an alternate baseline interpretation.
4. Resolve #141 with a clean full `verify:acceptance` run or explicit approval
   of the legacy ConvAI judge blocker as outside vFinal submission scope.
5. Re-run the lightweight integrity checks:
   `git diff --check` and `corepack pnpm grok:vfinal-security-invariants`.
6. Update the closeout final verdict only after all blocking issues are closed
   or approved out of scope.
