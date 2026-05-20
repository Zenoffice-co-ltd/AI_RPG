# Adecco AIロープレ ブラウザ評価 進捗メモ 2026-05-20

## 目的

アデコの住宅設備メーカー向けAIロープレについて、ロープレ終了後に実行者がブラウザ上で採点結果を確認できる状態を目指した。

本日は、まず「採点精度を完全に固める」よりも先に、評価結果画面のモック更新と、ロープレ終了後に評価画面へ遷移する実装の接続確認を優先した。

## 参照した情報

- 顧客から提示された100点満点の採点要望
  - ヒアリング項目の網羅性 30点
  - ヒアリングスキル 20点
  - 優先順位の明確化 20点
  - 商談の全体構成力 10点
  - 商談時の振る舞い 10点
  - クロージング 10点
- 顧客要望に含まれる必須ヒアリング項目
  - 募集背景、業務内容、就業条件、人選要件、職場環境、職場の雰囲気、その他、クロージング
- Excel `アデコ_住宅設備メーカー人事課主任_分析・シナリオ設計.xlsx`
  - シート3 `03_ヒアリング設計`
  - シート5 `05_採点_QA`
- 前任者作成のブラウザ評価モック

## 本日実施したこと

### 1. 既存モックの見直し

前任者のモックをそのまま残したうえで、顧客要望とExcelの設計に合わせて、実行者がロープレ後に見る評価結果画面の方向性を整理した。

主な見直し内容:

- 6大カテゴリを、顧客要望の100点配点に合わせて整理
- `Rubric Breakdown` という英語見出しを、実行者向けに `6大カテゴリ` へ寄せる方針に変更
- 上部サマリーは4項目から3項目へ整理
  - `ヒアリング達成度`
  - `完全取得 / 部分取得 / 未取得`
  - `最優先改善領域`
- `評価基準`、`生成時刻`、`session` など、実行者にとって不要な内部情報は非表示にする方針に変更
- `商談時の振る舞い` は、現時点では会話ログのみをもとに採点している旨を、控えめに表示する方針に整理

### 2. 採点ロジックの考え方を整理

いきなりAIに6大カテゴリへ直接点数を付けさせるのではなく、先に小カテゴリや必須ヒアリング項目を判定し、その結果を大カテゴリへ集計する設計にした。

これにより、毎回の採点で点数が大きくぶれにくくなることを狙っている。

例:

- `ヒアリング項目の網羅性 30点`
  - Excelシート5 `05_採点_QA` の必須ヒアリング項目をもとに、12項目へ整理
  - 各項目を `完全取得 / 部分取得 / 未取得` で判定
  - 重みに応じて集計し、最終的に30点満点へ換算
- `ヒアリングスキル 20点`
  - 質問の明確さ、オープン質問とクローズ質問の使い分け、第三者話法、深掘り、要約などを小カテゴリとして評価
- `優先順位の明確化 20点`
  - must / want、緩和可能条件、経験・スキル・開始日・人柄などの優先順位を聞けているかを評価
- `商談の全体構成力 10点`
  - 導入から終話まで、会話の流れが自然かを評価
- `商談時の振る舞い 10点`
  - 現時点では会話ログのみをもとに、簡潔さ、応答、傾聴姿勢が会話上伝わるかを評価
- `クロージング 10点`
  - 連絡方法、候補者提示日、職場見学、決定プロセス、次行動の期日合意を評価

### 3. 実行者向けモックを更新

実行者がロープレ終了後に見る画面として、採点結果を整理して確認できるモックを更新した。

公開モック:

- [ブラウザ評価モック v2](https://zenoffice-co-ltd.github.io/AI_RPG/)

あわせて、実際のトランスクリプトをもとにしたE2E出力も作成した。

- [トランスクリプトE2E一覧](https://zenoffice-co-ltd.github.io/AI_RPG/e2e-transcripts/)
- [トランスクリプト001の評価出力](https://zenoffice-co-ltd.github.io/AI_RPG/transcript-001/)
- [E2E transcript: tr_270c090c33b1](https://zenoffice-co-ltd.github.io/AI_RPG/e2e-transcripts/tr_270c090c33b1/)
- [E2E transcript: tr_3c746a6726da](https://zenoffice-co-ltd.github.io/AI_RPG/e2e-transcripts/tr_3c746a6726da/)
- [E2E transcript: tr_49aeb44681a9](https://zenoffice-co-ltd.github.io/AI_RPG/e2e-transcripts/tr_49aeb44681a9/)

### 4. トランスクリプト評価の過大評価を調整

トランスクリプトが明らかに短い場合でも高得点になってしまう傾向があったため、判定を厳しめに見直した。

見直し方針:

- 会話ログに明示されていない内容は取得扱いにしない
- `完全取得` と `部分取得` を分ける
- 短い会話や曖昧な確認は、過大評価しない
- 必須ヒアリング項目ごとの判定を先に行い、点数へ換算する

ただし、採点精度はまだ最終確定ではない。今後、複数トランスクリプトで結果を見ながら、判定基準とプロンプトをさらに調整する必要がある。

### 5. ロープレ終了後に評価画面へ遷移する実装を追加

v50-7-4系のロープレで、セッション終了後にブラウザ評価を開始し、結果ページへ遷移できるように実装した。

対象ルート:

- `/demo/adecco-roleplay-v50-7-4`
- `/demo/adecco-roleplay-v50-7-4-a`
- `/demo/adecco-roleplay-v50-7-4-b`
- `/demo/adecco-roleplay-v50-7-4-c`
- `/demo/adecco-roleplay-v50-7-4-d`

主な変更:

- v50-7-4系のセッションに `browserEvaluation` 設定を追加
- 各ルートに `/result/[sessionId]` の評価結果ページを追加
- 既存のv50-7評価APIを使って、結果画面表示へつなげる構成にした
- 結果APIでは、raw Claude output、API secret、relay ticket、hidden system prompt などを画面に出さない方針を維持

マージ済みPR:

- [PR #290: Enable browser evaluation result flow for v50-7-4](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/290)

検証済み:

- 対象ユニットテスト 45件 PASS
- Webアプリ単体の型チェック PASS
- ローカルのmock結果画面で、3つの上部指標、6大カテゴリ、旧メタ情報の非表示、raw情報の非露出を確認

## 現在詰まっていること

### 本番URLでは評価結果ページがまだ404

本番ロープレURL:

- [https://roleplay.mendan.biz/demo/adecco-roleplay-v50-7-4](https://roleplay.mendan.biz/demo/adecco-roleplay-v50-7-4)

本番で確認した結果、ロープレ画面自体は表示されるが、評価結果ページはまだ404だった。

確認したURL:

- `https://roleplay.mendan.biz/demo/adecco-roleplay-v50-7-4/result/mock-session?mock=1`

確認結果:

- 2026-05-20時点で `404`

### 自動ロールアウトだけでは反映されなかった

PR #290 は main にマージ済みで、GitHub Actions の post-merge workflow も成功した。

しかし、結果ページの本番URLは404のままだったため、App Hosting側で今回のNext.js routeがまだ配信されていない可能性が高い。

### 手動デプロイは途中で停止

手動デプロイを開始したが、ユーザー判断で一旦停止した。

実施済み:

- `origin/main` の commit `a12023d` をデプロイ対象にした
- App Hosting用のソースアーカイブを作成
- ソースアーカイブをGCSへアップロード
- App Hosting build / rollout の作成を開始

確認できた情報:

- baseline rollout: `build-2026-05-20-008`
- manual deploy build: `build-2026-05-20-009`

停止したため、`build-2026-05-20-009` が最終的に `SUCCEEDED` まで進んだかは未確認。

次に再開する場合は、まず App Hosting の rollout 状態を確認し、必要なら `origin/main` から再度手動デプロイする。

## 未完了・今後やること

1. 本番 App Hosting の rollout 状態を確認する
2. `v50-7-4/result/mock-session?mock=1` が本番で200になるか確認する
3. ロープレを実際に実施し、終了後に評価画面へ遷移するか確認する
4. 本番で実際のトランスクリプトから評価が生成されるか確認する
5. 採点ロジックの厳密化を継続する
   - 必須ヒアリング12項目の判定基準をさらに固定する
   - 小カテゴリごとの採点基準を明文化する
   - 短い・曖昧な会話を過大評価しないようにする
6. 必要に応じて評価プロンプトをv50-7-4専用に分離する

## 関連PR・コミット

### 本日メインでマージしたPR

- [PR #290: Enable browser evaluation result flow for v50-7-4](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/290)

### 既存の関連PR

- [PR #111: v50-7: show Adecco evaluation report in browser after roleplay end](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/111)
- [PR #137: feat(v51): add Adecco customer criteria evaluation profile](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/137)
- [PR #236: Require sales transcript before browser evaluation scoring](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/236)

### 静的モック・E2E出力に関するコミット

- `3eb9b37` docs: add adecco browser evaluation result mock
- `838a034` docs: publish adecco browser evaluation mock preview
- `70a50cb` docs: add transcript-based adecco evaluation mock
- `735181a` docs: publish transcript evaluation mock
- `ee895a8` docs: add three transcript browser evaluation e2e outputs
- `938b52c` docs: publish three transcript e2e outputs
- `a883e54` docs: tighten transcript evaluation e2e scoring
- `9bf8b42` docs: publish tightened transcript e2e scoring

## 上司向けの報告文

本日は、アデコAIロープレのブラウザ評価について、まず採点結果画面のモックを顧客要望に合わせて整理しました。

顧客要望の100点配点をもとに、6大カテゴリと必須ヒアリング項目の構造を整理し、実行者がロープレ後に見やすいよう、上部サマリー、6大カテゴリ、必須ヒアリング項目、次回改善ポイントが確認できる画面に更新しています。

また、トランスクリプトを使ったE2E出力も作成し、短い会話が過大評価されないよう、`完全取得 / 部分取得 / 未取得` の判定を厳しめに見直しました。

実装面では、v50-7-4系のロープレ終了後にブラウザ評価結果画面へ遷移するためのコードを追加し、PR #290 として main にマージ済みです。

一方で、本番環境では評価結果ページがまだ404になっており、App Hosting側への反映が未完了です。自動ロールアウトは成功していますが、結果ページが表示されないため、次回はApp Hostingのrollout状態確認と、必要に応じた手動デプロイの完了確認から進めます。

確認用リンク:

- モック: https://zenoffice-co-ltd.github.io/AI_RPG/
- トランスクリプトE2E一覧: https://zenoffice-co-ltd.github.io/AI_RPG/e2e-transcripts/
- 実装PR: https://github.com/Zenoffice-co-ltd/AI_RPG/pull/290
- 本番ロープレURL: https://roleplay.mendan.biz/demo/adecco-roleplay-v50-7-4

