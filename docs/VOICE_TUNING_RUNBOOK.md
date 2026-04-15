# Voice Tuning Runbook

この runbook は、`busy_manager_medium` の ElevenLabs 日本語音声を継続改善するための運用手順です。

## 目的

- voice の候補比較を再現可能にする
- 一度に変える変数を 1 つに保つ
- 人手レビューを適切なタイミングに固定する
- publish 後の結果を次回の改善に戻す

## 主な資産

- benchmark utterance: `data/voice-benchmark/utterances_ja.csv`
- accounting benchmark utterance: `data/voice-benchmark/utterances_ja_accounting_clerk.csv`
- reviewer rubric: `data/voice-benchmark/reviewer-rubric.md`
- pronunciation dictionary: `data/pronunciation/adecco-ja-business-v1.pls`
- accounting pronunciation dictionary: `data/pronunciation/adecco-ja-accounting-v1.pls`
- voice profile schema: `docs/VOICE_PROFILE_SCHEMA.md`
- recommendation pack: `docs/VOICE_RECOMMENDATION_BUSY_MANAGER_JA.md`

## Hybrid Review Flow

### Checkpoint 1: voice 候補棚卸し

- `voices:list` で workspace 利用可能な voice を集める
- 5 から 8 件に候補を絞る
- この時点では settings を大きく動かさず、voice の違いを見やすくする

### Checkpoint 2: offline 一括試聴

- `benchmark:render` で同一 utterance を候補ごとに一括生成する
- `index.html` か同等の generated artifact でまとめて試聴する
- `reviewer-rubric.md` に沿って 1 回で比較し、shortlist を決める

### Checkpoint 3: publish 後の実機確認

- shortlist から 1 件に絞って `busy_manager_medium` に publish する
- 既存 agent tests を通したあと、opening line と 2 から 3 ターンだけ実機で確認する
- v3 系は context-aware なので、最終判断はこの確認結果を優先する

## 変数の変え方

- まず voice を決める
- 次に settings を詰める
- 最後に prompt を微修正する
- 1 回の比較で voice と settings と prompt を同時に変えない

## Accounting v3 Activation

`accounting_clerk_enterprise_ap_busy_manager_medium` は live/publish inactive のまま管理します。active 化の条件は以下です。

1. `pnpm voices:dictionary:upload -- --file data/pronunciation/adecco-ja-accounting-v1.pls --name adecco-ja-accounting-v1` で remote dictionary を作成または再利用する
2. real `pronunciationDictionaryId` と `versionId` を `config/voice-profiles/accounting_clerk_enterprise_ap_ja_v3_candidate_v1.json` に反映する
3. preview / benchmark で誤読改善を確認する
4. target workspace で `eleven_v3` live publish が `expressive_tts_not_allowed` にならないことを確認する
5. live では dictionary-first lane と `accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1` を 2 から 3 ターン比較する
6. 確認後に `metadata.benchmarkStatus` を見直し、`config/voice-profiles/scenario-map.json` の `activeProfiles` に昇格する

注意:

- local `.pls` が repo の正本
- fake locator は入れない
- locator 未確定の間は `previewProfiles` / `benchmarkProfiles` のみで使う
- live path は dictionary first。assistant 本文の rewrite や prompt hack をデフォルトにしない
- `system_prompt` profile は比較レーン専用。`pnpm publish:scenario -- --scenario accounting_clerk_enterprise_ap_busy_manager_medium --profile accounting_clerk_enterprise_ap_ja_v3_system_prompt_candidate_v1` の explicit override でだけ publish する
- `system_prompt` lane では local PLS から使われている lexeme だけを抽出し、system prompt 末尾へ pronunciation guide を追加する

未解決事項:

- `eleven_v3` live publish entitlement の解放
- dictionary-first lane と `system_prompt` comparison lane の live 比較完了

## 推奨比較順

1. `eleven_flash_v2_5`
2. `eleven_multilingual_v2`
3. `eleven_v3`

非 v3 はまず以下を触る。

- `stability`: `0.55`, `0.70`, `0.80`
- `similarityBoost`: `0.70`, `0.82`, `0.90`
- `speed`: `0.92`, `0.97`, `1.02`
- `style`: `0`
- `useSpeakerBoost`: `true` / `false`

## 失敗時の扱い

- voice id が見つからない場合は fallback で握りつぶさない
- dictionary locator の欠落は明示的に失敗とする
- benchmark の 1 utterance が失敗しても全体は止めず、最後に失敗数を集計する

## レビュー記録

- 各 run の出力先と runId を残す
- コメントは utterance id 単位で残す
- 最終候補は `docs/VOICE_RECOMMENDATION_BUSY_MANAGER_JA.md` に反映する
