# Adecco Manufacturer Order Hearing Memo

## Purpose

Adecco 営業向けに、住宅設備メーカーの人事課主任を相手にした初回派遣オーダーヒアリングを練習するための reference-based staffing scenario です。

Runtime SoT は [adecco_manufacturer_order_hearing_reference.json](/C:/AI_RPG/docs/references/adecco_manufacturer_order_hearing_reference.json) です。Excel 2本は設計根拠であり、runtime storage SoT ではありません。

## Source Inputs

- `C:\Users\yukih\Downloads\adecco_manufacturer_order_hearing_reference.json`
- `C:\Users\yukih\Downloads\adecco_manufacturer_scenario_design.xlsx`
- `C:\Users\yukih\Downloads\adecco_manufacturer_hearing_level_matrix.xlsx`
- `C:\Users\yukih\Downloads\codex_implementation_instruction_adecco_orb.md`

## Scenario Snapshot

- Scenario ID: `staffing_order_hearing_adecco_manufacturer_busy_manager_medium`
- Family: `staffing_order_hearing`
- Title: `住宅設備メーカー 人事課主任 初回派遣オーダーヒアリング`
- Client role: 中堅住宅設備メーカーの人事課主任
- Difficulty: medium
- Voice path: staffing legacy fallback, `dictionaryRequired=false`
- First message: reference artifact `phase4.scenarioPack.openingLine`
- Voice normalization: answers spell out amounts, times, ranges, counts, and abbreviations in spoken Japanese for ElevenLabs Orb.

## Design Notes

- AI client is neutral and evaluates whether Adecco can receive the first order.
- The contact has order and vendor-selection authority, but is an HR window and may need to confirm detailed field requirements with the workplace.
- Shallow questions receive shallow answers. Deep, well-structured questions reveal hidden facts in stages.
- Hidden facts include current-vendor dissatisfaction, task decomposition, volume and peak cycle, price flexibility, competition, decision process, and the closing Adecco differentiation question.
- Enterprise ERP/AP scenario の共通ヒアリング設計を住宅設備メーカー向けに移植し、職種名で止めずに、入力作業と納期調整・在庫不足・品番不一致などの例外対応の線引き、社員側に残す最終判断を確認する設計にしています。
- Amount and range answers must avoid raw symbols. For example, say `時給は千五百円からです`, `千七百五十円から千九百円`, `八時四十五分から十七時三十分`, and `月十から十五時間`.
- Near the end, the client asks: `Adecco の派遣の特徴や強みは？ 他社と何が違うの？`

## Compile And Publish

```bash
pnpm compile:scenarios -- --family staffing_order_hearing --reference ./docs/references/adecco_manufacturer_order_hearing_reference.json
pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium
```

After publish, inspect `data/generated/publish/staffing_order_hearing_adecco_manufacturer_busy_manager_medium.json` for:

- `scenarioId`
- `elevenAgentId`
- `voiceId`
- `ttsModel`
- `testRunId`

## Orb Preview Verification (2026-04-19)

- Agent: `agent_2801kpj49tj1f43sr840cvy17zcc`
- Voice: `g6xIsTj2HwM6VR4iXFCw` (Jessica Anne Bogart - Chatty and Friendly)
- Preview URL: `https://elevenlabs.io/app/talk-to?agent_id=agent_2801kpj49tj1f43sr840cvy17zcc`
- Status: blocked. Codex can publish and verify ConvAI tests from this environment, but cannot perform the required human orb preview conversation or capture real spoken utterances. Do not treat the lines below as completed DoD evidence until a human operator fills them from an actual orb session.

### DoD 4 - opening

- AI first message: `<blocked: human orb utterance not captured>`

### DoD 5a - shallow stays shallow

- 質問: 「今回の募集について概要を教えてください」
- AI 応答: `<blocked: human orb utterance not captured>`

### DoD 5b - staged hidden fact reveal

- 深掘り順とAI開示順:
  - `<blocked: human orb utterances not captured>`

### DoD 6 - Adecco strength reverse question

- AI 終盤逆質問: `<blocked: human orb utterance not captured>`

### DoD 7 - speech normalization

- 金額・時刻・範囲表現: `<blocked: human orb utterance not captured>`
