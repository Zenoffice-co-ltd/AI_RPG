---
name: ai-rpg-convai-vendor-smoke-split
description: Use when ElevenLabs ConvAI publish tests produce non-deterministic results across publish iterations (e.g. PASS count varies between 13/22 and 18/22 for the same prompt), when the LLM judge returns "unknown" verdicts on multi-turn cascade tests, or when a Convai roleplay scenario is being designed and you need to decide what goes into the vendor smoke gate vs. the local deterministic regression. Triggers: "ConvAI tests are flaky", "publish keeps failing on a different test each run", "should this regression test go to ElevenLabs or stay local", "auto gate is unstable".
---

# AI RPG ConvAI Vendor Smoke / Local Regression Split

Use this skill when ElevenLabs ConvAI LLM judge non-determinism is blocking publish, OR when designing the test set for a new ConvAI roleplay scenario.

## When to apply

The split is needed when at least one of the following is true:

- The same prompt published 3+ times produces different PASS counts (judge variance).
- Multi-turn (≥2 user turns) ConvAI tests return "unknown" verdicts repeatedly.
- The publish suite has > 10 tests and includes cascade tests where the agent must escalate disclosure across turns.
- The acceptance criteria require deterministic regression coverage (CI gate, mutation testing, prior-failure binding) that the vendor LLM judge cannot reliably provide.

If the scenario only has 1–4 simple single-turn tests, the split is not needed — keep them all on the vendor side.

## Three-layer architecture

```ts
type EvaluationTarget =
  | "elevenlabs_vendor_smoke"     // 8-ish single-turn judge-safe tests
  | "repo_local_regression"        // 22+ rich tests asserted by Vitest
  | "manual_orb_script";           // human Test 1〜8 walkthrough
```

- **Vendor smoke (ConvAI publish)**: stable, single-turn (or trivially short), judge-safe tests whose only purpose is to obtain `passed=true` and a non-null `binding`. Goal: 8/8 PASS reliably.
- **Local regression (Vitest)**: the rich quality observations — multi-turn cascades, ASR variants, prior orb failure mutations, phrase-loop, hidden-fact leak, closing summary, sap-absence, must-capture coverage, voice mirror parity, lint baseline guard. Asserted offline with deterministic checks.
- **Manual orb**: gated behind both above being green. Exercises full conversation quality that neither the vendor judge nor local rules can certify.

## Canonical implementation

Reference implementation in this repo (Adecco manufacturer order hearing, 2026-04-26 Auto Gate Recovery v2):

- `packages/scenario-engine/src/publishAgent.ts`
  - `buildAdeccoVendorSmokeDefinitions(scenario)` returns the 8 smoke tests
  - `buildAdeccoLocalRegressionDefinitions(scenario)` returns 22+ rich tests
  - `buildTestDefinitions(scenario)` returns vendor smoke ONLY for the Adecco scenario id
  - Publish snapshot return value carries `testPolicy: { vendorSmokeCount, localRegressionCount, vendorSmokeRationale }`
- `packages/scenario-engine/src/priorOrbFailure.regression.test.ts` reads `buildAdeccoLocalRegressionDefinitions` (NOT `buildTestDefinitions`) so prior-orb mutation coverage stays bound to the rich pool.
- `packages/scenario-engine/src/publishAgent.test.ts` asserts:
  - `createTest` is called exactly 8 times with smoke names
  - rich-only names are NEVER passed to `createTest` (negative assertion)
  - `buildAdeccoLocalRegressionDefinitions` returns ≥ 22 entries
  - vendor pool and local pool have zero name overlap

## 8-test vendor smoke pattern

These map well to most B2B Japanese roleplay scenarios. Substitute the scenario-specific facts:

| Test | User turn | Judge looks for |
|---|---|---|
| `opening-line` | Greeting (`こんにちは。本日はよろしくお願いします。`) | Natural Japanese persona opening, scenario-specific cue (e.g. `新しい派遣会社`, `要件整理`), no AI/採点 self-naming |
| `headcount-only` | `今回の募集人数は何名ですか？` | Just the headcount; no leak of competition/budget/decision/volume |
| `shallow-overview` | `今回の募集について概要を教えてください。` | Stay at overview level; no leak of deeper facts |
| `background-deep-followup` | `なぜ新しい派遣会社にも声をかけたのですか？現行のベンダーさんに何か課題がありますか？` | Reveal current-vendor concerns + comparison intent |
| `next-step-close-safe` | `次はどう進めるのがよいですか？` | Concrete next action (proposals, email, deadline); no coaching/列挙 |
| `sap-absence-safe` | `この業務で使う専用システムや業務ツールの経験は必須ですか？` (no banned terms in prompt) | Reply does not introduce SAP/Oracle/ERP/AP/経費精算 |
| `no-coaching-safe` | `何を聞けば良いですか？` | Short deflection (`ご確認したい点からで大丈夫です。`); no listing/ AI self-naming |
| `closing-summary-simple` | Full numeric summary turn ending in `〜という進め方でよろしいでしょうか？` | Acknowledge/correct + ONE Adecco-strength reverse question; no `まだご検討中でしょうか` / `どの点についてですか` loops |

## What NOT to send to ConvAI

Move these to local regression:

- Multi-turn cascades (≥3 user turns) where the agent must escalate disclosure
- ASR-distorted fixtures (the judge can mis-read the user input itself)
- Tests whose `success_condition` requires checking the agent's earlier-turn responses, not just the final reply
- Mutation regressions that need exact substring binding to known prior failure utterances
- Tests that count phrase frequency across turns (e.g. "phrase X appears at most N times in the session")
- Tests whose pass/fail depends on subtle nuance between two near-identical responses

## DoD reuse checklist

When applying the split to a new scenario:

- [ ] Identify the rich regression set first; classify each by `vendorJudgeSafe` (true/false) and `executionTarget`.
- [ ] Build `build<Scenario>VendorSmokeDefinitions` returning ≤ 10 single-turn tests.
- [ ] Build `build<Scenario>LocalRegressionDefinitions` returning all rich tests.
- [ ] Modify `buildTestDefinitions` to branch on scenario id and return smoke-only.
- [ ] Add `testPolicy` block to publish snapshot return value.
- [ ] Update unit tests to assert: vendor count, rich-only NEGATIVE assertion, local count ≥ N, zero overlap.
- [ ] Update prior-orb mutation regression to read the LOCAL pool.
- [ ] Update `docs/OPERATIONS.md` with the rationale and the testPolicy contract.
- [ ] Update the scenario-specific skill (e.g. `ai-rpg-staffing-reference-scenario`) to reflect new vendor count.

## Publish HTTP 400 retry pattern (manual orb v5 lesson, 2026-04-26)

`pnpm publish:scenario` may fail with HTTP 400 from ElevenLabs and an error message like:

```
errorCode: "invalid_parameters"
errorMessage: "Invalid conversation config: String should have at least 1 character"
```

This **looks** like the request payload is malformed, but it can also be **vendor-side flake**. Manual orb v5 publish observed: 1st attempt → HTTP 400 with the above message; immediate 2nd attempt with **identical code and identical payload** → 8/8 PASS.

Retry-once-before-debugging protocol:

1. If HTTP 400 with `String should have at least 1 character` (or similar non-specific Pydantic-style validation error) appears, **re-run `pnpm publish:scenario` once** before investigating payload structure.
2. If the retry succeeds, log the flake to `docs/OPERATIONS.md` (`Latest execution` section) and continue. No code change needed.
3. If the retry also fails with the **same** error, then start payload investigation: search for empty string fields in `compileStaffingReferenceScenario.ts` output, check `agentSystemPrompt` length, check whether any `allowedAnswer` rendered as whitespace-only.
4. Distinguish from genuine retryable errors (`429`, `5xx`, network timeouts) which have their own retry policy in the vendor client.

This is **separate from** the documented multi-turn judge variance (13/22 〜 18/22 PASS variance). The HTTP 400 flake is a **request-acceptance** flake at the API layer, not a judge-evaluation flake.

## softTimeout filler 落とし穴 (manual orb v7 lesson, 2026-04-27)

ElevenLabs ConvAI の `conversation_config.turn.soft_timeout_config.message` は、**intermediate silence (= turn 完了未満の途中沈黙) で発火する filler メッセージ** を生成する vendor-side 機能。

**過去事例**: Adecco lane に `softTimeout: { timeoutSeconds: 3, message: "承知しました。少し整理しますね。" }` が設定されていた結果、orb で AI 応答の **本文の前に毎回「承知しました。少し整理しますね。」** が出るユーザー報告 (manual orb v7)。これは prompt 由来ではなく vendor turn config 由来。

**標準診断手順**: orb で意図しないフィラー / 定型句 / 前置き文が出た場合、prompt より前に **vendor turn config を確認**:

1. `data/generated/publish/<scenario>.json` の `conversation_config.turn` セクションを開く
2. `soft_timeout_config.message` がセットされていないか確認
3. セットされていれば、その literal text と orb で観測されたフィラーが一致するか比較
4. 一致した場合、`buildLiveTurnConfig` 関数 (`packages/scenario-engine/src/publishAgent.ts`) から `softTimeout` 設定を削除して再 publish

**Adecco lane の現状 (v7 fix 以降)**: `softTimeout` は完全削除済。intermediate silence では vendor 側からのフィラー発話なし。

**注意**: `soft_timeout_config` の API バリデーションは「message が non-empty 文字列」を要求するため、削除する場合は `softTimeout` フィールド自体を payload から omit する。空文字列を送ると ElevenLabs が HTTP 400 を返す。

vendor 由来フィラー vs prompt 由来フィラーの **切り分けは publish snapshot の確認が最短経路**。prompt 修正を先に試すと無駄な PR 周回になる。

## Guardrails

- This is **NOT a test weakening**. The 22+ rich observations are still asserted — just in a deterministic rule-based environment instead of a non-deterministic vendor judge.
- Never delete `failure_examples` from local regression tests when moving them off the vendor side. They remain the source of truth for failure-mode coverage.
- Never use this split as an excuse to skip manual orb verification. Manual orb gates are stricter than ConvAI judge in many ways (phrase loop frequency, exact reverse-question timing, voice quality).
- Document the split decision in `docs/OPERATIONS.md` with a one-line rationale referencing this skill. Future maintainers must be able to see why a scenario has 8 vendor tests instead of all 22.
- The split is per-scenario. Other scenarios on the same vendor should keep their existing test contract until they hit the same flake threshold.

## Related skills

- `ai-rpg-staffing-reference-scenario`: scenario-specific operational details for Adecco; cites this skill for the split rule.
- `ai-rpg-repo-elevenlabs-voice`: voice profile mirror pattern; orthogonal but often used together when introducing a new staffing scenario.
- `ai-rpg-acceptance-verification`: CI gate / verify:acceptance interplay including DoD G §6.2 legacy exception.
