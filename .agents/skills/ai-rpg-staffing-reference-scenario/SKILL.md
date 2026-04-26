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

## Expected Evidence (Auto Gate v2 — 2026-04-26 onwards)

- Generated scenario pack and assets under `data/generated/scenarios/`.
- Publish snapshot under `data/generated/publish/` containing `scenarioId`, `elevenAgentId`, `voiceId`, `ttsModel`, `testRunId`, `dashboard.agentUrl`, `dashboard.orbPreviewUrl`, and `testPolicy` (DoD v2 marker).
- Adecco publish ships **8 vendor smoke tests** to ConvAI (`opening-line`, `headcount-only`, `shallow-overview`, `background-deep-followup`, `next-step-close-safe`, `sap-absence-safe`, `no-coaching-safe`, `closing-summary-simple`). **Expected vendor count is `8/8`** with `passed=true` and non-null `binding`.
- The full **22+ rich regression suite** (`one-turn-lag`, `phrase-loop`, `shallow-leak`, `closing-summary`, `prior-orb-failure`, ASR variants, multi-turn cascades, etc.) lives **locally** in `priorOrbFailure.regression.test.ts` + `publishAgent.test.ts` and is asserted by Vitest. **Do not push these to ConvAI** — the vendor LLM judge is non-deterministic for multi-turn cascade evaluation (documented after 11 publish iterations stabilised at 13–18/22 with the legacy single-suite design).
- Snapshot must include `testPolicy.vendorSmokeCount === 8` and `testPolicy.localRegressionCount >= 22`. Missing this block means the publish was run against a stale `buildTestDefinitions` and must be redone.
- Disclosure Ledger ships **17 `triggerIntent` entries** with `doNotAdvanceLedgerAutomatically: true` on every item. Each ledger item has `triggerIntent / intentDescription / allowedAnswer / forbiddenUntilAsked / negativeExamples / asrVariantTriggers`. Source: `packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.ts`.
- post-publish grep on Adecco staffing artifacts for `SAP|エスエーピー|Oracle|オラクル|ERP|イーアールピー|経費精算|支払` must return 0 matches (accounting family + dictionary files excluded).
- Orb preview memo must include real human-captured lines for opening, shallow-stays-shallow, staged hidden-fact reveal, and the Adecco strength/difference reverse question before marking the orb DoD complete. Manual orb is gated behind both vendor smoke green and local regression green.

## Auto Gate v2 escalation rule

When ConvAI publish results vary across iterations (e.g. 13–18/22 PASS for the same prompt), **do NOT iterate further on the prompt** — escalate to the `ai-rpg-convai-vendor-smoke-split` skill and apply the test-responsibility split. Multi-turn cascade tests must be moved to local regression; only single-turn judge-safe tests stay in the vendor smoke gate. The 27-item mustCapture coverage scoring in `packages/scoring/src/gradeStaffingSession.ts` is the deterministic substitute for the rich quality coverage that the vendor judge cannot reliably provide.
