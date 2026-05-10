# AI_RPG Codex Guide

## Repository Expectations

- Treat the repository root `AGENTS.md` as the default working agreement for every task in this repo.
- Keep both scenario families working: `staffing_order_hearing` is the legacy path, and `accounting_clerk_enterprise_ap` is the v2 path.
- Preserve the accounting Source of Truth split:
  - Corpus SoT: `enterprise_accounting_ap_gold_v1`
  - Acceptance reference: `docs/references/accounting_clerk_enterprise_ap_100pt_output.json`
  - Human-readable design reference: `docs/references/accounting_clerk_enterprise_ap_100pt_analysis.md`
- Do not treat generated references or publish artifacts as runtime storage SoT unless the code already does so explicitly.
- For reference-artifact staffing scenarios, keep the checked-in artifact under `docs/references/` as the human-reviewable SoT and treat `data/generated/*` as reproducible evidence unless the task explicitly asks to commit generated artifacts.
- When behavior, public contracts, or runbooks change, update the relevant docs in `docs/` in the same change.

## Secrets

- All API keys, tokens, and credentials are sourced from Google Secret Manager. The runtime (`apps/web/server/secrets.ts`) and any operational scripts must fetch from Secret Manager — never hard-code keys, never commit them to `.env*` files, and never paste them into the repo, PR descriptions, issue comments, or commit messages.
- **Resolution precedence** (every script and dev session must follow this order):
  1. Process env (`process.env["<NAME>"]`) if already set in the current shell.
  2. `apps/web/.env.local` (gitignored, local-only — never commit).
  3. Secret Manager via `gcloud secrets versions access latest --secret=<NAME> --project=<PROJECT>`. Project order: `SECRET_SOURCE_PROJECT_ID` env var → `zapier-transfer` (default) → `adecco-mendan` (per-tenant fallback for `XAI_API_KEY`, `ELEVENLABS_API_KEY`, etc.).
- **Canonical retrieval command** for ad-hoc local use:
  `gcloud secrets versions access latest --secret=<NAME> --project=<PROJECT>`
  Pull into the current shell only. Do not write the value into `apps/web/.env.local`, any tracked file, or any tool config.
- E2E and benchmark scripts must resolve secrets at runtime via the precedence above and exit with an explicit `BLOCKED: <NAME> not available` message if no source yields a real key (length ≥ 32, not a `test-…` placeholder). They must not silently fall back to placeholder strings or skip checks. The reference implementation is `loadXaiKeyFromSecretManagerIfNeeded()` in `scripts/grok-voice-v21-scenario-e2e.ts`.
- This `## Secrets` section is the cross-tool **Source of Truth**. Tool-specific surfaces re-state it (so each tool surfaces the rule natively) without owning the contract:
  - Codex command-approval guards for Secret Manager mutations (`gcloud secrets {delete,versions destroy,versions add,create,set-iam-policy}`) live in [`.codex/rules/secrets.rules`](.codex/rules/secrets.rules).
  - Claude Code surface lives in [`.claude/rules/secrets.md`](.claude/rules/secrets.md).
  - Cursor surface lives in [`.cursor/rules/secrets.mdc`](.cursor/rules/secrets.mdc) (`alwaysApply: true`).
  - Any change to the retrieval contract above must update **all four** files in the same change.

## Working Defaults

- Prefer root `pnpm` scripts over ad hoc one-off commands so operational flows stay reproducible.
- Keep generated files out of commits unless the task explicitly needs checked-in artifacts or reviewer evidence.
- For code changes, run `pnpm typecheck` and `pnpm test` before closing the task when feasible.
- For publish, release, or acceptance work, treat `pnpm verify:acceptance` as the canonical final gate.
- If `verify:acceptance` is blocked, capture the blocker explicitly and verify the underlying substeps you touched.
- When an acceptance blocker appears in a legacy path while working on a new scenario, isolate causality before closing: run the targeted scenario, compare relevant generated scenario/assets and test definitions, and record any non-task blocker in `docs/OPERATIONS.md`.

## Always Before Merge

- Update `README.md` and the relevant `docs/` runbook when commands, behavior, operational flow, or acceptance evidence expectations change.
- Update or add repo skills under `.agents/skills/` when a workflow becomes reusable or when canonical commands/guardrails for an existing workflow change.
- Update `.codex/rules/` or `.codex/hooks/` when you introduce a new safety-sensitive command flow, destructive operation, or recurring prompt-routing need.
- Keep tests, smoke checks, and acceptance scripts aligned with any changed runtime, compile, publish, scoring, or vendor contract.
- When voice-profile mapping changes, update the profile JSON, `config/voice-profiles/scenario-map.json`, and publish-readiness evidence together.
- Do not mark orb preview DoD as complete from generated snapshots or ConvAI tests alone. Human orb utterances must be captured in the relevant memo; otherwise leave the memo as a blocker with the preview URL.

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

- Repo command-approval rules live under `.codex/rules/` (Codex) with cross-tool mirrors at `.claude/rules/` (Claude Code) and `.cursor/rules/` (Cursor). The Codex mirror uses `prefix_rule()` DSL; the Claude / Cursor mirrors are markdown / `.mdc` thin wrappers that point back to AGENTS.md as SoT.
- When introducing a safety-sensitive command flow, destructive operation, or canonical retrieval pattern, update AGENTS.md as the SoT first, then add (or amend) the matching surface in each of `.codex/rules/`, `.claude/rules/`, and `.cursor/rules/`.
- Repo hooks live under `.codex/hooks.json` and `.codex/hooks/`.
- Hooks are experimental and currently disabled on Windows in Codex, so do not rely on hooks as the only safety mechanism for this repo.
