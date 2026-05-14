---
name: ai-rpg-adecco-roleplay-ab-backends
description: Use when working on the three side-by-side Adecco roleplay A/B backends (`/demo/adecco-roleplay` ElevenLabs ConvAI, `/demo/adecco-roleplay-haiku-fish` Claude Haiku 4.5 + Fish Audio + GCP STT, `/demo/adecco-roleplay-v3` xAI Grok Voice Think Fast 1.0 — **canonical production backend as of 2026-05-04**), or when adding a 4th backend variant on top of the same scenario assets. Covers Firebase App Hosting deploy gotchas (Secret Manager IAM trio, cross-project secret name mismatches, `fah/misconfigured-secret` debugging, CSP wiring for new WSS endpoints, AccessGate cookie scoping), per-backend env/secret/log conventions, the xAI Voice Agent integration specifics (ephemeral token endpoint, browser subprotocol auth, event name differences from OpenAI Realtime), and Cloud Logging query templates for quantitative A/B comparison. Do NOT use for the offline benchmark suite (that's `ai-rpg-quality-latency-benchmark`) or the `chat-orb` interactive Stage 3 tooling (that's `ai-rpg-orb-chat-verification`).
---

# Adecco Roleplay A/B Backends

Three side-by-side production routes that all hear the same Adecco 住宅設備メーカー
初回派遣オーダーヒアリング scenario, each driven by a different LLM × voice stack.
**Grok Voice Think Fast 1.0 is the production canonical backend** following the
2026-05-04 A/B comparison. The other two are kept live for ongoing comparison
and as fallbacks.

## Canonical Sources

- [docs/GROK_VOICE_ROLEPLAY.md](../../docs/GROK_VOICE_ROLEPLAY.md) — Grok Voice runbook
- [docs/OPERATIONS.md](../../docs/OPERATIONS.md) § "Adecco Roleplay 3-way A/B Backend Comparison" — quantitative results
- [docs/OPERATIONS.md](../../docs/OPERATIONS.md) § "Adecco Roleplay — Claude Haiku 4.5 + Fish Audio A/B backend" — Haiku Fish runbook
- [apps/web/apphosting.yaml](../../apps/web/apphosting.yaml) — env + secret bindings (single source of truth for what's wired)
- [apps/web/lib/roleplay/server-env.ts](../../apps/web/lib/roleplay/server-env.ts) — Zod schemas for each backend
- [apps/web/lib/roleplay/access-route.ts](../../apps/web/lib/roleplay/access-route.ts) — AccessGate cookie issuer (cookiePaths option)
- [apps/web/components/roleplay/access-gate.tsx](../../apps/web/components/roleplay/access-gate.tsx) — shared password form + ServiceUnavailable
- [apps/web/next.config.ts](../../apps/web/next.config.ts) — CSP `connect-src` directive (gates browser WSS)
- Scenario assets: [data/generated/scenarios/staffing_order_hearing_adecco_manufacturer_busy_manager_medium.assets.json](../../data/generated/scenarios/staffing_order_hearing_adecco_manufacturer_busy_manager_medium.assets.json)
- First message: [config/voice-profiles/staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2.json](../../config/voice-profiles/staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2.json)

## Production decision (2026-05-04)

| Metric | ① ElevenLabs ConvAI | ② Claude Haiku + Fish | ③ Grok Voice Think Fast 1.0 |
|---|---|---|---|
| p50 first audio | (SDK-internal, see below) | 2602 ms | **2415 ms** |
| p90 done | (SDK-internal) | 7623 ms | **5455 ms** |
| Errors observed | 0 | 0 (1 STT confidence < 0.7) | 0 (1 no_audio on first turn) |
| Production canonical | No | Backup | **Yes** |

ElevenLabs metrics live on the LiveKit transport (no App Hosting structured logs);
operator captures via `?debugMetrics=1` in the browser when needed.

## Three backends at a glance

| | ① ElevenLabs | ② Haiku Fish | ③ Grok Voice |
|---|---|---|---|
| Page route | `/demo/adecco-roleplay` | `/demo/adecco-roleplay-haiku-fish` | `/demo/adecco-roleplay-v3` |
| Access route | `/demo/adecco-roleplay/access` | `/demo/adecco-roleplay-haiku-fish/access` | `/demo/adecco-roleplay-v3/access` |
| API namespace | `/api/voice/*` | `/api/haiku-fish/*` | `/api/v3/*` |
| LLM | (ElevenLabs internal — gpt-5-mini) | Anthropic Messages API streaming | xAI Voice Agent (model `grok-voice-think-fast-1.0`) |
| TTS | ElevenLabs (eleven_v3) | Fish Audio s2-pro WAV 24kHz | xAI native PCM16 24kHz |
| STT | ElevenLabs internal | GCP Speech-to-Text v2 (`latest_short`, ja-JP) | xAI Voice Agent internal |
| Transport | WSS to `wss://livekit.rtc.elevenlabs.io/rtc` (LiveKit) | Server SSE (`/api/haiku-fish/respond`) | WSS to `wss://api.x.ai/v1/realtime` (browser-direct) |
| Browser auth | LiveKit JWT from `/api/voice/session-token` | Cookie + same-origin | xAI ephemeral token via `xai-client-secret.<token>` subprotocol |
| Feature flag | (none — always on) | `ENABLE_HAIKU_FISH_ROLEPLAY` + `ENABLE_HAIKU_FISH_MIC_INPUT` | `ENABLE_GROK_VOICE_ROLEPLAY` |
| Hook | `useRoleplayConversation.ts` | `useHaikuFishConversation.ts` | `useGrokVoiceConversation.ts` |
| Logging scope | (none custom) | `haikuFish.{turnMetrics,stt,clientEvent}` | `grokVoice.{session.created,turnMetrics,stt,stt.skipped,mic.state,clientEvent}` |

Grok Voice has route-level A/B/C router variants that share the same scenario,
UI, voice setup, and `/api/v3/*` runtime. The variant is resolved by demo slug,
not by a global env-only switch:

| Route | Router variant | Notes |
|---|---|---|
| `/demo/adecco-roleplay-v3` | `A_STRICT_FALLBACK_CONTROL` | Existing control; do not change behavior when adding variants. |
| `/demo/adecco-roleplay-v4` | `B_NARROW_FALLBACK_SEMANTIC` | Deterministic registered speech, narrower fallback, short fragments ignored. |
| `/demo/adecco-roleplay-v5` | `C_GUARDED_FLEXIBLE_GENERATION` | Experimental flexible generation; audio must be emitted only after suffix guard. |
| `/demo/adecco-roleplay-v6` | `D_FIXED_SHALLOW_BUSINESS` | Fast deterministic fixed-fallback taxonomy for shallow/compound/safety/out-of-scope turns. No runtime generation/TTS/rt_voice. |
| `/demo/adecco-roleplay-v7` | `E_GROK_NATURAL_SHALLOW_GOVERNED` | Experimental Grok natural response with input-depth governor and post guard before audio. Guard failures play fixed fallback artifacts. |
| `/demo/adecco-roleplay-v8` | `F_GROK_NATURAL_SHORT_GOVERNED` | v7-derived Grok natural response with a stricter short-answer governor for lower audio duration. |
| `/demo/adecco-roleplay-v9` | `G_HYBRID_FAST_GOVERNED` | v7-derived hybrid: exact registered-speech hits use local audio, otherwise guarded short Grok generation. |
| `/demo/adecco-roleplay-v10` | `H_V3_STYLE_FAST_REGISTERED_GUARDED` | v4-speed deterministic route using the Haruto registered-speech bank and v6+ fixed fallbacks instead of legacy `fallback_unknown`. |
| `/demo/adecco-roleplay-v11` | `I_V10_RECRUIT_UNKNOWN_GROK_GUARDED` | v10-style exact-match speed, but recruitment-like unmatched turns fall through to guarded Grok runtime. |
| `/demo/adecco-roleplay-v12` | `J_V10_PR92_UNKNOWN_FALLBACK` | v10 deterministic route with a separate PR #92-style fallback artifact (`その点は確認します。`) for comparison. |
| `/demo/adecco-roleplay-v13` | `K_V12_RECRUIT_UNKNOWN_GROK_GUARDED` | v12 baseline, but recruitment-like unknown turns alone fall through to guarded Grok runtime. |
| `/demo/adecco-roleplay-v14` | `L_V13_MANUFACTURER_EXPERIENCE_FAST_GUARDED` | v13 baseline, but manufacturer/industry experience mandatory follow-ups use a short registered-speech artifact before falling through to guarded Grok runtime. |
| `/demo/adecco-roleplay-v15` | `M_V10_HARUTO_FAST_META_UNKNOWN_ONLY` | v10-speed deterministic Haruto route. Recruitment-like unmatched turns use fixed business fallbacks; `fallback_unknown_01` is reserved for system prompt / AI / roleplay / suffix-induction probes. The PR #92 `その点は確認します。` artifact is not used. |
| `/demo/adecco-roleplay-v16` | `N_V14_FAST_MATCHER_TEXT_GUARDED` | v14 baseline with minimal fast-path fixes for 2026-05-13 manual logs: STT variants of maker-experience mandatory questions, busy-period follow-ups, and "営業事務1名ですね" acknowledgements use registered speech before guarded Grok; interim runtime text is hidden until guard/finalization. |
| `/demo/adecco-roleplay-v17` | `O_V14_RECRUIT_UNKNOWN_ALL_GROK_GUARDED` | v14 baseline, but recruitment-like unknown matcher/fallback paths are removed so unmatched job-related questions fall through to guarded Grok runtime. Exact registered-speech hits remain fast. |
| `/demo/adecco-roleplay-v18` | `P_V17_UNKNOWN_GROK_UNGUARDED` | v17 baseline, but matcher-miss unknown and rapid-fire paths go to Grok runtime and the post-generation shallow/over-answering guard is disabled. Exact registered-speech hits and safety/suffix fixed fallbacks remain unchanged. |
| `/demo/adecco-roleplay-v19` | `Q_V17_META_SAFETY_ONLY_FIXED_FALLBACK` | v17/v18-derived route where normal business turns bypass fixed matchers and go to Grok. The registered-speech intent matcher and PR60 locked response matcher are disabled for v19 business input, including billing rate, requested staffing headcount, job content, start date, and decision maker. Fixed fallback remains only for system prompt / AI / instruction override / suffix-induction, safety, and fully out-of-scope turns. |
| `/demo/adecco-roleplay-v20` | `R_V18_LEGACY_HARUTO_23_BASE` | v18 behavior, but registered-speech exact hits and safety/suffix fixed fallback use the reviewed Haruto 23-entry bundle from build `2026-05-12T05-31-48-094Z`. Matcher-miss unknown and rapid-fire turns still go to Grok runtime. |
| `/demo/adecco-roleplay-v21` | `S_V20_LEGACY_HARUTO_SHORT_STREAMING_RUNTIME` | v20 baseline with the reviewed Haruto 23-entry bundle, but runtime Grok turns use shorter answer instructions and `strictPlaybackMode=risk_based` so low-risk audio can begin before `response.done` instead of waiting for the full generation. |
| `/demo/adecco-roleplay-v23` | `T_V21_ACK_STREAM_COMPACT_PROMPT` | v21 baseline with the same Haruto 23-entry bundle, but ack-prefixed business questions can stream, VAD silence is 350ms, and the runtime prompt is compact for faster `response.done`. |
| `/demo/adecco-roleplay-v24` | `U_V23_SERVER_RELAYED_WSS` | Failed App Hosting same-origin relay experiment retained as internal evidence only. App Hosting blocked production WebSocket upgrade before relay logs appeared; do not use as enterprise production path. |
| `/demo/adecco-roleplay-v25` | `B_NARROW_FALLBACK_SEMANTIC` | Enterprise transport route. Conversation behavior remains stable v4-style B, while `realtimeTransport=mendan_cloud_run_relay_wss` connects the browser to `wss://voice.mendan.biz/api/v3/realtime-relay`. |

`/demo/adecco-roleplay-v50` is intentionally not part of the `routerVariant`
table. It is a separate Grok-first negative-guard runtime under
`apps/web/lib/grok-first-roleplay/` with API namespace
`/api/grok-first-v50/*`. Do not wire v50 through `/api/v3/session`,
registered speech, PR60 locked responses, fixed business fallback,
sanitized-response TTS, or locked-response TTS. Its guard may only pass, strip,
drop, cancel, suppress, or emit metrics; it must not generate fallback text or
select a business answer. The v50 session payload must keep
`registeredSpeechPayloadIncluded=false` and
`lockedResponseAudioBundleIncluded=false`. Production v50 event logs must not
include `userTextPreview`, `agentTextPreview`, or `sttTextPreview` unless
`GROK_FIRST_V50_DEBUG_TRANSCRIPT_PREVIEW_ENABLED=true` is explicitly set for a
controlled debug run; even then, previews are capped and secret/instruction/raw
audio fields are stripped.

For v6/v7/v8/v9/v10/v15/v16/v17/v18/v19, never route to the legacy `fallback_unknown` artifact text
`求人要件の範囲で整理します。`; that remains only for the existing v3/v4/v5
comparison baseline. v6/v7/v8/v9/v10/v15/v16/v17/v18/v19 fixed fallbacks are separate registered-speech
intents such as `fallback_business_low_confidence_01`, `fallback_unknown_01`,
and `fallback_pr92_unknown_01`. v17 must not use those fallback artifacts for
recruitment-like unknown turns; let guarded Grok answer them unless the input is
safety, out-of-scope, or suffix-induction. v19 must not use fixed fallback or
business matchers for normal unknown/shallow/compound job-related turns,
canonical registered-speech business intents, PR60 locked-response business
intents, or over-answering-only Grok responses; keep fixed fallback for
meta/AI/suffix/safety/out-of-scope only. v19 keeps the answer-ending
stock-question sanitizer on the normal Grok path: generated audio is buffered,
tail sentences such as `何か他に気になる点はありますか？` are stripped, and only
the cleaned answer is played.
v20 is an explicit audio-baseline comparison route and loads
`data/generated/registered-speech/v1.haruto-20260512/manifest.json`
(`buildId=2026-05-12T05-31-48-094Z`, 23 entries, Haruto voice
`99c95cc8a177`) instead of the current 38-entry bundle.
v21 keeps the same Haruto 23-entry base but changes the Grok runtime leg:
matcher-miss job-related turns still go to Grok, the session instruction asks
for a short direct answer, and the client can stream low-risk audio before
`response.done` to reduce barge-in cancellation risk.
v23 keeps v21's base but addresses the remaining ack-prefixed latency case:
business questions that begin with acknowledgements can stream instead of
buffering, the server VAD silence window is 350ms, and the Voice Agent prompt is
compacted. Keep the sample rate at 24kHz because the reviewed Haruto local PCM
artifacts are 24kHz.
v24 is no longer the customer-network compatibility answer; it is retained only
as failed evidence for the App Hosting same-origin relay attempt. The production
enterprise route is v25. Do not encode transport names as new `routerVariant`
values: v25 must use `routerVariant=B_NARROW_FALLBACK_SEMANTIC` and
`realtimeTransport=mendan_cloud_run_relay_wss`. v25 sessions do not issue xAI
ephemeral tokens; the browser receives a 60-second MENDAN relay ticket and sends
it via `Sec-WebSocket-Protocol` with `mendan-relay-v1`.
For non-v19 registered-speech variants, headcount registered speech is limited
to requested staffing headcount; team, department, branch, or workplace-size
questions must not use the `headcount` artifact. On v19, both categories fall
through to Grok because business matchers are disabled.

Run the split browser gates before deploy:

```bash
pnpm grok:audio-e2e:browser:text
pnpm grok:audio-e2e:browser:voice
pnpm grok:audio-e2e:browser
```

Text evidence is written under `out/grok_voice_browser_audio_e2e/<timestamp>/`.
Voice evidence uses committed fake-mic WAV fixtures under
`test/fixtures/audio/grok-voice-v6-v7/` and is written under
`out/grok_voice_browser_voice_audio_e2e/<timestamp>/`. v7 remains experimental
unless browser voice E2E shows `firstAudibleAudioMs p95 <= 5000ms` and
`doneMs p95 <= 8000ms`; quality PASS alone is not enough for production
adoption.

For v50 adoption, use `corepack pnpm grok-first:v50:browser-live-audio-e2e`
for the live browser + real xAI WebAudio playback gate. Use
`corepack pnpm grok-first:v50:live-e2e -- --rounds 5` for the live transcript
five-run variance gate. Keep evidence under `out/` and do not commit raw
transcripts, audio, screenshots, or Cloud Logging JSON.

## Single-login UX

All three AccessGate routes issue cookies with broad `Path=/demo` and `Path=/api`
so a user enters the demo password **once** on any of the three URLs and can then
freely navigate between them without re-authenticating. Do NOT narrow these paths
back to per-backend (`/api/haiku-fish` etc.) — that broke the side-by-side flow
and required hotfix #47.

```typescript
// Current convention for all three /demo/*/access/route.ts files:
return handleDemoAccess(request, {
  successPath: "/demo/adecco-roleplay-<backend>",
  cookiePaths: { ui: "/demo", api: "/api" },
});
```

## Adding or modifying a backend — pre-flight checks

Before wiring a new backend variant, verify ALL of the following or the deploy
will fail at the preparer step or render `ServiceUnavailable`:

### 1. Secret Manager (per Cloud Build experience)

Each secret referenced from `apphosting.yaml` needs **three IAM bindings** in the
**runtime project** (`adecco-mendan`), not just one:

```bash
# Runtime accessor — most secrets already have this
gcloud secrets add-iam-policy-binding <SECRET> --project=adecco-mendan \
  --member="serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Build-time viewer — missing this causes `fah/misconfigured-secret` at preparer
gcloud secrets add-iam-policy-binding <SECRET> --project=adecco-mendan \
  --member="serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com" \
  --role="roles/secretmanager.viewer"

# Build-time version manager — missing this also causes `fah/misconfigured-secret`
gcloud secrets add-iam-policy-binding <SECRET> --project=adecco-mendan \
  --member="serviceAccount:service-787365421680@gcp-sa-firebaseapphosting.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretVersionManager"
```

The triplet is what every `ELEVENLABS_API_KEY`/`ANTHROPIC_API_KEY`/`FISH_API_KEY`/
etc binding in adecco-mendan has. Mirror it for any new secret.

### 2. Secret name conventions

App Hosting resolves `secret: NAME` against the **runtime project**
(`adecco-mendan`) — NOT the secret-source project (`zapier-transfer`).
If the secret only exists in `zapier-transfer`, copy it:

```bash
gcloud secrets versions access latest --secret=<NAME> --project=zapier-transfer | \
  gcloud secrets create <NAME> --project=adecco-mendan --replication-policy=automatic --data-file=-
```

Watch the case convention. `XAI_API_KEY` (uppercase) was already in
zapier-transfer and was copied to adecco-mendan as the canonical name. Some
existing secrets use lower-snake-case (e.g. `demo-access-token`) and need an
explicit alias in `apphosting.yaml`:

```yaml
- variable: DEMO_ACCESS_TOKEN
  secret: demo-access-token   # env var UPPER_SNAKE, secret lower-snake
```

### 3. CSP `connect-src`

Any new browser-direct WebSocket / fetch endpoint MUST be added to the CSP
in [apps/web/next.config.ts](../../apps/web/next.config.ts):

```typescript
"connect-src 'self' https://api.elevenlabs.io wss://*.elevenlabs.io ... https://api.x.ai wss://api.x.ai"
```

Without it the browser silently rejects the WS handshake with
`Connecting to '...' violates the following Content Security Policy directive`.
The `WebSocket.onerror` handler only sees a generic "websocket error" so the
real cause is invisible without DevTools console inspection — Playwright
headless captures it via `page.on("console")`.

### 4. AccessGate env assertion

Every `/demo/*/page.tsx` calls `assertDemoAccessEnvForProduction()` which
throws if `process.env.DEMO_ACCESS_TOKEN` is unset. This means:
- A new route MUST inherit the broad cookie path config (or re-issue them)
- The `DEMO_ACCESS_TOKEN` env var MUST stay wired in `apphosting.yaml` (it
  maps from the lowercase `demo-access-token` secret)

### 5. ENABLE_* feature flag default

Ship new backends with `ENABLE_X_ROLEPLAY=false` by default so the route
returns `ServiceUnavailable` until secrets are provisioned. Flip the flag to
`"true"` in a follow-up commit only after:
- All required secrets exist in adecco-mendan with the IAM triplet
- An E2E test confirms the route returns AccessGate (not ServiceUnavailable)

## Deploy

Firebase App Hosting **does NOT auto-deploy on push to main** for this backend
(no Repository binding). Use the wrapper script:

```bash
pnpm deploy:adecco-roleplay
```

This runs: baseline rollout/version check → `firebase deploy --only apphosting`
→ poll until SUCCEEDED → `pnpm grok:warm-tts-cache` → post-deploy verification
that `/api/v3/session` returns the expected `guardrailVersion`. Skipping the
warm step leaves a 25% locked-response cache miss rate in production (PR60
canonicals are a 17-entry finite set; missing entries pay a 1.5–3s xAI synth
penalty on first hit per session — measured on the live `build-2026-05-07-002`
revision).

Optional flags:

```bash
pnpm deploy:adecco-roleplay -- --skip-warm     # rollout only
pnpm deploy:adecco-roleplay -- --skip-deploy   # warm only (existing rollout)
pnpm deploy:adecco-roleplay -- --skip-verify   # bypass post-deploy session check
```

If Firebase CLI auth is unavailable or the operator explicitly asks for gcloud,
use the gcloud-backed deploy path:

```bash
pnpm deploy:adecco-roleplay:gcloud
```

This path uses `gcloud auth print-access-token`, `gcloud storage cp`, and the
Firebase App Hosting REST API to create the same source-archive build and
rollout. It still warms the Grok cache and writes deployment evidence under
`out/adecco_roleplay_gcloud_deploy/<timestamp>/`.

If you need to invoke the underlying CLI directly (debugging Cloud Build, or
reapplying secrets without source change), the legacy command still works:

```bash
npx --no-install firebase deploy --only apphosting --project=adecco-mendan --non-interactive
```

`firebase.json` has `apphosting.alwaysDeployFromSource: true` so it bundles the
local source tree directly. Cloud Build runs the preparer step, which is where
secret-resolution failures surface as
`Failed to build your app. Please inspect the build logs at https://console.cloud.google.com/cloud-build/builds;region=asia-east1/<id>?project=787365421680`.

To inspect the failure:

```bash
gcloud builds log <BUILD_ID> --region=asia-east1 --project=adecco-mendan
```

Look for `fah/misconfigured-secret` lines indicating which secret name is missing
or unauthorized.

### Post-deploy must-do

Whenever a PR bumps the runtime — guardrail version, prompt sections, lock
catalog, audio sanitizer, etc. — **always** verify against `origin/main` AND
production after the rollout completes (cf. memory
`feedback_verify_late_push_landed`):

```bash
git fetch origin main
git show origin/main:apps/web/lib/roleplay/grok-voice-pr60-shared.ts | grep <signature-line>
pnpm tsx scripts/grok-voice-v21-prod-smoke.mjs
```

The wrapper script's verify step does the third check automatically; the first
two are the human's responsibility.

## xAI Voice Agent integration specifics (Grok backend)

The xAI Voice Agent API is **NOT** a 1:1 clone of OpenAI Realtime. Differences
that bit during the Grok integration:

| Aspect | OpenAI Realtime convention | xAI Voice Agent reality |
|---|---|---|
| Ephemeral token endpoint | `POST /v1/realtime/sessions` with full session config in body | `POST /v1/realtime/client_secrets` with **only** `{expires_after: {seconds: 300}}` — `session` field is **rejected** |
| Token response shape | `{client_secret: {value, expires_at}}` (nested) | `{value, expires_at}` (**flat**) |
| Browser subprotocol | `openai-realtime-server.<token>` | `xai-client-secret.<token>` (period separator) |
| Session config | At token issuance OR `session.update` over WS | **Only** via `session.update` over WS post-connect |
| First-message field | `session.instructions` initial message | **No equivalent** — inject via `conversation.item.create` with `role:assistant` |
| Agent text delta event | `response.text.delta` / `response.audio_transcript.delta` | `response.output_audio_transcript.delta` (note the `_output_` infix) |
| Audio format | base64 PCM16 in `delta` field on `response.output_audio.delta` | Same |
| Available voices | gpt-5 voices | `eve` / `ara` / `rex` / `sal` / `leo` + custom 8-char IDs |

The hook in `useGrokVoiceConversation.ts` and the wrapper in
`grok-voice-realtime.ts` already handle all of these.

### Grok Voice audio-fix patterns

- Keep the xAI API key server-only. Browser Realtime auth uses ephemeral tokens;
  REST TTS is called only from server routes.
- `/api/v3/session` may include cached greeting PCM only on cache hit. Never
  synchronously call xAI TTS from the session route on cache miss; fall back to
  `/api/v3/greet`.
- TTS cache uses module Map first, then Firestore. Session cache reads must have
  a short timeout budget and failures are misses. If a Firestore read times out,
  let the read warm the module Map in the background for later sessions.
- Deterministic PR60 locked responses (`単価` / `請求` / `時給`) must use
  server-side TTS via `/api/v3/locked-response-tts`, then sync Realtime history
  with `conversation.item.create`. Do not send `response.create` for text
  locked turns.
- For voice locked turns, cancelling Realtime is asynchronous. Keep a short
  stale-drain guard after deterministic TTS so late `response.created`, audio
  deltas, and `response.done` cannot create double playback or bogus
  `no_audio` metrics.
- Voice locked turns can also receive a delayed `speech_started` from the tail of
  the same user utterance after deterministic TTS starts. Ignore that short mic
  tail window; otherwise the browser may log `barge_in`, flush the deterministic
  TTS, and sound like it stops after 1-2 seconds.
- `audioQueue.flush()` remains valid for barge-in. Locked-response deterministic
  playback should only flush before playback if stale Realtime audio already
  reached the queue, with reason `locked_response_preempt_realtime`.
- Stock-suffix cleanup must not cancel a live Realtime response or flush the
  audio queue mid-turn. Let the audio finish and strip stock suffix text at
  `response.done`; otherwise production can sound like it speaks for 1-2
  seconds and then stops.

## Logging scopes (canonical query templates)

Cloud Logging filter to see all per-backend telemetry:

```
resource.type="cloud_run_revision" AND
jsonPayload.scope=~"^(grokVoice|haikuFish)\\."
```

### Grok Voice scope catalog

| Scope | Emitted by | Per turn? | Useful for |
|---|---|---|---|
| `grokVoice.session.created` | `/api/v3/session` (server) | No (per session) | Provenance audit (promptHash, guardrailVersion, model, voice, ephemeralExpiresAt) |
| `grokVoice.turnMetrics` | client → `/api/v3/event` (kind=turn.completed) | Yes | p50/p90 firstAudioMs, doneMs, audioBytes per turn |
| `grokVoice.stt` | client → `/api/v3/event` (kind=stt.completed) | Per user utterance | xAI STT result text length |
| `grokVoice.stt.skipped` | client → `/api/v3/event` (kind=stt.skipped) | Per skip | Empty/silent STT detection |
| `grokVoice.mic.state` | client → `/api/v3/event` (kind=mic.state.changed) | Per state change | idle / listening / speaking transitions |
| `grokVoice.clientEvent` | All client `/event` posts | Yes | Uniform audit trail (ws.connected, ws.error, audio.queue.error, ws.send.*, session.ready, barge_in.*, audio.queue.flushed, etc.) |

Transcript previews are disabled in production by default. Only set
`GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_ENABLED=true` for a demo debugging window,
and keep `GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_MAX_CHARS` bounded (default 200).
When disabled, `/api/v3/event` must strip `sttTextPreview`,
`userTextPreview`, and `agentTextPreview` even if the browser sends them. Never
log full prompts, instructions, or knowledge base text.

When transcript previews are enabled for evaluation, `/api/v3/event` emits both
the sanitized preview string and server-generated UTF-8 Base64 fields
(`sttTextPreviewUtf8Base64`, `userTextPreviewUtf8Base64`,
`agentTextPreviewUtf8Base64`, and when different,
`agentSpokenTextPreviewUtf8Base64`). Use the Base64 fields as the source of
truth for evaluation transcripts because Cloud Logging / terminal display can
degrade Japanese text into `????`. Do not trust client-provided Base64 fields;
they must be generated by the server from the sanitized preview text.

Grok Voice separates spoken text from display/evaluation text. The Realtime
history and xAI TTS may use pronunciation-stable forms such as `たしゃ`,
`六月ついたち`, `月のおわり`, and
`周囲と合わせて進められるタイプ`; the chat transcript and evaluation logs should
show normal business text such as `他社`, `六月一日`, `月末`, and `協調型`.
Add new replacements to the shared display normalizer, not as one-off UI
patches.

## Grok Voice latency-first operations (Phase 0–3, 2026-05-10/11)

The voice latency-first roadmap (PRs #83 → #87) added a small operational
surface that any future Grok Voice change should know about. The
single-page closeout lives at
[`docs/grok-voice-latency-first-closeout-20260511.md`](../../../docs/grok-voice-latency-first-closeout-20260511.md);
that file plus this section are the source of truth for the ops layer.

### Typed observability fields in `grokVoice.turnMetrics`

Emitted via `apps/web/server/grokVoice/metrics.ts` → `console.log` →
Cloud Logging (`jsonPayload.scope="grokVoice.turnMetrics"`). All fields
are optional; missing fields are OMITTED, not nulled (sparse schema
contract — see `whenDefined` in `apps/web/app/api/v3/event/route.ts`).

| Field | Meaning | When to query |
|---|---|---|
| `routePath` | `lock_text` / `lock_voice_local_audio` / `lock_voice_network_tts` / `rt_text` / `rt_voice` / `unknown` | Group every other field by this — the primary slice for any latency report |
| `firstAudibleAudioMs` | end-of-user-speech → first audio chunk PLAYED to user. **Primary voice latency KPI.** | The number to beat for any optimization PR |
| `firstRealtimeAudioDeltaMs` / `firstAudioMs` | First audio delta ARRIVAL from xAI (does not include sanitizer buffer wait) | Diagnose: model gen time vs sanitizer wait |
| `sanitizerDelayMs` | `firstAudibleAudioMs − firstRealtimeAudioDeltaMs` when strict gate buffered the turn; `null` on streamed turns | Spot un-streamed business turns under `risk_based` (should always be `null`) |
| `strictPlaybackMode` | `all_turns` / `risk_based` / `monitor_only` | Group reports by env config; verify default is `risk_based` |
| `strictGateApplied` | `true` for gated turns (ack / closing / identity / post-recovery); `false` for streamed | Risk-gate classifier audit |
| `strictGateReason` | `ack_prefix:なるほど` / `final_closing:…` / `identity_probe:…` / `post_sanitizer_or_reseed` / `null` | Catalog drift signal |
| `streamingBeforeDone` | `true` if at least one audio chunk reached the user before `response.done`; `false` on fully buffered turns | Sanity: should track `!strictGateApplied` for rt_voice |
| `localLockedAudioHit` | `true` when voice lock turn served from `lockedResponseAudioBundle` (PR #87) | Bundle hit rate per voice lock session |
| `lockedResponseKey` | The canonical spoken text itself | Join key against `PR60_LOCKED_RESPONSES` |
| `cacheStatus` / `cacheLookupMs` / `ttsVendorMsAtCreation` / `networkTtsMs` | TTS cache hit/miss + retrieval timing | Diagnose cache health; `networkTtsMs=0` proves local-audio path |
| `cloudRunRevision` | Read from `K_REVISION` env on the server | Group by deploy — required for any before/after diff |

### Canonical operational scripts

- **`pnpm deploy:adecco-roleplay`** — baseline rollout record → `firebase deploy --only apphosting` → poll until SUCCEEDED → `pnpm grok:warm-tts-cache` → post-deploy `/api/v3/session` verification. Use this for normal prod deploys; bare `firebase deploy` is debugging-only.
- **`pnpm deploy:adecco-roleplay:gcloud`** — gcloud-backed fallback/explicit path for the same App Hosting backend. It avoids Firebase CLI auth by using `gcloud auth print-access-token`, `gcloud storage cp`, App Hosting REST `builds.create` / `rollouts.create`, then cache warm + `/api/v3/session` verification.
- **`pnpm grok:warm-tts-cache`** — synthesizes every PR60 canonical and the greeting via xAI TTS into the shared Firestore cache. Validation-aware XAI key resolver (length ≥ 32, not `test-…`). Without warm, the bundle assembler ships 0 entries → `lock_voice_network_tts` path stays cold.
- **`pnpm grok:latency-report`** — reusable Cloud Logging aggregator. Buckets `grokVoice.turnMetrics` by `routePath × strictGateApplied × localLockedAudioHit` and prints p50 / p90 / p95 / p99 for the latency fields. Flags: `--minutes`, `--hours`, `--since <ISO>`, `--revision <name>`, `--json <path>`. Use for every per-deploy before/after diff and the 7-day organic remeasurement (issue #90).
- **`pnpm exec node scripts/grok-voice-v21-prod-browser-audio-smoke.mjs`** — Playwright + Chromium harness that drives the live demo with a WAV fixture via `--use-file-for-fake-audio-capture`. Mode env: `GROK_BROWSER_SMOKE_MODE=voice|text`, fixture env: `GROK_BROWSER_SMOKE_VOICE_FIXTURE=<path>`. This is the canonical Production Voice E2E for any audio-routing change. The 5 existing fixtures are in `test/fixtures/audio/grok-voice-v21/`; expansion for risk-gate classes is tracked in issue #89.

### Rollback flag catalog

Every Phase 2 / Phase 3 behavior is env-flag controlled. Flipping the
env reverts behavior on the next session bootstrap — no client
redeploy required.

| Lever | Env | Default | Rollback value | Effect |
|---|---|---|---|---|
| Strict playback gate (PR #85) | `GROK_VOICE_STRICT_PLAYBACK_MODE` | `risk_based` | `all_turns` | All rt_voice turns return to buffered sanitize-then-play |
| Locked audio bundle (PR #87) | `GROK_VOICE_LOCKED_AUDIO_BUNDLE_ENABLED` | `true` | `false` | Omit bundle from session payload; client falls back to `lock_voice_network_tts` (pre-PR-#87) |
| PR60 locked-response route | `GROK_VOICE_PR60_LOCKS_ENABLED` | `true` | `false` for realtime baseline only | Skip legacy PR60 text/voice locks and fall through to realtime generation; use for same-condition v50 latency baselines, not normal production rollback |
| Combined kill-switch (legacy) | `GROK_VOICE_STRICT_SANITIZED_PLAYBACK` | unset (=true) | `false` | Force `strictPlaybackMode=monitor_only` AND `strictSanitizedPlayback=false` (PR #86 precedence rule) |

Set the env via Firebase console (App Hosting → Backend → Environment),
or `gcloud apphosting backends update`. The session route reads the env
on every request, so the next `/api/v3/session` POST observes the new
value.

### Latency claim DOD

Any PR claiming a latency improvement MUST include:

1. Before/after comparison from `pnpm grok:latency-report` (or
   equivalent Cloud Logging query), grouped by `routePath` and
   `cloudRunRevision`.
2. Sample size disclosed; if `n < 5`, the claim is preliminary.
3. Quality gates verified for the same window: no stock-suffix
   audible leak, no deterministic-lock regression, no empty-STT
   uptick.
4. Rollback env flag documented in the PR body.

Layer B harness `totalMs` is NOT a substitute. Layer B short-circuits
lock turns at the harness level (~600ms WS roundtrip) and does not
exercise the production HTTP TTS / audio decode / playback flow.

## Grok Voice v2.1 PR58 regression gates

Use these after changing `/api/v3/*`, `grok-voice-realtime.ts`,
`useGrokVoiceConversation.ts`, runtime guardrails, or v2.1 scenario behavior:

```bash
pnpm exec tsx scripts/check-grok-voice-e2e-matrix.ts
pnpm exec tsx scripts/grok-voice-v21-scenario-e2e.ts --rounds 2 --critical-rounds 3
pnpm exec tsx scripts/grok-voice-v21-voice-e2e.ts --limit 5
pnpm exec tsx scripts/grok-voice-v21-prod-smoke.mjs
```

For production audio-fix evidence, also run a browser smoke on
`/demo/adecco-roleplay-v3?debugMetrics=1` and capture `/api/v3/event` posts.
In voice mode, the smoke script pads the fake mic WAV with trailing silence
before passing it to Chrome. Keep that behavior on; short
`--use-file-for-fake-audio-capture` WAVs can loop while the mic is still enabled
and make xAI STT look like it heard the same utterance twice.
For locked-response fixes, set `GROK_BROWSER_SMOKE_POST_LOCKED_TEXT` to run a
normal text turn after deterministic locked TTS; this catches the regression
where a locked-turn Realtime drain cancels the next legitimate response:

```bash
GROK_BROWSER_SMOKE_LOCKED_TEXT="単価を教えてください" \
GROK_BROWSER_SMOKE_POST_LOCKED_TEXT="業務時間は？" \
node scripts/grok-voice-v21-prod-browser-audio-smoke.mjs
```

The pass condition is browser-side playback completion, not just route success:
`greeting.cache.hit`, `greeting.playback.completed`,
`locked_response.tts.completed`, `locked_response.playback.completed`,
`turn.completed` with `audioBytes > 0`, and no disallowed
`audio.queue.flushed`. Then fetch Cloud Logging for the same `sessionId` with:

```bash
node scripts/grok-voice-v21-prod-logs.mjs --minutes 30 --limit 1000 --session <gv_sess_...>
```

PR58 added `docs/GROK_VOICE_V21_E2E_MATRIX.md` as the coverage map. The source
of truth for text scenario cases is `scripts/grok-voice-v21-e2e-cases.ts`.
The voice harness writes `summary.json` and `transcript.md` under
`out/grok_voice_v21_voice_e2e/<timestamp>/`; keep those as evidence, not source.

Do not change VAD A/B, `GROK_VOICE_TURN_DETECTION_THRESHOLD`,
`GROK_VOICE_TURN_DETECTION_SILENCE_MS`, or
`GROK_VOICE_TURN_DETECTION_PREFIX_PADDING_MS` as part of v2.1 quality patches
unless the task explicitly scopes VAD work.

### Haiku Fish scope catalog

| Scope | Emitted by | Per turn? | Useful for |
|---|---|---|---|
| `haikuFish.turnMetrics` | `/api/haiku-fish/respond` (server) | Yes | llmFirstSentenceMs, llmDoneMs, ttsFirstAudioMs, e2eFirstAudioMs, e2eDoneMs, responseText |
| `haikuFish.stt` | `/api/haiku-fish/transcribe` (server) | Per user utterance | textLength, textPreview, confidence, vendorRequestMs |
| `haikuFish.clientEvent` | client → `/api/haiku-fish/event` | Yes | mic.state, mic.utterance.queued/skipped, audio.queue.error |

## Quantitative A/B comparison playbook

For a fresh A/B run after any backend change:

1. Operator runs the 10-utterance smoke (see [docs/GROK_VOICE_ROLEPLAY.md](../../docs/GROK_VOICE_ROLEPLAY.md#manual-smoke) — same prompts work for all 3) on each backend
2. Pull 90-min window of structured logs:

```bash
SINCE=$(date -u -d '90 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
for SCOPE in haikuFish.turnMetrics haikuFish.stt grokVoice.turnMetrics; do
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND timestamp>=\"$SINCE\" AND jsonPayload.scope=\"$SCOPE\"" \
    --project=adecco-mendan --limit=200 --format=json \
    > "/tmp/$(echo $SCOPE | tr '.' '-').json"
done
```

3. Compute p50/p90 per backend (helper script in
   [docs/OPERATIONS.md](../../docs/OPERATIONS.md) Adecco Roleplay 3-way section)

The 2026-05-04 baseline numbers are documented at the top of this skill — any
new backend should be compared against those.

## Common failure modes (with diagnostic queries)

| Symptom | Most likely cause | Quick query / fix |
|---|---|---|
| `セッションの開始に失敗しました` on every backend | DEMO_ACCESS_TOKEN env unset OR cookie path too narrow | Check `assertDemoAccessEnvForProduction` throws + `apphosting.yaml` has `DEMO_ACCESS_TOKEN: secret: demo-access-token` + access routes use `cookiePaths: {ui: "/demo", api: "/api"}` |
| `セッションの開始に失敗しました` on ① only | ELEVENLABS_AGENT_ID / BRANCH_ID / API_KEY missing in apphosting.yaml | Cloud Run stderr: `Voice session server environment is not configured.` |
| `セッションの開始に失敗しました` on ② only with 502 from `/api/haiku-fish/respond` | ANTHROPIC_API_KEY / FISH_API_KEY / FISH_ADECCO_VOICE_REFERENCE_ID secret missing or wrong IAM | Cloud Build log: `fah/misconfigured-secret` |
| `セッションの開始に失敗しました` on ③ with 502 from `/api/v3/session` | XAI_API_KEY missing OR endpoint URL wrong | Cloud Run stderr: `grokVoice ephemeral token failed`. Verify `GROK_VOICE_EPHEMERAL_BASE=https://api.x.ai/v1/realtime/client_secrets` (NOT `/sessions`) |
| ③ orb shows `通話が開始されました` then immediately `接続に失敗しました` | CSP missing `wss://api.x.ai` | DevTools console shows `Content Security Policy directive: "connect-src ..."`. Fix `apps/web/next.config.ts` |
| ③ first message shows but agent text never appears (audio plays) | xAI event name not handled in hook switch | Hook must handle `response.output_audio_transcript.delta` (not `response.audio_transcript.delta`) |
| ② mic permission granted but never transcribes | `ENABLE_HAIKU_FISH_MIC_INPUT=false` (returns 501) | Flip flag in `apphosting.yaml` and verify SA has `roles/speech.client` on adecco-mendan |
| Cloud Build preparer fails with `IAM_PERMISSION_DENIED` | Missing build-time SA bindings on a secret | Add `secretVersionManager` (firebase apphosting SA) + `viewer` (compute SA) to the secret |
| ServiceUnavailable on a backend that should be live | Either ENABLE_*_ROLEPLAY=false OR `assert*EnvForProduction` throws | Check the cookie + flag + env trio in this exact order |

## When NOT to use this skill

- Modifying the base scenario assets (`*.assets.json`) → use `ai-rpg-staffing-reference-scenario`
- Offline LLM × TTS Pareto benchmarking → use `ai-rpg-quality-latency-benchmark`
- Interactive Stage 3 chat verification (chat-orb HTML/CLI) → use `ai-rpg-orb-chat-verification`
- ElevenLabs voice profile tuning / publish / shared voice promotion → use `ai-rpg-repo-elevenlabs-voice`
- Adecco eval webhook (post-call grading email) → use `adecco-eval-webhook`
