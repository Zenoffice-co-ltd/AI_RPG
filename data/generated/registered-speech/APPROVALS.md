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
