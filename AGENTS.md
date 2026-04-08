# AI_RPG Codex Guide

## Repository Expectations

- Treat the repository root `AGENTS.md` as the default working agreement for every task in this repo.
- Keep both scenario families working: `staffing_order_hearing` is the legacy path, and `accounting_clerk_enterprise_ap` is the v2 path.
- Preserve the accounting Source of Truth split:
  - Corpus SoT: `enterprise_accounting_ap_gold_v1`
  - Acceptance reference: `docs/references/accounting_clerk_enterprise_ap_100pt_output.json`
  - Human-readable design reference: `docs/references/accounting_clerk_enterprise_ap_100pt_analysis.md`
- Do not treat generated references or publish artifacts as runtime storage SoT unless the code already does so explicitly.
- When behavior, public contracts, or runbooks change, update the relevant docs in `docs/` in the same change.

## Working Defaults

- Prefer root `pnpm` scripts over ad hoc one-off commands so operational flows stay reproducible.
- Keep generated files out of commits unless the task explicitly needs checked-in artifacts or reviewer evidence.
- For code changes, run `pnpm typecheck` and `pnpm test` before closing the task when feasible.
- For publish, release, or acceptance work, treat `pnpm verify:acceptance` as the canonical final gate.
- If `verify:acceptance` is blocked, capture the blocker explicitly and verify the underlying substeps you touched.

## Always Before Merge

- Update `README.md` and the relevant `docs/` runbook when commands, behavior, operational flow, or acceptance evidence expectations change.
- Update or add repo skills under `.agents/skills/` when a workflow becomes reusable or when canonical commands/guardrails for an existing workflow change.
- Update `.codex/rules/` or `.codex/hooks/` when you introduce a new safety-sensitive command flow, destructive operation, or recurring prompt-routing need.
- Keep tests, smoke checks, and acceptance scripts aligned with any changed runtime, compile, publish, scoring, or vendor contract.
- When voice-profile mapping changes, update the profile JSON, `config/voice-profiles/scenario-map.json`, and publish-readiness evidence together.

## Directory Map

- `apps/web`: Next.js app, admin surface, internal APIs, session runtime.
- `packages/scenario-engine`: transcript import, playbook generation, compile, eval, publish orchestration.
- `packages/scoring`: scorecard generation and grading.
- `config/voice-profiles`: ElevenLabs profile definitions and active scenario mapping.
- `scripts`: operational entrypoints invoked by `pnpm`.
- `docs`: human-facing implementation, runbook, and reference material.

## Local Overrides

- `packages/scenario-engine/AGENTS.override.md` adds accounting pipeline rules.
- `config/voice-profiles/AGENTS.override.md` adds voice-profile and publish-readiness rules.

## Repo-Scoped Skills

- Codex repo skills live under `.agents/skills/`.
- Keep each skill focused on one workflow and point back to canonical repo docs instead of duplicating long instructions.

## Repo-Scoped Rules And Hooks

- Repo command-approval rules live under `.codex/rules/`.
- Repo hooks live under `.codex/hooks.json` and `.codex/hooks/`.
- Hooks are experimental and currently disabled on Windows in Codex, so do not rely on hooks as the only safety mechanism for this repo.
