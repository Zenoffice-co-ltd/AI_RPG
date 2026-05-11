# Grok Voice Latency-first Closeout — 2026-05-11

## Executive Summary

The voice first-audible latency optimization for the Adecco Grok Voice
roleplay backend is **complete through Phase 3**. The two structural
contributors to voice latency identified in the Phase 0 observability
work — the all-turn sanitizer buffer (rt_voice) and the per-turn HTTP
TTS roundtrip (lock_voice) — have both been eliminated for the
common-path turns that production traffic actually exercises.

End-state on `build-2026-05-11-001`:

- **rt_voice business** turns: `sanitizerDelayMs` is `null` /
  `streamingBeforeDone=true`; the model's first audio chunk reaches
  the user the moment xAI emits it.
- **lock_voice** turns whose canonical is in the priority bundle:
  `routePath=lock_voice_local_audio`, `networkTtsMs=0`,
  `localLockedAudioHit=true`; audio plays directly from the
  session-bootstrap payload.

No quality gates regressed: deterministic-lock answers are unchanged,
no stock-suffix audible leak observed across the verification window,
risk-gate (ack / identity / closing) buffering still functions as
designed.

## Rollouts

| Phase | PR | Rollout | Summary |
|---|---|---|---|
| 0 | [#83](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/83) | `build-2026-05-10-002` | Voice latency observability + warm-cache deploy wrapper plumbing (`routePath`, `firstAudibleAudioMs`, `cacheLookupMs`, `cloudRunRevision`, `pnpm deploy:adecco-roleplay`) |
| 1 | [#84](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/84) | `build-2026-05-10-003` | Repair TTS cache warm (validation-aware XAI key resolver) + Windows deploy wrapper (direct `node tsx-cli.mjs`); xAI error-body fragment captured in `GrokVoiceTtsError` |
| 2 | [#85](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/85) | `build-2026-05-10-004` | `GROK_VOICE_STRICT_PLAYBACK_MODE` (default `risk_based`) replaces all-turn buffer with per-turn `shouldStrictGateTurn` classification (ack-prefix / final-closing / identity-probe / post-recovery) |
| 2.5 | [#86](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/86) | `build-2026-05-10-005` | Codex P1: `STRICT_SANITIZED_PLAYBACK=false` forces `monitor_only`; Codex P2: `streamingBeforeDoneRef` reset on barge-in |
| 3 | [#87](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/87) | `build-2026-05-11-001` | `lockedResponseAudioBundle` shipped in `/api/v3/session` (8 cache-hit canonicals, ~1.8MB); client `playLockedResponse` short-circuits voice lock turns to local audio |

## Final Production Metrics

Measured via `scripts/grok-voice-v21-prod-browser-audio-smoke.mjs`
driving the live demo with PCM fixtures and cross-referenced against
`grokVoice.turnMetrics` in Cloud Logging on each rollout.

### Voice first-audible latency

| Segment | Baseline | Final | Δ |
|---|---:|---:|---:|
| `rt_voice` business `firstAudibleAudioMs` p50 | ~6,472ms (`build-2026-05-10-001`, all-turn buffer) | **~3,725ms** (PR #85 / #87, short business inputs) | **-2,747ms (-42%)** |
| `rt_voice` business `sanitizerDelayMs` | ~1,603ms (PR A observation on v4.8) | **0 / null** | **eliminated** |
| `lock_voice` `firstAudibleAudioMs` (募集背景, identical input) | **6,131ms** (PR #85 network TTS) | **3,324ms** (PR #87 local audio) | **-2,807ms (-46%)** |
| `lock_voice` `firstAudibleAudioMs` p50 (2 local-hit samples, PR #87) | 6,131ms | **2,955ms** | **-3,176ms (-52%)** |
| `lock_voice` `networkTtsMs` | >0 (~0.5–3s) | **0** | **eliminated** |

### Bundle health (live `/api/v3/session` POST against `build-2026-05-11-001`)

| Metric | Value |
|---|---:|
| `lockedResponseAudioBundle.version` | `v1` |
| `entries.length` | 8 / 8 priority canonicals |
| All entries `cacheStatus` | `hit` |
| `voiceId` / `sampleRateHz` / `codec` | `rex` / 24,000 / `pcm` |
| Total bundled `audioBytes` | 1,822,080 (~1.8MB) |
| `grokVoice.lockedAudioBundle.missed` per session bootstrap | 0 |
| `locked_audio_bundle.loaded` events / local-hit turn | 2 / 2 |
| `locked_audio_bundle.miss` events | 0 |

## Quality Gates

| Gate | Status | Evidence |
|---|:---:|---|
| Stock-suffix audible leak in any voice segment | NO | 6 turns on `build-2026-05-11-001` all `outcome=clean`; no `response.stock_suffix_streaming_risk_detected` events |
| Deterministic lock canonical regression | NO | 募集背景 / 単価 / 件数 / 業務内容 / broad-skill spot-checks all return the expected canonical |
| `rt_voice` streaming regression (PR D win held under PR #87) | NO | 4/4 `rt_voice` E2E turns: `strictGateApplied=false`, `streamingBeforeDone=true`, `sanitizerDelayMs=null` |
| Empty STT / cutoff / barge-in noise uptick | NO observed | 5/5 STT confirmations produced transcripts on the PR #87 E2E |
| `pnpm tsc --noEmit` (post each merge) | PASS | every rollout |
| `pnpm vitest` (full) | PASS | end state: 89 files / 649 tests / all PASS |

## Rollback

Both Phase 2 and Phase 3 are env-flag-controlled. No client redeploy
is required to revert behavior; the next `/api/v3/session` bootstrap
serves the rolled-back configuration immediately.

| Lever | Env | Default | Rollback value | Effect |
|---|---|---|---|---|
| Strict playback gate | `GROK_VOICE_STRICT_PLAYBACK_MODE` | `risk_based` | `all_turns` | Restore PR pre-#85 all-turn buffer |
| Locked audio bundle | `GROK_VOICE_LOCKED_AUDIO_BUNDLE_ENABLED` | `true` | `false` | Omit bundle; client falls back to `lock_voice_network_tts` (pre-PR-#87) |
| Combined kill-switch (legacy) | `GROK_VOICE_STRICT_SANITIZED_PLAYBACK` | unset (=true) | `false` | PR #86 contract: forces `strictPlaybackMode=monitor_only` for new clients AND `strictSanitizedPlayback=false` for legacy clients |

## Cumulative impact (single representative turn)

Comparing the same 募集背景 voice utterance across the deploy history:

```
v4.8 era (all-turn buffer)         lock_voice network TTS   ≈ 6,131ms
build-2026-05-10-004 (PR #85)      strict_playback=risk_based unchanged for lock_voice
                                   → still 6,131ms (PR #85 only fixes rt_voice)
build-2026-05-11-001 (PR #87)      lock_voice_local_audio   = 3,324ms
                                                              ────────
                                                              -2,807ms (-46%)
```

Combined with the rt_voice sanitizer removal (PR #85, ~1.6s saved per
business turn), the production voice pipeline now serves both
business-factual realtime turns AND bundled lock turns with first-
audible latency in the **2.5–4 second range**, down from the
**4.2–6.5 second range** on the v4.8 baseline.

## Follow-ups (not blockers)

1. **7-day organic remeasurement** — query Cloud Logging for
   `grokVoice.turnMetrics` on `build-2026-05-11-001` after a 7-day
   organic-traffic window. Confirm `lock_voice_local_audio` p50 / p90,
   `rt_voice` business p50 / p90, and bundle hit rate on real user
   sessions. Use `scripts/grok-voice-latency-report.ts` as the
   reusable aggregator. Tracked separately.
2. **Risk-gate voice E2E fixture expansion** — the 5 fixtures in
   `test/fixtures/audio/grok-voice-v21/` are all business-factual. The
   risk-gate path (ack / identity / closing) is proven by unit tests
   + synthetic fixtures + production typed-log structure, but a
   fully-organic audio E2E for those classes would close the last
   verification gap. Tracked separately.
3. **Monitoring/dashboard** — the structured-log scopes
   (`grokVoice.turnMetrics`, `grokVoice.lockedAudioBundle`,
   `grokVoice.clientEvent`) carry all the fields needed for a
   per-deploy latency dashboard. The query script lands in
   `scripts/grok-voice-latency-report.ts` as the building block.

## References

- `docs/feedback_grok_voice_v21_e2e_required.md` (memory) — three-layer
  E2E requirements for prompt changes.
- `docs/grok-voice-layered-defenses.md` (memory) — when to use
  deterministic locks vs strict-playback gate vs prompt rules.
- `scripts/grok-voice-v21-prod-browser-audio-smoke.mjs` — Playwright +
  Chromium harness used to drive the Production Voice E2E in PR #85
  and PR #87.
- `scripts/grok-voice-v21-prod-smoke.mjs` — fast version + bundle
  health smoke (no audio).
- `scripts/grok-voice-latency-report.ts` (new in this closeout PR) —
  reusable Cloud Logging aggregator.
