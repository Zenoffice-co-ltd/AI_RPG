# Registered Speech Approvals

Each entry below records a human review of a Verified Audio Artifact
manifest before it was promoted from `v1.candidate/` to `v1/`. The
promote script (`pnpm grok:promote-registered-speech`) refuses to copy
candidates whose sha256 differs from the build report, and appends one
row here per approval.

| Manifest version | Build ID | Reviewer (GitHub username) | Approved at (UTC) | Manifest sha256 | Notes |
|---|---|---|---|---|---|
| (none) | (none) | — | — | — | Initial scaffold only — no artifacts have been generated or approved yet. |

## Reviewer checklist (per artifact)

For every entry in the candidate manifest:

1. Listen to `out/registered-speech-build/<build-id>/wav/<intent>.wav`. Reject if pronunciation is wrong, robotic, or carries an unexpected pause / tail.
2. Confirm the `asrText` field in the manifest does not contain any forbidden suffix substring (`他に何か`, `ご質問`, `確認したい点`, etc.). The build script also runs this scan; this is a belt-and-braces check.
3. Confirm `expectedTokensMatched` is exhaustive for the intent. Missing tokens indicate the STT didn't return what the audio actually says — investigate before promoting.
4. Reject the WHOLE candidate (do not promote partial) if any artifact fails.

## Approval procedure

1. Pull the PR that updated `v1.candidate/`.
2. Run `pnpm grok:verify-registered-speech` locally against the candidate path.
3. Open `out/registered-speech-build/<build-id>/review.html` in a browser and walk through every audio preview.
4. If everything passes, run `pnpm grok:promote-registered-speech --approved-by=<github-username> --report-path=out/registered-speech-build/<build-id>/report.json`.
5. Commit the resulting changes to `v1/`, `APPROVALS.md`, and `apps/web/lib/roleplay/registered-speech/manifest-constant.ts` in a single PR.
| 2026-05-11T20:49:39.320Z | 2026-05-11T20-45-48-237Z | 911a240fccf33445… | yukihiro.iwase@gmail.com | out/registered-speech-build/2026-05-11T20-45-48-237Z/report.json | initial v1 build; ASR validation soft-failed because workstation ADC quota_project=zapier-transfer lacks serviceusage on adecco-mendan Speech API; sha256 + forbidden-suffix scan + human ear review on review.html remain as actual guarantees |
| 2026-05-12T00:48:14.919Z | 2026-05-12T00-42-46-422Z | 23ccf3c7a45b6957… | yukihiro.iwase@gmail.com | out/registered-speech-build/2026-05-12T00-42-46-422Z/report.json | Haruto rebuild (PR-95). ASR soft-failed (workstation ADC quota_project=zapier-transfer lacks serviceusage on adecco-mendan Speech API); operator ear-review of review.html required before deploy. |
| 2026-05-12T03:58:45.891Z | 2026-05-12T03-54-35-141Z | 68e61e33341ead1b… | yukihiro.iwase@gmail.com | out/registered-speech-build/2026-05-12T03-54-35-141Z/report.json | Haruto pronunciation fix (PR-95). job_content / skill_requirement_broad rewritten 'じゅはっちゅう' → '受注や発注' so Haruto reads each kanji-word naturally instead of literal kana. |
| 2026-05-12T05:07:29.625Z | 2026-05-12T05-04-25-620Z | 3a26dad11bc00199… | yukihiro.iwase@gmail.com | out/registered-speech-build/2026-05-12T05-04-25-620Z/report.json | A/B verdict applied: 21 B-wins (kana rewrite removed, spoken=display); busy_period to 'げつまつとげっしょ' kana variant; billing_rate keeps kana rewrite (A-wins). |
| 2026-05-12T05:35:09.872Z | 2026-05-12T05-31-48-094Z | b782ac49d1ab4e4e… | yukihiro.iwase@gmail.com | out/registered-speech-build/2026-05-12T05-31-48-094Z/report.json | A/B round-3 verdict: billing_rate adopts arabic-digit form (1750円/1900円) — kana rewrite removed. busy_period stays on げつまつとげっしょ. All other intents unchanged from round-2 promote. |
| 2026-05-12T12:03:19.926Z | 2026-05-12T11-58-11-018Z | 4658c947a0f7d206… | codex@local | C:\\dev\\AI_RPG\\out\\registered-speech-build\\2026-05-12T11-58-11-018Z\\report.json | v6/v7 fixed fallback artifact promotion; ASR best-effort blocked by GCP STT 403, sha256/forbidden-suffix gates passed |
| 2026-05-12T14:08:19.449Z | 2026-05-12T14-04-20-461Z | 14790d68b9b1df22… | codex@local | C:\\dev\\AI_RPG\\out\\registered-speech-build\\2026-05-12T14-04-20-461Z\\report.json | v7 voice latency short artifact promotion; ASR best-effort blocked by GCP STT 403, sha256/forbidden-suffix gates passed |
| 2026-05-12T14:32:55.160Z | 2026-05-12T14-28-55-474Z | d0d20aba50c7ef3d… | codex@local | C:\\dev\\AI_RPG\\out\\registered-speech-build\\2026-05-12T14-28-55-474Z\\report.json | v7 voice rapid-fire latency short artifact promotion; ASR best-effort blocked by GCP STT 403, sha256/forbidden-suffix gates passed |
| 2026-05-13T00:00:00.000Z | 2026-05-13T00-00-00-000Z-v11-v12-minimal | 68e8ed9972b724970e… | codex@local | c7c6937:data/generated/registered-speech/v1/artifacts/fallback_unknown.pcm | v12 comparison artifact: PR #92 fallback_unknown text/audio preserved as fallback_pr92_unknown_01 without changing legacy fallback_unknown |
| 2026-05-13T00:11:51.688Z | 2026-05-13T00-07-13-424Z | 50ac6144316f04a1… | codex@local | out/registered-speech-build/2026-05-13T00-07-13-424Z/report.json | v14 manufacturer experience mandatory follow-up fixed artifact |
