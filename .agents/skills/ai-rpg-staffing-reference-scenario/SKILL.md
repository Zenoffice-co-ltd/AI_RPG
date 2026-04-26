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
- Adecco Orb transcript display depends on the Agents publish payload including
  browser client events for transcript delivery. After publish, confirm
  `conversation.client_events` contains `agent_response`,
  `agent_response_correction`, `agent_chat_response_part`, `user_transcript`,
  `tentative_user_transcript`, and `internal_tentative_agent_response` in
  addition to `audio` and `interruption`. If live audio works but the custom
  Orb transcript is blank, check this list before debugging React.
- Disclosure Ledger source keeps internal `triggerIntent` entries with `doNotAdvanceLedgerAutomatically: true` on every item. **Those internal IDs must not be rendered into the live Agent prompt.** `renderDisclosureLedgerForPrompt()` must expose only sanitized headings such as `## 質問意図 N`, natural-language trigger descriptions, final answer text, and user-utterance hints. Source: `packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.ts`.
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

## Manual Orb v8/v9 lesson: 4 つの繰り返し観察された prompt-engineering アンチパターン (2026-04-27)

manual orb v3 〜 v9 を通して **同じクラスの問題が複数回再発** したため、メタパターンとして恒常化。新しい intent / prompt 編集に着手する前に必ずこのセクションを参照する。

### Pattern 1: 「Allow vs ban conflict」アンチパターン (v5 / v7→v8 / v8→v9 で 3 回再発)

**症状**: prompt 内に「一般的に X を許可」と「特定の compound 'X+Y' を禁止」というコンフリクト構造があると、LLM は **allow を override として ban を破る**。

**過去事例**:
- v5: 「請求単価は経験により1,750-1,900円」allow + 「5万円から10万円」negative example → AI が「5万円から10万円」を user 発話と誤解して "違います。請求単価は5万円から10万円ではなく..." を hallucinate
- v7→v8: 「短い相槌は曖昧発話扱い、何も返さず次の発話を待つ」instructional → AI が「（何も返さず、ユーザーの次の発話を待ちます）」を literal 発話
- v8→v9: 「『承知しました』を自然に使ってよい」allow + 「『承知しました。少し整理しますね。』を ban」 → AI が compound を生成

**標準的解決策 (3 ステップ)**:

1. **allow を位置 / 文脈で制限された stricter form に変換**
   - 旧 (conflict): 「『承知しました』は自然に使ってよい」+「『承知しました。少し整理しますね。』禁止」
   - 新 (positional restriction): 「『承知しました』は **応答の冒頭ではなく、文中で自然に** 使う」

2. **失敗例を smoking gun として negativeExamples に lock**
   - 観測された literal 失敗テキストをそのまま negativeExamples 配列に投入
   - 表記揺れ (英字 / カナ / 全角半角) もすべて列挙

3. **高 salience の独立セクションに昇格** (Pattern 4 参照)
   - bullet item ではなく `# Section` に昇格
   - 「**This step is important. Top-priority rule for response generation.**」を冒頭に明示

**Verification check**: prompt 編集後、`grep -E "(allow|ok|使ってよい).*(ban|禁止|出さない)"` で潜在 conflict を検出。同じ語に対して allow と ban が両方ある場合は要 audit。

### Pattern 2: Trigger split (1 trigger = 1 narrow topic)

**症状**: 1 trigger が複数 sub-topic (例: culture_fit_question = 部署人数 + 男女比 + 課長の人柄 + 服装 + 休憩室) を **1 つの canonical answer に詰め込む** と、フォローアップ質問でも同じ canonical を全文 repeat する。

**過去事例 (v8)**:
- `culture_fit_question` 1 trigger → Q1「指揮命令者は？」と Q2「部署の雰囲気は？」で同じ canonical を 2 回 emit
- 「同じ応答を 2 回以上繰り返さない」prompt rule では弱く、構造的に解決できなかった

**標準的解決策**:
1. **1 trigger = 1 narrow topic** に分離 (v8 で `supervisor_personality_question` + `team_atmosphere_question` に split)
2. 各 trigger の `allowedAnswer` は **1〜2 文に限定**
3. 他 trigger の内容を leak することを **negativeExamples で明示禁止** (cross-contamination guard)
4. `shallowGuards` も責務を限定して書き換え

**判定基準**: trigger の allowedAnswer が 3 文以上 OR 5 種類以上のサブトピックを含む場合は分離検討。

### Pattern 3: Stage direction smoking-gun lock

**症状**: LLM は prompt 内の **instructional text を template として誤解** し、literal 出力する性質がある。括弧付きの「メタ動作描写」「ト書き」が特に出やすい。

**過去事例**:
- v5: prompt の negative example「5万円から10万円」を user 発話例と誤認
- v7→v8: 「何も返さず次の発話を待つ」指示を「（何も返さず、ユーザーの次の発話を待ちます）」と literal 発話

**標準的解決策**:
1. **指示文を imperative form に統一** (「○○しない」「○○しません」「○○を生成しない」)
2. **template-shaped phrase を避ける** (「○○と返す」「○○と答える」のような出力例を内部行動の説明として使わない)
3. **stage direction literal 失敗を smoking gun として negativeExamples に lock**:
   - 「（沈黙）」「（応答なし）」「（何も返さず）」「（次の発話を待つ）」「（保留）」など括弧付きト書きを明示禁止
   - 過去観測した literal 出力テキストもそのまま追加

**判定基準**: prompt 内に「（〜〜）」のような括弧付きメタ説明があれば、それが literal 発話される候補。imperative + smoking-gun セットで防御。

### Pattern 4: 高 salience 独立セクション昇格

**症状**: critical なルールを既存 section の bullet item として追加すると、LLM が無視する場合がある。

**過去事例 (v9)**:
- v7 で「取りつくろいフィラー禁止」を Tone and Response Style の bullet に追加 → v8 manual orb で「承知しました。少し整理しますね。」が再発
- v9 で **「# Response Opening Format」独立セクション** に昇格 + 「**This step is important. Top-priority rule for response generation.**」冒頭明示で解決

**標準的解決策**:
1. critical なルールは bullet item ではなく **独立 `# Section`** に昇格
2. セクション冒頭に **「This step is important. Top-priority rule for response generation.**」** または同等の salience marker を置く
3. **worked example** (× FORBIDDEN / ○ CORRECT) を併記して LLM に具体的な対比を示す
4. forbidden phrase は **明示列挙** (regex / 抽象記述ではなく literal list)

**判定基準**: 同じ rule を 2 PR 以上に渡って追加してもまだ守られない場合、salience 不足を疑い昇格を検討。

### v8 で確立した「分離可能 intent」マーカー

`culture_fit_question` を `supervisor_personality_question` + `team_atmosphere_question` に分離した経験から、以下の性質を持つ intent は **最初から分離設計** すべき:

- 質問パターンが明らかに 2 種類以上ある (例: 人柄 vs 環境)
- canonical answer が 3 文を超える
- 学習者が連続して関連質問を投げる可能性がある (Q1 = 一部、Q2 = 別の一部)
- 各 sub-topic の Excel weight (Sheet 05) が独立している

将来の検証型 intent (例: `cost_negotiation`) を追加する際は、まず分離可能性を check してから単一 trigger 化を判断する。

## Manual Orb v10 lesson: pre-commit audit checklist (2026-04-27)

v10 で「自分自身が文書化した直後にパターンを踏んだ」皮肉な事例から確立した audit 手順。`compileStaffingReferenceScenario.ts` または `staffingAdeccoLedger.ts` を編集する **PR 作成前に必ず実行** すること。

### Step 1: Pattern 1 (Allow vs ban conflict) audit

```bash
# allow を示唆する語のスキャン
grep -E "使ってください|OK ですが|自然に使って|使う場合は|使ってよい|許可" packages/scenario-engine/src/compileStaffingReferenceScenario.ts

# 各ヒットに対して、同じ語/文に関する ban が他セクションに存在しないか確認
# 例: 「承知しました」が allow されているなら、別セクションで「承知しました 禁止」もないか?
```

### Step 2: 重複トピックセクション audit

```bash
# トピック語ごとに section が複数ないか確認
grep -E "^# .*沈黙|^# .*silence|^# .*Silence|^# .*フィラー|^# .*filler|^# .*取りつくろい|^# .*Response Opening" packages/scenario-engine/src/compileStaffingReferenceScenario.ts
```

ヒット 2 件以上 → 統合 / 1 つに merge する。重複は Pattern 1 の温床。

### Step 3: Literal example audit (Pattern 3 補強)

```bash
# 「アシスタント: 「...」」のような literal example を find
grep -E "アシスタント:\s*「" packages/scenario-engine/src/compileStaffingReferenceScenario.ts
```

各 literal example に対して:
- 冒頭が Response Opening Format で禁止されている前置き定型句で始まっていないか確認
- 該当する場合、例文を **abstract guideline** に書き換える (literal template parrot risk 回避)

### Step 4: 並行セッション由来の merged コンテンツ audit

並行 session の作業を bundle した PR (PR #18 v7 が canonical example) は **追加されたセクションの全数を一度 review** すること。並行 session が古い prompt 設計を持ち込んでいる可能性がある。

```bash
git log --oneline -p packages/scenario-engine/src/compileStaffingReferenceScenario.ts | grep "^# " | sort -u | head -30
```

新しい `# Section` が登場した場合、それが既存の v3-v9 修正と conflict しないか full review。

### Step 5: Verify smoking-gun reach (v11 lesson)

`negativeExamples` への smoking-gun 追加だけでは **live agent には届かない**。詳細は次のセクション。

## Manual Orb v11 lesson: smoking-gun lock の正しい reach (2026-04-27)

v11 で発見した critical operational fact:

### `renderDisclosureLedgerForPrompt()` は `negativeExamples` を live prompt に render しない

`renderDisclosureLedgerForPrompt()` ([packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.ts](../../../packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.ts)) が live agent prompt に書き出すフィールドは v12 以降、**内部名をサニタイズした自然言語だけ**:

- `## 質問意図 N` (internal ID ではなく連番)
- `ユーザー発話の種類: ${intentDescription}`
- `応答 (※ 本題から直接始める...): ${allowedAnswer}` (v11 inline ban suffix 付き)
- `今回の回答では触れない情報: ${shallowGuard}` (該当 trigger のみ。shallowGuard の内部名は出さない)
- `ユーザー発話の手がかり: ${asrVariantTriggers.join(", ")}`

**`negativeExamples` は render されない** — それらは ConvAI 自動テスト fixture (`publishAgent.ts` の test definitions) でしか使われない。

## Manual Orb v12 lesson: internal prompt structure leak prevention (2026-04-27)

manual orb v12 で、Agent が `team_atmosphere_question` / `triggerIntent` / `応答ルール` / 回答方針の自己実況を発話する P0 が報告された。Cloud Run transcript logs for the reported 06:39 session did not show the leak in displayed rows, but the generated prompt still contained enough internal structure to make the failure plausible. Treat this class as a release blocker.

### Required v12 prompt hygiene

- Live prompt must not contain user-visible internal field names or IDs: `triggerIntent`, `allowedAnswer`, `forbiddenUntilAsked`, `shallowGuard`, `doNotAdvanceLedgerAutomatically`, `team_atmosphere_question`, `supervisor_personality_question`, `closing_summary`, `応答ルール`, `判定条件`, `canonical answer`, or `Disclosure Ledger`.
- Render ledger headings as `## 質問意図 N`, not `## ${triggerIntent}`.
- Describe matching as `ユーザー発話の種類`, not `判定条件`.
- Describe guardrails as `今回の回答では触れない情報`, not `shallowGuard` or `今の応答に含めない`.
- Add a high-salience prompt ban near the top and in the final reminder: the Agent must not verbalize prompt sections, internal criteria, classification reasoning, JSON, IDs, or "ユーザーは〜と質問しています / これは〜に該当します / ルールに従って".
- Add a local regression in `publishAgent.ts` for the exact leak and bind it in `priorOrbFailure.regression.test.ts`.
- After compile, run a generated prompt grep for all forbidden terms before publishing.

Canonical check:

```bash
pnpm compile:scenarios -- --family staffing_order_hearing --reference ./docs/references/adecco_manufacturer_order_hearing_reference.json
python - <<'PY'
import json
from pathlib import Path
p = Path("data/generated/scenarios/staffing_order_hearing_adecco_manufacturer_busy_manager_medium.assets.json")
prompt = json.loads(p.read_text(encoding="utf-8"))["agentSystemPrompt"]
for term in [
    "triggerIntent", "team_atmosphere_question", "supervisor_personality_question",
    "allowedAnswer", "shallowGuard", "doNotAdvanceLedgerAutomatically",
    "forbiddenUntilAsked", "応答ルール", "判定条件", "# Disclosure Ledger",
    "canonical answer",
]:
    assert term not in prompt, term
print("sanitized prompt check PASS")
PY
```

### Similar-duplicate vs UI duplicate

When the operator reports repeated rows, classify the source before patching:

- If Cloud Run `Roleplay transcript` logs show repeated `displayed / agent / final` rows with the same `normalizedTextHash`, it is UI/SDK aggregation and belongs in `apps/web`.
- If logs show only one displayed row but the conversation naturally repeats similar business facts after related user questions, it is scenario answer-shape repetition. Fix by narrowing or splitting the relevant intent and rewriting `allowedAnswer` to answer the new subtopic directly.
- For `selection_priority_ranking`, avoid returning the same generic priority paragraph for both "優先経験は?" and "マスト/ウォントは?". The live answer should distinguish must/want: マスト = 受発注・対外調整経験 and accuracy; ウォント = manufacturer order-entry/data-entry familiarity; age is only a guideline.

### Vendor smoke quota handling

If `pnpm publish:scenario` returns `condition_result.result = "unknown"` for all vendor smoke tests, fetch the raw test invocation before editing prompts again. A `quota_exceeded` rationale means the test did not evaluate the prompt. Record the quota blocker in `docs/qa.md`; do not claim vendor smoke passed. It is acceptable to point Cloud Run at the updated branch only as a clearly documented conditional deployment when local regressions and sanitized prompt checks pass.

## Manual Orb v13 lesson: silence fallback and semantic intent labels (2026-04-27)

manual orb v13 surfaced two recurring failure modes after v12 prompt sanitation:

1. The Agent generated fallback text such as `ご確認したい点からで大丈夫です`,
   `どの点についてですか`, or literal stage direction text like `（沈黙）` for
   empty/ambiguous turns.
2. Sanitizing `## ${triggerIntent}` to `## 質問意図 N` removed internal IDs, but
   also removed semantic anchors that helped the model distinguish adjacent
   intents with overlapping ASR triggers.

### Required v13 prompt behavior

- `ご確認したい点からで大丈夫です。` is only valid for explicit coaching
  requests such as `何を聞けばよいですか` / `次は何を確認すれば良いですか`.
  It is not a silence fallback and must not be used for empty transcripts,
  short acknowledgements (`はい`, `うん`, `えっと`), noise frames, or ambiguous
  partial speech.
- `どの点についてですか` is banned for this Adecco roleplay. Do not allow it as a
  generic clarification suffix, silence filler, or ambiguous-turn fallback.
- For silence / empty transcript / noise-only frames / single-word fillers, the
  correct behavior is to enqueue no response text at all. Do not output stage
  directions such as `（沈黙）`, `（応答なし）`, or `（何も返さず待つ）`.
- Keep v12 sanitation: do not expose English internal IDs (`triggerIntent`,
  `team_atmosphere_question`, etc.) in the live prompt. If semantic anchors are
  needed, use Japanese labels in headings, e.g. `## 質問意図 18: 部署環境
  (人数・男女比・年齢層・服装)`.
- Commercial terms are high-risk for over-disclosure. If the user asks for one
  condition (単価 / 残業 / 就業時間), answer only that condition and do not bundle
  unrelated start date, priority, decision structure, or summary content.

### Required verification

- Add or update local regressions for silence fallback, stage-direction output,
  and `どの点についてですか` loops before publishing.
- After compile, run the v12 forbidden-term grep and additionally inspect the
  rendered headings to confirm they contain Japanese semantic labels but no
  English trigger IDs.
- After publish, run vendor smoke. If quota is exhausted, record it as a quota
  blocker and do not claim the prompt was judged.

### Pattern 3 smoking-gun lock の **正しい reach 戦略**

LLM の hallucination / template-parrot を **live agent に対して** 防ぐには:

| 手段 | live agent への効果 | ConvAI 自動テストへの効果 |
|---|---|---|
| `negativeExamples` に追加 | **❌ 効果なし** (render されない) | ✅ 検出する |
| `intentDescription` に inline embed | ✅ 直接届く | ✅ 検出される (ledger 参照) |
| `allowedAnswer` の前後に inline 注釈 | ✅ 直接届く (v11 採用) | ✅ 検出される |
| `renderDisclosureLedgerForPrompt` の formatter で全 trigger に suffix 付与 | ✅ **maximum proximity** (v11 採用) | ✅ |
| Rendered prompt の高 salience 独立セクション | ✅ 直接届く (recency 含む) | (test には影響なし) |

**標準的アプローチ (v11 確立)**:

1. **Live agent に効かせたい禁止** = `intentDescription` / `allowedAnswer` に inline embed OR `renderDisclosureLedgerForPrompt` formatter に suffix を加える OR rendered prompt に高 salience セクション追加
2. **ConvAI 自動テストで検出したい failure mode** = `negativeExamples` に literal smoking-gun を追加 (test fixture に伝播)
3. 両方欲しい場合 (推奨) = 1 + 2 の **両方適用**

### Recency bias 活用パターン (v11 で確立)

prompt 全体は LLM の attention で読まれるが、**末尾セクションは recency bias により最高 attention** を受ける。critical な禁止ルールは:

- 末尾に独立セクション (例: `# Final Reminder Before You Speak`) を追加
- 「**This is the LAST instruction before you generate your response. Apply it on every turn.**」と明示
- 5〜7 個の最頻違反ルールを enumerate

これは v9 で導入した「Response Opening Format を高 salience セクションに昇格」とは **補完関係**:
- v9 の `# Response Opening Format` (Disclosure Ledger の前) = 早期に rule を提示
- v11 の `# Final Reminder Before You Speak` (Guardrails の後 = prompt 末尾) = 直前に rule を再提示
- 両方あることで、LLM の attention window のどこからでも rule を参照できる

長い prompt (Disclosure Ledger が 21 trigger 分で巨大) では proximity + recency の **両ストラテジー併用** が必須。

## Manual Orb v13 lesson: allowedAnswer must be utterance-only literal (2026-04-27)

`allowedAnswer` は `renderDisclosureLedgerForPrompt` によって live prompt の `応答 (※ ...): ${item.allowedAnswer}` 行にそのまま展開される。`allowedAnswer` 内に **メタ指示文** (`〜してください` `〜ください` `程度で短く受け流す` `〜しない` `聞かれた項目に対応する値だけ返す` 等) が混ざっていると、LLM がそれを「発話してよい canonical 文」として parrot する可能性がある。

実例 (v13 で観測):
- `coaching_request.allowedAnswer = "「ご確認したい点からで大丈夫です。」程度で短く受け流す。確認項目を列挙しない。"` → 沈黙時に「ご確認したい点」が直接漏出
- `commercial_terms.allowedAnswer = "聞かれた項目に対応する値だけ返す。…"` → メタ指示そのものが応答として読み上げられる risk

### v13 で確立したルール

1. **`allowedAnswer` には canonical 発話 (鉤括弧 `「...」` で囲まれた literal) だけを置く。**
2. メタ指示・制約条件は `intentDescription` または `shallowGuards` (renderer 内) に移す。
3. Pre-commit grep:
   ```bash
   awk '/allowedAnswer:/{getline; print NR": "$0}' \
     packages/scenario-engine/src/disclosureLedger/staffingAdeccoLedger.ts
   ```
   各行は `「...」` literal だけで構成され、`〜してください` `〜ください` `程度で` `〜しない` `〜返す` の語尾を含まないことを確認。
4. ledger entry が `allowedAnswer: [...]` (array 形式) の場合 (例: `closing_summary` の Case 1/2 分岐) は、各要素も literal `「...」` か説明 prefix `**Case N: ...**` だけで構成する。directive prefix は禁止。

## Manual Orb v13 lesson: Pattern 1 conflict — 条件付き allow が ban を打ち消す (2026-04-27)

**症状**: 同じフレーズが prompt 内で「条件付き allow」として書かれ、別の場所で「ban」として書かれていると、LLM は **allow 側を優先して常用** する。条件 (例:「曖昧な発話のときだけ」「最大二回まで」) は LLM の判定では曖昧で、recency / proximity が高い記述が勝つ。

実例 (v13 で観測):
- `「どの点についてですか」`: `# Tone` で「曖昧なときだけ使う」(条件付 allow) + `# Guardrails` で「最大二回まで」(回数制限 allow) + ledger negativeExamples で「失敗例」(ban) → 通常応答末尾に **2 連続で発話** された
- `「ご確認したい点からで大丈夫です」`: `# Silence` で「曖昧な発話には最大一度」(条件付 allow) + `coaching_request.allowedAnswer` (canonical) → ASR の空フレーム / 短い相槌が「曖昧」に分類されて **沈黙時に発話** された

### v13 で確立したルール

1. **条件付き allow を書く誘惑に勝つ**。「Y の場合だけ X を使う」と書いてはいけない。代わりに:
   - X を **完全 ban** にする (使い道がほぼない場合)
   - X を **特定の質問意図 (例: `coaching_request`) の canonical answer に限定** し、それ以外では一切使わないと明示
2. **同じフレーズの ban / allow を複数セクションに分散させない**。1 セクションで完結させる。
3. Pre-commit audit:
   ```bash
   # 同じフレーズが allow + ban の両方で出ていないか
   grep -nE '(使ってください|OK ですが|自然に使って|使う場合は|使ってよい|許可|最大.{1,5}まで|だけ使う)' \
     packages/scenario-engine/src/compileStaffingReferenceScenario.ts
   ```
   ヒットしたフレーズが ban 側にも出ているなら統合する。

## Manual Orb v13 lesson: omit-vs-clear in vendor PATCH semantics (2026-04-27)

ElevenLabs API は **PATCH semantics**: payload で省略したフィールドは「dashboard の既存値を保持」する。リポジトリ側で payload からフィールドを削除しても、dashboard 側の旧設定は残り続ける。

### 実例 (v13 で発覚)

- v7 で `softTimeout` を Adecco の `buildLiveTurnConfig` payload から削除済み
- `packages/vendors/src/elevenlabs.ts:470` の rendering layer は `payload.turn.softTimeout` が undefined のとき `soft_timeout_config` フィールドを **payload から完全に省略** していた
- 結果: ElevenLabs dashboard 側の `「承知しました。少し整理しますね。」` (旧 v7 以前に設定) が残り続け、live agent が毎ターン本文の前に発話していた
- v11 で prompt 側の filler ban を 3 段階で潰したが効果なし。v12 で structural prompt-leak を潰しても効果なし
- v13 で **dashboard screenshot を見て初めて発見** (ユーザーが「拡張設定でこれがあるので、プロンプトではないのでは？」と指摘)

### v13 で確立したルール

1. **クリアしたいフィールドは `null` を明示送信する** (省略しない)。`packages/vendors/src/elevenlabs.ts:470` の `soft_timeout_config` は v13 以降、`softTimeout` 未指定なら `null` を送る契約。
2. Pre-commit checklist (vendor field を repo から削除する PR の場合):
   - 削除した field が PATCH payload で `null` 明示送信されることを `packages/vendors/src/elevenlabs.test.ts` の unit test で assert
   - PR description に「PATCH semantics により、本変更は次の publish で dashboard 側設定をクリアする」と明記
   - publish 後に dashboard を確認 (人手 or API で) し、該当フィールドが空 / 初期値であることを verify
3. 同様の構造的問題は `silenceEndCallTimeoutSeconds` `turnEagerness` `spellingPatience` `speculativeTurn` `retranscribeOnTurnTimeout` `mode` などの conditional field 全般に潜む。これらも v13 と同じ「omit vs null-clear」の判断が必要 (v13 では `softTimeout` だけ修正、他は orb 観測なしのため defer)。
4. **教訓**: prompt 修正で直らない live agent 挙動を見たら、**dashboard を直接確認** する習慣を付ける。prompt 以外の経路 (vendor-side filler / firstMessage / softTimeout / ASR 設定 / voice profile) を疑う。

## Manual Orb v13 lesson: 質問意図見出しに semantic anchor を残す (2026-04-27)

v12 で defense-in-depth として `## 質問意図 N` 連番化を実施 (英語 triggerIntent ID を rendered prompt から完全除去)。v13 orb で副作用として **1 ターン off-by-one mis-classification** を観測:
- ユーザー「概要を教えてください」 → AI が team_atmosphere の答え
- ユーザー「平均年齢は？」 → AI が competition の答え
- ユーザー「他社相談は？」 → AI が start_date_only の答え
- ユーザー「開始時期は？」 → AI が coaching_request の答え

### 根本原因 (推定)

連番だけでは LLM の intent matching が弱くなる。`overview_shallow` (#2) と `team_atmosphere_question` (#18) はそれぞれ ASR triggers に `「概要」「何名」` などが overlap し、見出しが `## 質問意図 N` だけだと **fence-post off-by-one** を起こしやすい。

ただし完全な根因とは断定できない: ASR / turn-segmentation / orb 表示順序などの影響も残る可能性。

### v13 で確立したルール

1. **連番見出しに日本語 semantic label を併記** (英語 ID は依然出さない):
   ```
   ## 質問意図 18: 部署環境 (人数・男女比・年齢層・服装)
   ```
2. label map は ledger 同ファイル内の `JAPANESE_INTENT_LABELS` で集中管理。trigger 追加時に label 追加を忘れないよう test で `STAFFING_ADECCO_DISCLOSURE_LEDGER.length === blockCount` を assert。
3. semantic label を入れても off-by-one が直らない場合は **ASR / turn-segmentation 側を疑う** (out of scope for v13)。具体的には orb の transcript boundary、turn_timeout、retranscribe_on_turn_timeout などの設定を見直す。
