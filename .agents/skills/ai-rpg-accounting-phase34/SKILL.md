---
name: ai-rpg-accounting-phase34
description: Use when working on the accounting_clerk_enterprise_ap family, especially transcript ingest, canonical transcript generation, derived artifacts, norms v2, scenario compile, local eval, or publish readiness. Do not use for staffing-only changes or generic web UI tasks that do not touch the accounting pipeline.
---

# AI RPG Accounting Phase 3/4

Use this skill for the accounting v2 pipeline.

## Canonical Sources

- `README.md`
- `docs/IMPLEMENTATION.md`
- `docs/OPERATIONS.md`
- `docs/references/accounting_clerk_enterprise_ap_100pt_output.json`
- `docs/references/accounting_clerk_enterprise_ap_100pt_analysis.md`

## Guardrails

- Treat `enterprise_accounting_ap_gold_v1` as the corpus Source of Truth.
- Treat the reference JSON as semantic acceptance input, not an exact-text golden file.
- Preserve the redaction split: remove proper nouns and direct identifiers, but keep abstracted metadata needed for scenario quality.
- Keep Gold-backed norms separate from Silver-only eval fixtures.

## Default Workflow

1. Confirm whether the task is in import, build, compile, eval, publish, or acceptance scope.
2. Read only the canonical docs needed for that scope.
3. Prefer root scripts over direct package entrypoints.
4. Verify the narrowest relevant stage first, then widen to `pnpm verify:acceptance` when the task is release-facing.

## Representative Commands

```bash
pnpm import:transcripts -- --path "C:/Users/yukih/Downloads/【ビースタイルスマートキャリア】トランスクリプト格納.xlsx" --family accounting_clerk_enterprise_ap --mode v2
pnpm build:playbooks -- --family accounting_clerk_enterprise_ap --mode v2
pnpm compile:scenarios -- --family accounting_clerk_enterprise_ap --mode v2 --reference ./docs/references/accounting_clerk_enterprise_ap_100pt_output.json
pnpm eval:accounting -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium
pnpm publish:scenario -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium
```

## Expected Outputs

- Clear statement of which stage changed.
- Any SoT, acceptance, or publish-readiness assumptions called out explicitly.
- Verification evidence for the changed stage, plus broader acceptance evidence when release-facing.
