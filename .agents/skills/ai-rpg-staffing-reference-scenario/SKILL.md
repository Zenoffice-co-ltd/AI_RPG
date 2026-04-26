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

## Disclosure Ledger 3-Layer Edit Rule (Manual Orb v3 lesson, 2026-04-26)

**Editing the disclosure ledger alone is insufficient.** Any change to a `triggerIntent` rule must be applied across THREE layers in the same PR — patching only one layer leaves the other layers in conflict and the LLM keeps the old behavior.

| Layer | File | What to update |
|---|---|---|
| 1. Ledger entry | `packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.ts` | The `triggerIntent` object (intentDescription, allowedAnswer, asrVariantTriggers, negativeExamples) AND any `shallowGuards` entry in `renderDisclosureLedgerForPrompt` |
| 2. Rendered system prompt | `packages/scenario-engine/src/compileStaffingReferenceScenario.ts` | The `# Guardrails` block (around line 365), `# Critical Live Behavior`, `# Adecco Reverse Question Rule`. These re-encode rules into the system prompt with HIGHER salience than the per-intent ledger entry — the LLM follows these even when the ledger says otherwise. |
| 3. Locked-in unit tests | `packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.test.ts` | Tests that `expect().toContain(...)` specific phrasing. Changing the ledger wording without updating these turns CI red. |

**Verification check**: after editing, grep both `staffingAdeccoLedger.ts` and `compileStaffingReferenceScenario.ts` for the same key phrases (e.g. `closing_summary`, `三項目以上`) — if the wording diverges, the LLM will follow whichever appears in `compileStaffingReferenceScenario.ts` (rendered prompt wins).

### closing_summary strict A∧B trigger (canonical reference)

After Manual Orb v3, `closing_summary` fires ONLY when BOTH conditions hold in the **same current user turn** (do not weaken this without an explicit RFC):

- (A) Explicit summary signal phrase: one of `整理させてください` / `整理すると` / `まとめると` / `確認させてください` / `認識で合っていますか` / `進め方でよろしいでしょうか` / `という進め方でよろしいでしょうか` / `この理解で合っていますか` / `この内容で進めてよろしいですか`
- (B) ≥3 items from: `営業事務` / `1名/一名` / `6月1日/六月一日/開始` / `8時45分/8:45/17時30分/17:30/就業時間` / `残業/10から15時間/十から十五時間` / `1750/1900/請求/単価` / `受発注` / `対外調整` / `正確性` / `協調性` / `来週水曜日/初回候補/メール`

Conditions (A) only or (B) only must NOT fire `closing_summary`. `chat_history` accumulation / hidden_facts累積 / 「会話が終盤に見える」 are NOT valid bases for firing — only the current user turn counts. AI must not initiate a summary on its own. Other intents (`decision_structure`, `next_step_close`, `competition`, `commercial_terms`, `volume_cycle`, `first_proposal_window`) must end with their own `allowedAnswer` and never append closing_summary content.

### Smoking-gun negativeExamples pattern

When fixing an LLM behavior caught during manual orb, paste the **exact concatenation** the agent produced into the relevant trigger's `negativeExamples` array AND into a new local regression's `failure_examples` AND bind it in `priorOrbFailure.regression.test.ts`. The smoking-gun string is the strongest negative-shot prompt signal available — substring/paraphrase examples alone are not enough. Reference: the manual orb v3 P0 string is preserved in `closing_summary.negativeExamples` and `closing-summary-not-triggered-after-decision-structure.failure_examples`.

Manual orb v5 live-smoke additions:

- `まだお話しになられていますでしょうか` and
  `まだお話しされていますでしょうか` are forbidden in normal replies,
  silence handling, and turn-detection waits. Add the exact phrase to the
  relevant ledger negative examples and rendered prompt forbidden list if it
  recurs.
- Fragment answers such as `受発注、在庫確認` for `job_detail_tasks` are
  smoking-gun failures. The answer must complete the main/attached task split
  in one or two sentences, e.g. 受発注入力と納期調整が中心, with 在庫確認 /
  電話・メールでの対外対応 / 資料更新 as attached work.
- When the symptom is "the agent stops while the user is still speaking",
  combine prompt negative examples with the Adecco turn-taking publish guardrail
  in `ai-rpg-repo-elevenlabs-voice`; prompt edits alone may not fix premature
  turn finalization.

## Brand-name TTS rewrite categorization (manual orb v4 lesson, 2026-04-26)

When a brand or product name in runtime utterances is mispronounced by TTS (e.g. `Adecco` read as 'アデッコ'), the fix touches multiple call sites. Categorize each occurrence into ONE of five buckets and apply the matching rule:

| Category | Example | Action |
|---|---|---|
| **Identifier** (never spoken) | scenario id (`staffing_order_hearing_adecco_manufacturer_busy_manager_medium`), agent name, voice profile id, function names (`buildAdeccoVendorSmokeDefinitions`) | **Keep original spelling.** Changing breaks referential integrity. |
| **Runtime utterance** (LLM speaks this) | `closing_summary.allowedAnswer` examples, rendered prompt section text, `success_examples` | **Rewrite to TTS-friendly form** (e.g. カナ `アデコ`). |
| **LLM judge prompt** (English instruction to vendor judge) | `success_condition` strings | **Extend to accept BOTH old and new forms.** E.g. `"mentions Adecco OR アデコ AND at least one of 強み/特徴/違い"`. |
| **Failure example** (catches wrong behavior) | `failure_examples` arrays in vendor smoke + local regression | **Keep original AND add new variant.** Wrong behavior in either form should still be caught. |
| **Forbidden-utterance list in rendered prompt** | Adecco Reverse Question Rule "出してはいけません" list | **List BOTH forms explicitly.** Don't rely on the LLM generalizing — list `「Adecco さんの派遣の特徴」「アデコさんの派遣の特徴」` as separate items. |

The pattern is: **one runtime form, two judge forms, two failure forms, two forbidden-list forms.** Don't try to use a single regex or matcher to cover both; LLMs follow literal lists more reliably than they follow generalization hints.

### priorOrbFailure 8-char prefix matcher caveat

`packages/scenario-engine/src/priorOrbFailure.regression.test.ts:149` (`failureExampleMatches`) binds prior bad responses to regression tests via 8-character prefix overlap (`badResponse.slice(0, 8)`). When rewriting a brand name that appears at the START of a bound bad response, the prefix changes and the binding silently breaks. Verify by:

1. Identify all entries in `PRIOR_ORB_BAD_RESPONSES` whose `badResponse` starts with the brand name being rewritten.
2. For each, either keep the entry as the original form (and ensure failure_examples contain the original form too) OR add a new entry for the rewritten form alongside.

For `Adecco → アデコ` specifically, the smoking-gun bad response starts with `「ベンダー選定は人...」` (8-char prefix unaffected by Adecco/アデコ swap), so the binding still works. But this is luck, not design — verify first.

## Manual Orb v5 lesson: トリガ条件と応答内容検証は別レイヤー (2026-04-26)

v3 で `closing_summary` の発火条件を strict A∧B に厳密化したが、**発火後の応答内容を検証する仕組み** は別途必要だった。manual orb v5 で発覚した P0 (請求単価 5万円〜10万円 という誤要約に AI が「はい、大きくはその整理で合っています」と同意) は、トリガが正しく発火した上で **LLM が値検証を skip して合意 shape に寄せた** 結果。

教訓: 「Trigger 条件が厳しい = 応答内容も妥当」ではない。発火後の content validation を別仕様として ledger + rendered prompt + tests に書く必要がある。

### Canonical truth table 埋め込みパターン

`closing_summary` のような "学習者の主張を AI が検証する" intent では、`intentDescription` 内に scenario 真値リスト (canonical truth table) を明示的に埋め込む。例 ([staffingAdeccoLedger.ts](../../../packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.ts) 参照):

```
## 値検証ルール
**(A)+(B) を満たして closing_summary が発火しても、合意する前に必ず学習者要約に
含まれる重要条件をシナリオ真値と照合する。**

### Canonical truth table (closing_summary 発火後の照合専用 / 浅い質問への先出し禁止)
- 人数: 一名 (1名)
- 開始日: 六月一日 (6月1日)
- 就業時間: 平日 八時四十五分から十七時三十分 (8:45-17:30)
- 残業: 月 十から十五時間 (10-15h) 程度
- 請求単価: 経験により 千七百五十円から千九百円 (1,750-1,900円) 程度
- ... (15 項目)
```

**重要な scope 制約**: truth table は **発火後の照合専用** であり、浅い質問 (overview_shallow / headcount_only 等) への先出し禁止であることを明記する。これがないと LLM は概要質問で 15 項目を一気に列挙する事故を起こす。

### Dual-example allowedAnswer (Case 1 / Case 2)

ある intent に **2 つの正解パス** (合意 vs 訂正) がある場合、`allowedAnswer` を `Case 1: ...` `Case 2: ...` 形式で **両方 example を併記** する。LLM は example の shape に強く影響されるため、片方しか見せないと寄ってしまう。closing_summary の例:

```
**Case 1: 要約が真値と一致する場合** — 自然に合意し、その後にアデコ逆質問を一度だけ行う。
例：「はい、大きくはその整理で合っています。...ちなみに、アデコさんの派遣の特徴や...」

**Case 2: 要約に重大な誤りがある場合** — まず『違います』と明確に言い、誤っている項目だけを真値で訂正する。
例 (請求単価誤り)：「違います。請求単価は5万円から10万円ではなく、経験により1,750から1,900円程度を想定しています。」
例 (人数誤り)：「違います。募集人数は2名ではなく、営業事務1名で考えています。」
... (5 種の代表訂正例)
```

### Hedging 言語の明示禁止

LLM は「大筋合っていますが…」「少し違うかもしれません」のような softening で逃げる。これらは smoking-gun (誤同意の完全文) とは **別カテゴリ** として `negativeExamples` に列挙する必要がある。例:

```ts
negativeExamples: [
  // 完全な誤同意 smoking-gun
  "はい、大きくはその整理で合っています。...ちなみに、アデコさんの派遣の特徴...",
  // Hedging (これも禁止 — 別エントリで列挙)
  "だいたい合っていますが、単価だけ少し違うかもしれません。",
  "おおむね合っていますが、請求単価だけご確認ください。",
],
```

### 「訂正後はターンを終える」ルール

ロープレ学習効果のため、訂正と同時に逆質問へ進むのは禁止。訂正は学習者が受け止めるターンで止める。`allowedAnswer` の Case 2 例文に逆質問を含めない + `negativeExamples` に「訂正直後にアデコ逆質問へ進む」失敗例を併記する:

```ts
negativeExamples: [
  // 訂正直後にアデコ逆質問へ進む失敗 (manual orb v5 仕様: ターンを終える)
  "違います。請求単価は1,750から1,900円です。ちなみに、アデコさんの派遣の特徴...",
],
```

### 4 層編集 (manual orb v5 で 3-Layer Edit Rule を拡張)

manual orb v3 の 3-Layer Edit Rule (Ledger / rendered prompt / locked-in tests) に加え、内容検証 intent では **新規 ConvAI 回帰テストの追加** が必須:

| 層 | 何を更新 |
|---|---|
| 1. Ledger | intentDescription に truth table + 検証ルール、allowedAnswer に Case 1/2、negativeExamples に smoking-gun + hedging + correction-then-reverse-question |
| 2. Rendered prompt | Critical Live Behavior + Guardrails に truth table + 検証ルール再掲 |
| 3. Locked-in tests | truth table 文言 + Case 1/2 例文 + smoking-gun の存在を assert |
| 4. **新規 ConvAI 回帰** | wrong-value 種別ごとに 1 テスト (例: closing-summary-rejects-wrong-{billing-rate, headcount, start-date, overtime, working-hours})。各テストの success_condition で「`違います` を含む AND 真値を含む AND 誤値を silently 受け入れない」を assert。priorOrbFailure binding に v5 smoking-gun も追加 |

### 内容検証 intent の見分け方

「学習者が何かを主張した時に AI が検証して合意 or 訂正する」性質の intent はすべて値検証ルールが必要:

- `closing_summary` (学習者要約 → 真値と照合)
- (将来) `cost_negotiation` (学習者が単価交渉 → 上限/下限と照合)
- (将来) `schedule_check` (学習者が日程提案 → 真値と照合)

新しい "検証型" intent を追加するときは、最初から canonical truth table + Case 1/2 + hedging negativeExamples + ConvAI 回帰テストをセットで設計する。トリガだけ厳密にして発火後を例文 1 つで済ませると、必ず v5 と同じ罠を踏む。
