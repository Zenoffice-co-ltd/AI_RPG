# QA: AI Roleplay UI

## Mock Mode

- Open `/demo/adecco-roleplay?mock=1`.
- Confirm the header, Orb, transcript, composer, and mute button are visible.
- Confirm hidden controls stay hidden: history, voice settings, mock tool label,
  transcript `...` floating button, and composer clip icon.
- Confirm no external voice session is started.
- Send a message with Enter.
- Confirm Shift+Enter inserts a newline.
- Confirm blank messages are not sent.

## Visual Test

- Run `pnpm test:visual`.
- Target URL: `/demo/adecco-roleplay?mock=1&visualTest=1`.
- Viewport: `1912x1099`.
- Required threshold: full page and region snapshots `<= 0.5%`.
- Do not relax the threshold; adjust CSS/DOM/layout instead.

## Live Mode Smoke Check

本番テスト対象GCPプロジェクト: `adecco-mendan`

Status: Non-operator DOD達成、Full DOD未達。実装、Cloud Run deploy、
access gate、session-token API、Secret Manager adecco-mendan参照、
WebRTC path selection、vendor smoke、full web test、targeted lint、E2E、
visual、build は検証済み。Production real-mic smoke は operator が実施
済みだが、2026-04-27 08:00 JST 時点で互換 `roleplay-ui` service が古い
Web imageを配信していたため Agent transcript が全行二重表示されていた。
`roleplay-ui` も最新 image / latest branch に揃えたので、Full DOD は
`mendan-00018-ltt` / `roleplay-ui-00018-mc2` での再テスト待ち。

2026-04-27 05:05 JST update: production operator smoke on the customer URL
confirmed live speech and transcript display, but surfaced UI transcript
timing/deduping issues. The latest deployed fix is `mendan-00011-knx`; Full DOD
remains pending a fresh operator retest on that revision.

2026-04-27 06:26 JST update: operator reported a repeated Agent row around
`現行ベンダーに加えて、もう一社の大手にも相談中です。`. Cloud Run logs for
`mendan-00011-knx` showed the same Agent turn arriving through multiple SDK
paths (`agent_chat_response_part` as `agent-chat-*` and final `agent_response`
as `agent-*`). The latest deployed fix is `mendan-00012-4bs`; it merges
`agent-chat-N` and `agent-N` into a single transcript row, adds synchronous
final-text dedupe for near-simultaneous duplicate Agent events, and logs
`normalizedTextHash`, `textEscaped`, and `textUtf8Base64` so future Japanese
log searches do not depend on Cloud Logging's display encoding. Full DOD remains
pending a fresh operator retest on `mendan-00012-4bs`.

2026-04-27 06:38 JST investigation: reviewed 2,356 `Roleplay transcript` log
rows from the prior `mendan-00011-knx` revision. The duplicate pattern was
Agent-only: 53 displayed Agent final rows included 21 canonical
`agent-chat-N` + `agent-N` duplicate groups and 22 near same-length duplicate
pairs within five seconds. Displayed User final rows had 0 near duplicate pairs,
and there were no displayed System final rows. No `mendan-00012-4bs` transcript
rows existed at investigation time, so post-fix validation still requires a new
operator smoke. The reusable investigation process is now captured in
`.agents/skills/ai-rpg-orb-live-ui/SKILL.md` under "Duplicate Transcript
Investigation".

2026-04-27 07:20 JST investigation/update: operator reported remaining
similar-looking repetition and a prompt-structure leak in the pasted transcript
(`team_atmosphere_question`, `triggerIntent`, `応答ルール`). Cloud Run transcript
logs from 2026-04-27 03:00 JST onward were rechecked: 2,950 transcript rows
across `mendan-00011-knx` and `mendan-00012-4bs`; 20 duplicate display groups
were found only on old `mendan-00011-knx`; `mendan-00012-4bs` had no displayed
Agent duplicate groups and no prompt-structure leak terms in logged displayed
rows. Root cause for the leak risk was scenario-side: the generated live Agent
prompt still exposed internal ledger structure and internal IDs. The prompt
renderer now sanitizes ledger headings to `## 質問意図 N`, removes internal
field names/IDs from the live prompt, and adds high-salience/recency bans
against verbalizing internal rules, classifications, JSON, section names, or
prompt instructions. `selection_priority_ranking` was also rewritten to answer
must/want directly instead of repeating the same generic priority paragraph.

2026-04-27 08:10 JST quota recovery: after account quota was restored,
`pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium`
completed successfully. Vendor smoke is PASS 8/8 (`suite_2101kq60y5d8e259mxd41nk1pvgw`),
`passed=true`, and the publish binding is
`ELEVENLABS_BRANCH_ID=agtbrch_9701kpj49vbdepjr8szvwc6w7e6b`. The primary
customer service `mendan` was updated to `mendan-00018-ltt`. The compatibility
service `roleplay-ui` was also updated to the same latest web image and branch
as `roleplay-ui-00018-mc2`; this fixes the old-URL symptom where
`roleplay-ui-mvk3ouxwza-an.a.run.app` still showed the old header and repeated
every Agent transcript row twice. Both services returned `/api/healthz` 200 and
session-token POST 200 with only `conversationToken` in the response after
access-cookie setup.

Automated evidence for the quota-recovery deployment:

| Command / check | Result |
| --- | --- |
| `pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium` | PASS: vendor smoke 8/8, `suite_2101kq60y5d8e259mxd41nk1pvgw` |
| Generated prompt forbidden-term grep | PASS: no internal prompt terms such as `triggerIntent`, `team_atmosphere_question`, `allowedAnswer`, `応答ルール`, or `判定条件` |
| `pnpm --filter @top-performer/web test` | PASS: 41 files / 211 tests |
| `pnpm --filter @top-performer/scenario-engine test -- src/disclosureLedger/staffingAdeccoLedger.test.ts src/compileStaffingReferenceScenario.test.ts src/priorOrbFailure.regression.test.ts src/publishAgent.test.ts` | PASS: 4 files / 58 tests |
| `pnpm --filter @top-performer/web typecheck` | PASS |
| `pnpm --filter @top-performer/web test:e2e` | PASS: 3 tests |
| `pnpm --filter @top-performer/web test:visual` | PASS: 1 test |
| `pnpm --filter @top-performer/web build` | PASS: existing Turbopack NFT trace warning only |
| `pnpm --filter @top-performer/web exec eslint components/roleplay lib/roleplay app/api/voice --ext .ts,.tsx --ignore-pattern '**/*.test.ts' --ignore-pattern '**/*.test.tsx' --no-error-on-unmatched-pattern` | PASS |
| `pnpm --filter @top-performer/scenario-engine typecheck` | PASS |
| Production access + token recheck | PASS: `mendan` and `roleplay-ui` both returned `conversationToken` only |

Canonical route: `/demo/adecco-roleplay`. Legacy `/demo/adecco-orb`
redirects to the canonical route with query parameters preserved. Requested
customer URL `https://mendan-mvk3ouxwza-an.a.run.app/demo/adecco-roleplay` is blocked until
`mendan.run.app` is verified for the deploying Google account/project; Cloud
Run domain mapping creation currently fails because the active account has no
verified domains.

### Orb Live UI Transcript Update: 2026-04-27T05:05+09:00

Operator observations before the fix:

- `入力中` and `エージェントが応答中...` were visually confusing and not
  desired in the customer transcript.
- `詳細を表示` was visible but not functional.
- Agent text could appear before the matching audio.
- The same Agent sentence, for example `承知しました。少し整理しますね。`,
  could appear twice when late SDK events and disconnect/end flush both reached
  the transcript path.
- Cloud Run transcript logs existed, but Node object logging split the evidence
  across several lines (`Roleplay transcript {`, then separate `phase:` /
  `text:` lines), making searches hard.

Remediation applied:

- Removed the visible `入力中` label and the temporary
  `エージェントが応答中...` indicator.
- Dropped tentative/debug drafting events from customer transcript rendering.
- Removed the non-functional `詳細を表示` action; ended state now keeps only the
  centered `+ 新しい会話` action.
- Buffered Agent transcript rows until `onAudio`, `onAudioAlignment`, or
  `speaking` mode indicates playback, with a short fallback if no audio signal
  arrives.
- Added normalized-text dedupe for Agent events across `agent_response`,
  `agent_chat_response_part`, audio-alignment fallback, and delayed end/disconnect
  flush paths.
- Added `/api/voice/transcript-log` and changed Cloud Run transcript evidence to
  one-line JSON with `message: "Roleplay transcript"` for subsequent sessions.

Latest deploy evidence:

| Field | Result |
| --- | --- |
| Cloud Build | PASS: `bc4ac34c-f388-46b4-8ed4-9d14a79a4778` |
| Cloud Run service | `mendan` |
| Cloud Run revision | `mendan-00012-4bs` |
| Image | `asia-northeast1-docker.pkg.dev/adecco-mendan/roleplay-ui/roleplay-ui:agent-dedupe-loghash-20260427-0620` |
| Health check | PASS: `https://mendan-mvk3ouxwza-an.a.run.app/api/healthz` returned 200 |
| Targeted unit tests | PASS: `transcript-reducer`, `transcript-log-route` |
| Full web unit tests | PASS: `pnpm --filter @top-performer/web test` (41 files / 210 tests) |
| Typecheck | PASS: `pnpm --filter @top-performer/web typecheck` |
| Targeted lint | PASS: roleplay/API touched paths |
| E2E | PASS: `pnpm --filter @top-performer/web test:e2e` (3 tests) |
| Visual | PASS after intentional snapshot update for hidden `詳細を表示` / centered `+ 新しい会話` |
| Build | PASS: `pnpm --filter @top-performer/web build` |

Next live log query:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="mendan" AND jsonPayload.message="Roleplay transcript"' \
  --project adecco-mendan \
  --limit 50 \
  --format='json(timestamp,resource.labels.revision_name,jsonPayload.phase,jsonPayload.role,jsonPayload.sdkMessageId,jsonPayload.textEscaped,jsonPayload.normalizedTextHash)'
```

Expected post-`mendan-00011-knx` behavior:

- no `入力中` label;
- no `エージェントが応答中...` row;
- no `詳細を表示` button;
- only one `+ 新しい会話` button centered in ended state;
- repeated identical Agent text is merged/dropped rather than displayed twice,
  including `agent-chat-N` + `agent-N` duplicates from the same SDK event id;
- `Roleplay transcript` logs are emitted as single-line JSON with
  `normalizedTextHash`, `textEscaped`, and `textUtf8Base64`.

### Adecco Live Agent Update: 2026-04-26T19:56+09:00

Operator live smoke surfaced two scenario-side issues:

- the agent could emit the unwanted check phrase
  `まだお話しになられていますでしょうか`;
- the answer to the business-detail question could stop as a fragment such as
  `受発注、在庫確認`, suggesting turn detection was ending the user turn too
  eagerly.

Remediation applied:

- `job_detail_tasks` now includes the exact partial-answer failure and the
  unwanted phrase as negative examples.
- The rendered Agent prompt now explicitly forbids
  `まだお話しになられていますでしょうか` and
  `まだお話しされていますでしょうか` in normal replies, silence handling, and
  turn-detection waits.
- Adecco publish now sends a live turn-taking config to the Agents payload:
  `turn_timeout=7`, `turn_eagerness=patient`, `speculative_turn=false`,
  `retranscribe_on_turn_timeout=true`, `silence_end_call_timeout=-1`, and
  `soft_timeout_config.timeout_seconds=-1`.
- `packages/vendors/src/elevenlabs.ts` now maps the internal turn config into
  the snake_case `conversation_config.turn` payload. Previously the local
  publish object contained `turn`, but the vendor request dropped it while
  building `conversation_config`.

Publish/deploy evidence:

| Field | Result |
| --- | --- |
| Scenario publish | PASS |
| Vendor smoke | PASS: 8/8 |
| Test run | `suite_6301kq4pxcyeeqm81bg4w1hsjx7p` |
| Agent branch | `agtbrch_...ph8z` |
| Agent version | `agtvrsn_...0984x` |
| Cloud Run `mendan` | PASS: `mendan-00002-wsk`, `ELEVENLABS_BRANCH_ID=agtbrch_...ph8z` |
| Cloud Run `roleplay-ui` | PASS: `roleplay-ui-00016-kkz`, `ELEVENLABS_BRANCH_ID=agtbrch_...ph8z` |
| Health check | PASS: `https://mendan-mvk3ouxwza-an.a.run.app/api/healthz` returned 200 |
| Canonical mock route | PASS: `https://mendan-mvk3ouxwza-an.a.run.app/demo/adecco-roleplay?mock=1` returned 200 |

Automated evidence for this fix:

| Command | Result |
| --- | --- |
| `pnpm --filter @top-performer/scenario-engine test -- src/disclosureLedger/staffingAdeccoLedger.test.ts src/compileStaffingReferenceScenario.test.ts src/publishAgent.test.ts` | PASS: 3 files, 29 tests |
| `pnpm --filter @top-performer/vendors test -- src/elevenlabs.test.ts` | PASS: 1 file, 13 tests |
| `pnpm --filter @top-performer/scenario-engine typecheck` | PASS |
| `pnpm --filter @top-performer/vendors typecheck` | PASS |
| `pnpm exec eslint packages/vendors/src/elevenlabs.ts packages/scenario-engine/src/publishAgent.ts packages/scenario-engine/src/compileStaffingReferenceScenario.ts packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.ts --ext .ts --ignore-pattern "**/*.test.ts" --no-error-on-unmatched-pattern` | PASS |
| `pnpm --filter @top-performer/scenario-engine test` | PASS: 40 files, 186 tests |
| `pnpm --filter @top-performer/web test` | PASS: 40 files, 186 tests |
| `pnpm --filter @top-performer/web test:e2e` | PASS: 3 tests |
| `pnpm --filter @top-performer/web test:visual` | PASS: 1 test |
| `pnpm --filter @top-performer/web build` | PASS: existing Turbopack NFT trace warning only |
| `pnpm --filter @top-performer/web typecheck` | PASS after `next build` regenerated `.next/types`; the first pre-build run failed because `.next/types/*.d.ts` files were missing locally |
| `pnpm --filter @top-performer/scenario-engine lint` | FAIL: existing unrelated accounting/scenario-engine lint debt; not introduced by this fix |
| `pnpm --filter @top-performer/vendors lint` | FAIL: existing unrelated `packages/vendors/src/liveavatar.ts` unsafe-any errors |

Manual follow-up still required: run real microphone smoke again and confirm the
agent no longer says `まだお話しになられていますでしょうか`, no longer stops at
`受発注、在庫確認`, and still shows Agent/User transcript correctly.

### Local Live Smoke

| Field | Result |
| --- | --- |
| Execution datetime | 2026-04-26T18:30+09:00 |
| OS | Windows |
| Browser | Browser Use in-app browser for initial render; Playwright Chromium headless with fake media for automated checks; real mic not run |
| URL | `http://127.0.0.1:3000/demo/adecco-roleplay` |
| scenarioId | `adecco-orb` |
| masked agent id | `agent_...7zcc` |
| masked branch id | `agtbrch_...6b` |
| API key | Not recorded; never write API keys to QA evidence |
| Local token API | PASS: status 200, `conversationToken` present, no secret/provider internals in response |
| Initial transcript | PASS: `0` rows in live mode |
| Hidden controls | PASS: history, voice settings, mock tool, transcript `...`, and composer clip counts were `0` |
| Mic prompt on initial render | PASS: no prompt before user action in automated check |
| Call start | PARTIAL: token issued and WebRTC room signaling progressed with `livekit-client@2.16.1`; no `/rtc/v1` signal observed |
| Agent initial utterance displayed | 未達: fake-media/headless session ended before agent transcript |
| User voice transcript displayed | 未達: requires real microphone smoke |
| Composer send | PARTIAL: failed safely when session could not complete under headless fake media; no duplicate user-visible provider data |
| Mute ON/OFF | 未達: requires real microphone smoke |
| End session | PARTIAL: ended state displayed after failed/closed headless session |
| New conversation | Automated fakeLive E2E pass; real live 未検証 |
| Customer-visible provider concealment | PASS: visible UI did not include provider name, agent id, branch id, token |
| Browser Use note | PASS: current `localhost` tab showed `ERR_CONNECTION_REFUSED`; navigating the in-app browser to `http://127.0.0.1:3000/demo/adecco-roleplay` loaded the UI. The dev server is listening on `127.0.0.1:3000`. |
| Browser Use mic permission denial | PASS: clicking the call button reproduced a browser `NotAllowedError: Permission denied` before `/api/voice/session-token`; UI now shows `マイクの使用が許可されていません。ブラウザのマイク設定を確認してから再試行してください。` instead of the generic session error. |
| Session cleanup self-cancel regression | PASS: `useConversation()` object changes no longer trigger unmount cleanup during rerender. Browser Use reloaded live mode and confirmed initial state has `通話を開始`, no `接続に失敗しました`, and no `通話が終了しました`. |
| Phone button active state | PASS: idle uses black phone button; connecting/active/ending uses red end-call phone button and remains clickable so a second press ends or cancels the session. |
| Agent response indicator | PASS: awaiting response state uses spinner + `エージェントが応答中...`, matching the reference behavior. |

### Production Smoke

| Field | Result |
| --- | --- |
| Execution datetime | 2026-04-26T18:25+09:00 |
| GCP Project | `adecco-mendan` |
| Region | `asia-northeast1` |
| Cloud Run Service | `roleplay-ui` |
| Cloud Run revision | `roleplay-ui-00013-pkk` |
| URL | `https://mendan-mvk3ouxwza-an.a.run.app` |
| Runtime service account | `firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com` |
| Artifact Registry image | `asia-northeast1-docker.pkg.dev/adecco-mendan/roleplay-ui/roleplay-ui:session-cleanup-fix-20260426` |
| Secret Manager reference | `ELEVENLABS_API_KEY` and `DEMO_ACCESS_TOKEN` from `adecco-mendan`; `SECRET_SOURCE_PROJECT_ID` is no longer set on production Cloud Run |
| `/api/healthz` | PASS: 200 |
| Access gate | PASS: demo access cookie flow works |
| Access code update | PASS: new access code `Adecco_MENDAN` grants access; previous code is rejected |
| Access input border | PASS: input now has `roleplay-access__input` with unfocused border, outline, and inset shadow |
| Session token API | PASS: status 200, `conversationToken` present, no access secret/API key/provider internals in response |
| Session token API abnormal cases | PASS: GET `405`, invalid scenario `400`, disallowed origin `403`, missing access cookie `401` |
| Session cleanup self-cancel regression | PASS: revision `roleplay-ui-00013-pkk` includes the unmount-only cleanup fix so SDK rerenders no longer call `endSession()` while startup is in progress |
| Initial transcript | PASS: `0` rows in live mode |
| Hidden controls | PASS: history, voice settings, mock tool, transcript `...`, and composer clip counts were `0` |
| WebRTC path | PASS: `livekit-client` pinned to `2.16.1`; no `/rtc/v1` console signal observed after deploy |
| Requested custom domain | BLOCKED: `mendan.run.app` has DNS records but no Cloud Run domain mapping in `adecco-mendan`; mapping creation failed because the domain is not verified for the active Google account |
| Headless call start | PARTIAL: LiveKit room signaling reached room close; session ended under fake-media/headless before transcript |
| Agent initial utterance displayed | 未達: requires real browser and microphone |
| User voice transcript displayed | 未達: requires real browser and microphone |
| Composer send | PARTIAL: safe failed state under incomplete headless session |
| Mute ON/OFF | 未達: requires real browser and microphone |
| New conversation | Automated fakeLive E2E pass; production real live 未検証 |
| Provider non-disclosure | PASS: visible UI did not include provider name, agent id, branch id, token |
| Secret non-disclosure | PASS: token API response and recent Cloud Run logs did not include API key, token, upstream URL, agent id, branch id, or secret name patterns checked |
| Rollback command | `gcloud run services update-traffic roleplay-ui --region asia-northeast1 --project adecco-mendan --to-revisions REVISION_NAME=100` |

Production smoke remains incomplete until a human/interactive browser grants the
real microphone permission and confirms agent audio, agent transcript, user
voice transcript, mute suppression, mute recovery, and new conversation.

### Operator Real-Mic Smoke Checklist

Run the following on both Local and Production before marking Full DOD complete.

| Check | Local `http://127.0.0.1:3000/demo/adecco-roleplay` | Production `https://mendan-mvk3ouxwza-an.a.run.app/demo/adecco-roleplay` |
| --- | --- | --- |
| Initial transcript empty | Pending operator confirmation | Pending operator confirmation |
| No mic prompt on initial render | Pending operator confirmation | Pending operator confirmation |
| Hidden UI remains hidden | Pending operator confirmation | Pending operator confirmation |
| Phone button starts session | Pending operator confirmation | Pending operator confirmation |
| Mic permission can be granted | Pending operator confirmation | Pending operator confirmation |
| Agent initial audio plays | Pending operator confirmation | Pending operator confirmation |
| Agent transcript appears | Pending operator confirmation | Pending operator confirmation |
| User says: `こんにちは。今日は営業ロープレの練習をお願いします。` | Pending operator confirmation | Pending operator confirmation |
| User voice transcript appears | Pending operator confirmation | Pending operator confirmation |
| Agent voice response and transcript appear | Pending operator confirmation | Pending operator confirmation |
| Composer sends: `テキストでも会話できますか？` | Pending operator confirmation | Pending operator confirmation |
| Composer user bubble and Agent response appear | Pending operator confirmation | Pending operator confirmation |
| No duplicate bubble | Pending operator confirmation | Pending operator confirmation |
| Mute ON blocks transcript and Agent reaction for 10 seconds | Pending operator confirmation | Pending operator confirmation |
| Mute OFF restores user transcript | Pending operator confirmation | Pending operator confirmation |
| End session shows ended block and keeps transcript | Pending operator confirmation | Pending operator confirmation |
| New Conversation clears transcript without auto-start/mic prompt | Pending operator confirmation | Pending operator confirmation |
| Re-start after New Conversation creates a fresh session | Pending operator confirmation | Pending operator confirmation |
| Provider and secret non-disclosure | Pending operator confirmation | Pending operator confirmation |

### Secret Manager Fallback Review

Production DOD requires the voice session path to use `adecco-mendan` Secret
Manager for `ELEVENLABS_API_KEY`. `projects/zapier-transfer/secrets/ELEVENLABS_API_KEY`
was used once as a migration source to create
`projects/adecco-mendan/secrets/ELEVENLABS_API_KEY/versions/1`; the secret value
was piped directly and not printed. The voice token route runs in production
mode and fails closed unless `ELEVENLABS_API_KEY` is injected by Cloud Run
Secret Manager.

Current correction as of `mendan-00016-zb6`: the broader `mendan` Cloud Run
service still contains `SECRET_SOURCE_PROJECT_ID=zapier-transfer` for
non-voice admin/vendor routes whose server env currently requires a source
project. This does not affect `/api/voice/session-token`, which uses the
injected `ELEVENLABS_API_KEY` secret env in production. Full production secret
closure for all non-voice routes remains a separate follow-up if those routes
must also avoid zapier-transfer fallback.

The code retains ADC fallback only for local/development when
`NODE_ENV !== "production"`. In production, `ELEVENLABS_API_KEY` must be
injected by Cloud Run Secret Manager; otherwise token issuance fails closed with
a generic server configuration error.

## Implementation Evidence

- Official React SDK documentation was rechecked before implementation:
  `startSession` accepts `conversationToken`, infers WebRTC for voice, and can
  accept `connectionType: "webrtc"`.
- Local `@elevenlabs/react@1.2.1` type definitions were rechecked:
  `startSession`, `sendUserMessage`, `setMuted`, `getInputVolume`,
  `getOutputVolume`, `onMessage`, `onStatusChange`, `onModeChange`,
  `onError`, `onDisconnect`, and `onAgentChatResponsePart` exist.
- Local `@elevenlabs/client@1.3.1` depends on `livekit-client:^2.11.4`.
- `livekit-client@2.17.3+` uses `/rtc/v1`, while `2.16.1` uses `/rtc`.
  The production endpoint rejected `/rtc/v1`, so the workspace now overrides
  `livekit-client` to `2.16.1`.
- Session token API supports Secret Manager fallback only outside production.
  Production Cloud Run injects `ELEVENLABS_API_KEY` from `adecco-mendan`
  Secret Manager and does not read `zapier-transfer`.
- Browser-side `getUserMedia` permission denial is handled before token
  issuance and mapped to a safe Japanese microphone-permission error.
- Official Cloud Run docs were rechecked: Secret Manager secrets can be exposed
  to Cloud Run as environment variables, and Cloud Run checks secret access at
  deployment/startup. Official custom-domain docs were rechecked: Firebase
  Hosting or HTTPS Load Balancer are preferred customer-facing options over
  direct Cloud Run domain mapping preview.

## Automated Evidence

| Command | Result |
| --- | --- |
| `pnpm --filter @top-performer/web typecheck` | PASS |
| `pnpm --filter @top-performer/web test` | PASS: 40 files, 180 tests. Previous staffing disclosure ledger failures were stale and did not reproduce after rerun. |
| `pnpm --filter @top-performer/web test` (2026-04-27 v12 rerun) | PASS: 41 files, 211 tests |
| `pnpm --filter @top-performer/scenario-engine test` (2026-04-27 v12 rerun) | PASS: 41 files, 211 tests |
| `pnpm --filter @top-performer/scenario-engine typecheck` (2026-04-27 v12 rerun) | PASS |
| `pnpm --filter @top-performer/scenario-engine test -- src/disclosureLedger/staffingAdeccoLedger.test.ts src/compileStaffingReferenceScenario.test.ts src/priorOrbFailure.regression.test.ts src/publishAgent.test.ts` | PASS: 4 files, 58 tests |
| `pnpm exec eslint packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.ts packages/scenario-engine/src/compileStaffingReferenceScenario.ts packages/scenario-engine/src/publishAgent.ts --ext .ts --ignore-pattern "**/*.test.ts" --no-error-on-unmatched-pattern` | PASS |
| `pnpm --filter @top-performer/scenario-engine lint` | FAIL: existing unrelated lint debt in accounting/phase34/voice profile files, plus broad scenario-engine baseline issues outside this v12 prompt-leak fix. Targeted touched-file lint passed. |
| `pnpm --filter @top-performer/web test -- --run` | PASS: 40 files, 180 tests |
| `pnpm --filter @top-performer/web test apps/web/tests/unit/server-env.test.ts apps/web/tests/unit/session-token-route.test.ts` | PASS: 2 files, 8 tests |
| `pnpm --filter @top-performer/web test:e2e` | PASS: 3 tests |
| `pnpm --filter @top-performer/web test:visual` | PASS: 1 test |
| `pnpm --filter @top-performer/web build` | PASS, with existing Turbopack NFT trace warning from `apps/web/app/api/vendor/eleven/initiation/route.ts` |
| `pnpm --filter @top-performer/web exec eslint components/roleplay lib/roleplay app/demo/adecco-roleplay/page.tsx --ext .ts,.tsx --ignore-pattern '**/*.test.ts' --ignore-pattern '**/*.test.tsx' --no-error-on-unmatched-pattern` | PASS |
| `pnpm lint` | FAIL: existing unrelated `packages/vendors/src/liveavatar.ts` unsafe-any errors at lines 103-104 |

## GCP Evidence

| Check | Result |
| --- | --- |
| Active project | `adecco-mendan` |
| `gcloud projects describe adecco-mendan --project adecco-mendan` | PASS: `ACTIVE` |
| Required APIs in `adecco-mendan` | Enabled: Artifact Registry, Cloud Build, Cloud Run, Secret Manager |
| Artifact Registry | `projects/adecco-mendan/locations/asia-northeast1/repositories/roleplay-ui` |
| Cloud Build | PASS: `fd48b6cc-e27e-401d-99be-f1a8ca295f93` built `session-cleanup-fix-20260426` |
| Cloud Run deploy | PASS: primary `mendan-00018-ltt`, compatibility `roleplay-ui-00018-mc2`, both 100% traffic |
| Latest customer service update | PASS: `mendan-00018-ltt`, 100% traffic, `ELEVENLABS_BRANCH_ID=agtbrch_...w7e6b`, healthz 200, session-token 200 |
| Latest compatibility service update | PASS: `roleplay-ui-00018-mc2`, latest web image, `ELEVENLABS_BRANCH_ID=agtbrch_...w7e6b`, healthz 200, session-token 200 |
| Wrong project safety | No deploy performed to `rhc-analytics-prod`; production commands used `--project adecco-mendan` |
| Production secret closure | PARTIAL: `ELEVENLABS_API_KEY` and `DEMO_ACCESS_TOKEN` are secret refs in `adecco-mendan`; `/api/voice/session-token` uses injected `ELEVENLABS_API_KEY` in production. `mendan-00018-ltt` still has `SECRET_SOURCE_PROJECT_ID=zapier-transfer` for broader non-voice server env compatibility, while `roleplay-ui-00018-mc2` does not define that fallback. Full service-wide fallback removal for non-voice routes remains separate. |
| Cloud Run log secret scan | PASS: recent logs had no matches for API key env name, upstream token, upstream URL, agent id, or branch id patterns checked |
| HTML source map/provider scan | PASS: production `/demo/adecco-roleplay` HTML had no `.map`/`sourceMappingURL` and no provider/internal id strings checked |
| Production API recheck | PASS: `/api/healthz` `200`; session-token `200`; GET `405`; invalid scenario `400`; disallowed origin `403`; missing access `401`; no API key/provider/internal id in response |

## Support Evidence

If real browser + real microphone smoke continues to fail, use
`docs/support/elevenlabs-live-smoke-support.md` as the redacted support packet.
It includes package versions, Cloud Run service/revision, masked IDs, and a
template for disconnect reason, browser console, network, WebRTC, and Cloud Run
log summaries. API keys, full tokens, and raw secret values must never be added.

## Known Limitations

- DevTools Network may show the external voice transport used by the browser SDK. Network-level provider concealment is out of scope.
- The UI, metadata, errors, console logs, storage, and API responses must not expose provider names, agent id, branch id, API key, or upstream URLs.
- Real live completion still requires interactive microphone evidence. Until that is captured, customer demo readiness is conditional.
