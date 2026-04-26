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

## Guardrails

- Do not claim acceptance is done unless the canonical gate passed or you explicitly document the remaining blocker.
- For publish-facing work, include the exact scenario or profile that was exercised.
- If a local server is involved, prefer a fresh process over reusing stale output.
- If `verify:acceptance` remains blocked, add or update `docs/OPERATIONS.md` Known issues / Follow-up Backlog with status, scope, owner placeholder, and acceptance criteria.
