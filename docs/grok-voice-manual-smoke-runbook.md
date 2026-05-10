# Grok Voice — Manual Audible Smoke Runbook (Layer C)

This runbook is Layer C of the Phase 5 voice E2E (PR #72). It proves by ear and by network logs that **no closing-question stock suffix reaches the user's speakers** in a real Grok Voice session, and that the strict-playback recovery chain (`response.stock_suffix_detected` → `sanitized_response.tts.completed` → `realtime.reseed.completed`) actually fires when the model emits a suffix.

> Run this **before** merging PR #72 and **again** after the post-merge deploy.

---

## Pre-flight

1. Create a fresh evidence directory:
   ```
   out/grok_voice_audio_e2e/<YYYYMMDDTHHMMSSZ>/
   ```
   Re-use the same timestamp as the most recent Layer A / Layer B artifact when possible so all three layers share an artifact root.
2. Open the demo URL in a fresh browser profile (incognito is fine).
3. Open DevTools → Network. Filter for `Fetch/XHR`. Pin `/api/v3/event`, `/api/v3/sanitized-response-tts`, `/api/v3/locked-response-tts`, `/api/v3/session`.
4. Grant microphone permission when prompted.
5. Wait for the greeting audio to finish ("お時間ありがとうございます。") and the UI status to settle to "listening".

---

## Mode A — Natural smoke

Goal: drive the conversation through the most stock-suffix-prone phrases and confirm by ear that no closing question is audible.

### Conversation script (voice — speak each turn, do not type)

| # | User says | Listen for (must NOT be in the audible reply) |
|---|---|---|
| 1 | 「募集背景を教えてください。」 | 「他に何か質問はありますか」「ご不明点があれば」「お気軽に」「追加で確認したい点があれば」 |
| 2 | 「なるほど。」 | (same as above — low-info ack is the highest-risk turn) |
| 3 | 「単価は？」 | (locked response — must still play; verify ¥1,750〜¥1,900 line) |
| 4 | 「そういうことですね。」 | (low-info ack) |
| 5 | 「よろしくお願いします。」 | 「お気軽に」「ご質問があれば」 — natural closing must not include customer-support tail |

### Audible-check checklist

- [ ] At no point during the 5 turns did I hear any of: 「他に何か質問はありますか」 / 「ご不明点があれば」 / 「お気軽に」 / 「追加で確認したい点があれば」 / 「気になる点」 / 「いつでもお聞きください」.
- [ ] Greeting played at session start (「お時間ありがとうございます。」).
- [ ] 「単価は？」 reply played the canonical 「請求想定は経験により、千七百五十円から、千九百円程度です。」 (locked response).
- [ ] Clean turns played without perceptible delay versus pre-Phase-5 baseline.

### Network checklist (Mode A)

For at least **one clean turn** AND **one locked-response turn**, capture the Network panel:

- Clean turn (e.g. turn 1):
  - `/api/v3/event` post `turn.completed` — copy the `details` JSON. Confirm `outcome === "clean"` and `error === null`.
  - No `response.stock_suffix_detected`, no `sanitized_response.tts.*`, no `realtime.reseed.*`.

- Locked-response turn (turn 3 「単価は？」):
  - `/api/v3/locked-response-tts` POST → 200 with PCM audio.
  - `/api/v3/event` posts `locked_response.tts.completed`, `locked_response.playback.started`, `locked_response.playback.completed`.

If a stock-suffix-detected turn happened naturally during Mode A (lucky), capture its events too — see Mode B's network checklist.

---

## Mode B — Forced sanitized-path smoke

Goal: confirm the strict-playback recovery chain fires correctly when a stock suffix IS emitted. Natural Mode A may not exercise this path because the live model often (correctly) declines to emit suffixes — that's an absence of evidence, not evidence of correctness.

### Option B-1 — Local debug toggle (preferred)

> Requires local `pnpm dev` against a live XAI key. Skip to Option B-2 if not feasible.

1. Run `pnpm --filter @top-performer/web dev` against a live XAI key. Open the demo URL with the query string `?forceStockSuffix=1` (debug-only flag — gated behind `NODE_ENV !== "production"` and a corresponding URL-param read in the conversation hook; **do not ship in prod**).
2. Send any low-info ack ("なるほど"). The conversation hook intercepts the next `response.done` and injects a synthetic stock suffix into the transcript before `finalizeStrictResponseDone` runs.
3. Verify in DevTools → Network:
   - `/api/v3/event` post `response.stock_suffix_detected` with `removedPatternIds: [...]`.
   - `/api/v3/sanitized-response-tts` POST → 200 with PCM audio.
   - `/api/v3/event` posts `sanitized_response.tts.requested`, `sanitized_response.tts.completed`, `sanitized_response.playback.started`, `sanitized_response.playback.completed`.
   - `/api/v3/session` POST with body `{"reseedFromSessionId":"gv_sess_..."}` → 200 with a new `sessionId`.
   - `/api/v3/event` posts `realtime.reseed.started`, `realtime.reseed.completed`.
   - `turn.completed` `details.outcome === "sanitized_tts_played"`, `audioBytes > 0` (sanitized TTS bytes), `error === null`, `parentSessionId` matches the original session.
4. Verify by ear that **only** the sanitized fragment was audible — never the suffix itself.

### Option B-2 — Layer A artifact substitution

If the debug toggle (Option B-1) is not available at the time of smoke (e.g. running against staging/prod without a debug build), explicitly substitute the deterministic Layer A artifact:

1. Capture the path to the most recent `out/grok_voice_audio_e2e/<ts>/layer_a_summary.json` produced by `pnpm --filter @top-performer/web exec tsx scripts/grok-voice-audio-path-e2e.ts`.
2. In the evidence file (`manual_smoke.md` template below), set:
   ```
   forced_sanitized_path_evidence: layer_a
   layer_a_summary_path: out/grok_voice_audio_e2e/<ts>/layer_a_summary.json
   ```
3. Confirm Layer A's `overallPass: true` and that scenarios `stock_suffix_played`, `sanitized_tts_failed`, `sanitized_to_empty`, `unverified_audio_suppressed`, `reseed_failed_after_play` all have `pass: true`. Layer A's deterministic harness covers exactly the chain Mode B Option B-1 would exercise.

---

## Evidence file template

Copy this into `out/grok_voice_audio_e2e/<ts>/manual_smoke.md` and fill in.

```md
# Manual Audible Smoke Evidence

- timestamp: 2026-MM-DDTHH:MM:SSZ
- environment: <local | staging | production>
- demo_url: https://...
- operator: <name>
- browser: <Chrome 130 / Firefox 132 / ...>
- platform: <macOS 15 / Windows 11 / ...>

## Mode A — Natural smoke
- audible_stock_suffix_observed: <YES | NO>
- locked_response_played: <YES | NO>
- clean_turn_event_excerpt:
    <paste sanitized turn.completed details JSON here>
- locked_turn_event_excerpt:
    <paste locked_response.tts.completed details JSON here>

## Mode B — Forced sanitized path
- mode: <option_B1_debug_toggle | option_B2_layer_a_substitute>
- (B1) stock_suffix_detected_event:
    <paste details JSON>
- (B1) sanitized_response_tts_completed_event:
    <paste details JSON>
- (B1) realtime_reseed_completed_event:
    <paste details JSON>
- (B2) layer_a_summary_path:
    out/grok_voice_audio_e2e/<ts>/layer_a_summary.json
- (B2) layer_a_overall_pass: <true | false>

## Final judgment
- DOD met: <YES | NO>
- merge_recommendation: <YES | NO>
- notes:
    <free text — anything unusual the operator observed>
```

---

## Layer C DOD

The smoke is complete when **all** of the following are recorded in the evidence file:

- Mode A `audible_stock_suffix_observed: NO` (no closing-question suffix audible across the 5-turn natural script).
- Mode A network excerpts captured for one clean turn AND one locked-response turn.
- Mode B either Option B-1 (event chain captured) OR Option B-2 (Layer A summary path linked with `overallPass: true`).
- `final_judgment.merge_recommendation: YES`.

If `audible_stock_suffix_observed: YES`, **do not merge** — file a new issue and capture the offending turn's network excerpt in the evidence file before triaging.
