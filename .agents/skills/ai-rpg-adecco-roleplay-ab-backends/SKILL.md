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
(no Repository binding). Operator runs locally:

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
