# Standard Migration Pipeline

A reusable SOP for multi-phase changes that risk regressing live behavior
(latency, quality, or other production-observable axes). Derived from
the Grok Voice latency-first roadmap (PR #83 → #87, closeout
[2026-05-11](./grok-voice-latency-first-closeout-20260511.md)).

Apply this when:
- A target metric is production-observable but currently not
  instrumented (or instrumented with a stale schema).
- The change spans multiple PRs and touches runtime audio / routing /
  output.
- A regression on the target metric or an adjacent quality gate would
  cost real user trust.

Do NOT apply this when the change is a one-shot bugfix with no perf
or quality dimension — the overhead is wasted.

## The pipeline

### Phase 0 — Observability first

Instrument BEFORE optimizing. The smallest unit of value at this
phase is a typed Cloud Logging field that the dashboard / aggregator
script can group by.

DOD:
- New fields land in the typed log scope (e.g. `grokVoice.turnMetrics`).
- A reusable aggregator script can read them (`pnpm grok:latency-report`
  is the canonical example).
- Sparse schema discipline: missing → omit, explicit null → preserve.
  (See `whenDefined` helper in `apps/web/app/api/v3/event/route.ts`.)
- `cloudRunRevision` (or equivalent deploy id) is on every emitted
  event so before/after diffs are possible.
- Production deploy verifies the schema with synthetic fixtures BEFORE
  any organic traffic shapes the dataset.

### Phase 1 — Measurement noise removal

Before any behavior change lands, fix the issues that would corrupt
the baseline. Common candidates:
- Cache warm path broken / stale → baseline pays cache-miss penalty.
- Deploy wrapper fails on developer machines → you can't reproduce
  observations locally.
- Env validation drops to placeholder strings → the script claims
  success on stale data.
- STT / model env defaults differ between local and prod → harness
  vs production divergence.

DOD:
- Pre-cleanup PR is small, lands quickly, ships with NO new behavior.
- After deploy, the baseline metric distribution is reproducible
  across two consecutive runs.

### Phase 2..N — Behavior changes

Each behavior-change PR follows the same shape:
- Implement the change behind an **env flag** that defaults to ON but
  can be flipped to OFF without client redeploy. The session bootstrap
  (or equivalent per-request handshake) reads the flag fresh; flipping
  the env on the Firebase / Cloud Run console reverts behavior on the
  next request. (Reference: `GROK_VOICE_STRICT_PLAYBACK_MODE`,
  `GROK_VOICE_LOCKED_AUDIO_BUNDLE_ENABLED`.)
- Unit-test BOTH the new branch AND the rollback branch. Pin
  precedence when multiple flags interact.
- Surface a new typed log field if the change introduces a new
  routing class (e.g. `routePath=lock_voice_local_audio`).
- After merge: deploy, run the production-shape probe (browser smoke
  for audio, equivalent fetch for HTTP), query the aggregator script
  for before/after by `routePath` and `cloudRunRevision`. Sample
  size disclosed; n < 5 is preliminary, n ≥ 20 is confident.

DOD per PR:
- typecheck + vitest PASS (structural DOD).
- Production deploy succeeded and the new field appears in Cloud
  Logging (observability DOD).
- Production-shape probe shows the intended metric movement and no
  adjacent-quality regression (improvement DOD).
- Rollback flag documented in PR body and skill, verified by unit
  test (rollback DOD).
- Post-merge `git show origin/main:<path> | grep <signature-line>`
  confirms the squash captured the latest commit (per `AGENTS.md`
  "Always After Merge").

### Closeout

When the final phase is in production:
- Single-page closeout doc (~150 lines) recording rollouts, final
  production metrics, rollback flags, follow-up backlog. Example:
  [docs/grok-voice-latency-first-closeout-20260511.md](./grok-voice-latency-first-closeout-20260511.md).
- Reusable aggregator script is the artifact the follow-up
  remeasurement runs against — not a one-shot dashboard.
- Follow-up issues for organic remeasurement (typically 7-day window)
  and any verification gaps left open by Phase N.
- Memory feedback entry if a new general principle was learned
  (separate from the project-specific closeout doc).

## DOD discipline (the rule the user enforced repeatedly)

Structural DOD ≠ Improvement DOD.

- typecheck PASS → the code compiles.
- vitest PASS → the code does what its author intended.
- Layer B / harness PASS → the change does not regress a test catalog.
- **Improvement DOD requires production observation.** The browser
  smoke harness + Cloud Logging aggregator are the production probes.
  Without them, the only honest framing is "structural DOD complete,
  improvement DOD pending production observation."

## Anti-patterns to avoid

- **Claiming "-40% latency" from Layer B alone.** Layer B
  short-circuits at the harness; production may see 0% or a regression.
- **Skipping post-merge verification.** A squash can capture an
  earlier parent commit if the merge was queued before a late push
  (cf. PR #80 → PR #81 mismatch). Always run `git show origin/main:<path>`.
- **Behavior change without rollback flag.** A regression that
  requires a client redeploy to revert is a fire drill. The flag
  pattern reduces this to an env flip.
- **Closeout without a reusable aggregator.** If "the win" can only
  be reproduced by manually copy-pasting a `gcloud` command from a
  PR comment, it can't be remeasured. Put the query in a script.

## Cross-tool footprint

The SOP itself is repo-level and read by Cursor / Claude Code / Codex
agents the same way. Tool-specific surfaces stay in their own homes:
- Operational catalog for a specific backend → its skill in
  `.agents/skills/`.
- Command-approval guards (destructive ops only) →
  `.codex/rules/secrets.rules` + mirrors at `.claude/rules/` and
  `.cursor/rules/`.
- General workflow guidance → this file plus the relevant `AGENTS.md`
  sections.

The cross-tool propagation contract from `AGENTS.md` `## Secrets`
(four-file simultaneous update) applies only to safety-sensitive
contracts. Workflow patterns like this SOP live in one place and are
referenced from `AGENTS.md`.

## References

- `AGENTS.md` `## Working Defaults` (perf-claim discipline) and
  `## Always After Merge` (post-merge verify + rollback flag).
- `.agents/skills/ai-rpg-adecco-roleplay-ab-backends/SKILL.md` —
  Grok Voice operational catalog (typed log fields, rollback flags,
  canonical scripts).
- Memory:
  - `feedback_perf_claim_needs_production_observation.md`
  - `feedback_rollback_flag_required_for_behavior_change.md`
  - `feedback_verify_late_push_landed.md`
  - `feedback_pr_body_not_deployed_code.md`
- `docs/grok-voice-latency-first-closeout-20260511.md` — worked example.
