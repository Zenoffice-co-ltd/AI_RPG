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

## Representative Commands

```bash
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
