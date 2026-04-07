# ElevenLabs 日本語 Voice Selection Runbook

この runbook は、`busy_manager_ja_voice15` の 15 バリエーションを比較し、`busy_manager_medium` に採用する voice を決めるための手順です。

より再利用しやすい repo-local 版は [docs/skills/elevenlabs_voice_selection.md](./skills/elevenlabs_voice_selection.md) にあります。

## 目的

- 15 候補を同じ条件で比較する
- voice, model, live の順で変数を分ける
- reviewer が一括で聴き比べやすい形を維持する
- rescue slots は shared fallback のままでは最終確定しないことを明示する

## 現在の候補

- control profiles:
  - `busy_manager_ja_baseline_v1`
  - `busy_manager_ja_multilingual_candidate_v1`
  - `busy_manager_ja_v3_candidate_v1`
- round1 candidates:
  - `F01` から `F06`
  - `M01` から `M06`
  - `R01` から `R03`

## 基本ルール

- Round 1 は `eleven_multilingual_v2` 固定で聴く
- 1 回の比較では voice 以外の差分を増やしすぎない
- `R01` から `R03` は現時点では shared fallback の救済枠であり、explicit Voice Design 実行後に差し替える
- 最終判断は manual review を優先する

## コマンド

### 1. 候補棚卸し

```bash
pnpm voices:collect:ja
pnpm voices:list
```

### 2. Round 1 の一括比較

```bash
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-sanity
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round1-full
pnpm benchmark:render:ja -- --scenario staffing_order_hearing_busy_manager_medium --round round2-v3 --include-profile busy_manager_ja_v3_candidate_v1
```

`round1-full` は `config/voice-profiles/ja_voice_variations/cohort.json` で shortlist 候補に `finalist: true` を付けてから実行する。

### 3. Rescue slot の explicit Voice Design

```bash
pnpm voices:design:ja
```

### 4. shortlist の記録

```bash
pnpm review:summarize:ja -- --csv data/generated/voice-benchmark/<runId>/review-sheet.csv
```

## Review Flow

### Checkpoint 1: voice 候補棚卸し

- shared/workspace から候補を整理する
- 15 候補以外の voice は control として扱う
- rescue slots はまだ shared fallback なので、ここでは採用確定にしない

### Checkpoint 2: offline 一括試聴

- benchmark 実行で出る `data/generated/voice-benchmark/<runId>/review-sheet.csv` を使って一括で記録する
- `utterances_ja_busy_manager_sanity.csv` で first pass を行う
- `cohort.json` で Top 6 に `finalist: true` を付けたあと、`utterances_ja_busy_manager.csv` で full pass を行う

### Checkpoint 3: publish 後の実機確認

- shortlist から 2 から 3 件に絞る
- publish 後に opening line と短い 2 から 3 ターンを確認する
- rescue slots は explicit Voice Design が済むまで最終比較対象に固定しない

## 評価観点

- 自然さ
- 滑らかさ
- 訛り感の少なさ
- 信頼感
- 読みの正確さ
- 電話口での聞きやすさ
- `busy_manager_medium` との適合度

## 参照先

- reusable workflow: `docs/skills/elevenlabs_voice_selection.md`
- cohort 定義: `config/voice-profiles/ja_voice_variations/cohort.json`
- profile 群: `config/voice-profiles/ja_voice_variations/`
- benchmark utterances: `data/voice-benchmark/utterances_ja_busy_manager_sanity.csv`
- full utterances: `data/voice-benchmark/utterances_ja_busy_manager.csv`
- final shortlist audit: `data/voice-benchmark/review-sheet-ja-voice15.csv`
- audit note: `data/voice-benchmark/review-audit-ja-voice15.md`
- benchmark review output: `data/generated/voice-benchmark/<runId>/review-sheet.csv`
- pronunciation dictionary: `data/pronunciation/adecco-ja-business-v1.pls`
