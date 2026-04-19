---
name: ai-rpg-staffing-reference-scenario
description: Use when adding or operating reference-artifact based staffing_order_hearing scenarios, especially Adecco manufacturer order hearing compile and publish flows that should keep legacy staffing behavior intact.
---

# AI RPG Staffing Reference Scenario

Use this skill for staffing scenarios compiled directly from a checked-in reference artifact instead of transcript-mined playbooks.

## Canonical Sources

- `README.md`
- `docs/IMPLEMENTATION.md`
- `docs/OPERATIONS.md`
- `docs/references/adecco_manufacturer_order_hearing_reference.json`
- `docs/references/adecco_manufacturer_order_hearing_memo.md`

## Guardrails

- Keep `staffing_order_hearing` legacy variants working; do not replace `DEFAULT_SCENARIO_IDS.busy_manager_medium`.
- Treat the Adecco reference JSON as the scenario content source for this workflow.
- Keep Excel design files as human reference material, not runtime storage SoT.
- Keep generated `data/generated/*` scenario and publish files as validation output unless the task explicitly asks to commit them.
- Do not add voice profile mappings unless the task explicitly asks for voice selection work.
- Keep `dictionaryRequired=false` for the Adecco staffing reference scenario unless the publish contract is intentionally redesigned.
- Do not fabricate orb preview evidence. If Codex cannot perform the human orb conversation, leave blocker placeholders in the memo with the exact preview URL.
- If a legacy staffing ConvAI test fails while validating Adecco, prove whether it is Adecco-caused by comparing legacy scenario/assets and test definitions; record non-Adecco blockers in `docs/OPERATIONS.md`.

## Representative Commands

```bash
pnpm compile:scenarios -- --family staffing_order_hearing --reference ./docs/references/adecco_manufacturer_order_hearing_reference.json
pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium
```

## Expected Evidence

- Generated scenario pack and assets under `data/generated/scenarios/`.
- Publish snapshot under `data/generated/publish/` containing `scenarioId`, `elevenAgentId`, `voiceId`, `ttsModel`, `testRunId`, `dashboard.agentUrl`, and `dashboard.orbPreviewUrl`.
- Adecco publish should include the extra ConvAI test `ending-adecco-strength-reverse-question`; expected count is `11/11`.
- Orb preview memo must include real human-captured lines for opening, shallow-stays-shallow, staged hidden-fact reveal, and the Adecco strength/difference reverse question before marking the orb DoD complete.
