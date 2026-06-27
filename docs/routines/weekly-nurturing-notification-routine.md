# 週次ナーチャリング商談通知ルーチン — 制約分析と修正仕様

- 対象ルーチン: 「毎週月曜：今週のナーチャリング商談通知」(Claude スケジュール・ルーチン)
- 通知先: Slack `C0AC7131KDE`
- 分析日: 2026-06-26 (JST)
- 前回ラン: 2026-06-22 (月)
- 対象オブジェクト: Day.ai `native_opportunity`

> このドキュメントは、前回ランで発生した「制約（= Day.ai 値読み取り制限）」の**根本原因**を切り分け、
> **もともとの指示通りに正しく抽出・通知できる実行方式**を定義し、ルーチン・プロンプトの差し替え版を提供する。

---

## 0. TL;DR

前回ランは「Day.ai のカスタムプロパティが読めない」とだけ報告したが、実際には **2 つの独立した制約**が存在する。

1. **制約A — 値読み取り不可**: `search_objects` は `propertiesToReturn` を無視し、各オブジェクト型の `title` / `description` サマリだけを返す。`export_to_sandbox` は本環境（headless/cron）で Anthropic Files API 認証に失敗し使用不可。→ 根拠種別ラベル・判定理由本文・担当メール・各種日付の **値そのもの**は読めない。
2. **制約B — 複合カスタムプロパティ AND フィルタのバグ（偽陰性）**: 「日付プロパティ + もう 1 つのカスタムプロパティ条件」までは正しく動くが、**日付以外の異なるカスタムプロパティを 2 つ以上 AND に入れた瞬間に誤って 0 件を返す**。つまり仕様の抽出述語（`次回ナーチャリング日_最終 ∈ 今週 AND 根拠種別_最終 ≠ null AND 判定理由_最終 ≠ null`）を **1 クエリでそのまま書くと、有効な対象を全件取りこぼす**。

**回避策（=制約のクリア方法）**: 値を読まずに**フィルタの集合演算だけで分類する**。`日付レンジ + source_type を eq で 1 つずつ` という安全パターンで 8 バケットに振り分ければ、`根拠種別 ≠ null` も自動的に保証され、通知優先度の分類も同時に得られる。`判定理由 ≠ null` は別クエリで取り objectId で論理積する。担当は `assignee` リレーション + 日付で取得できる（制約Bの対象外）。

**今週の正しい結果**: 真の主対象は **3 件**（エフェクチュアル様 / クラス-トライアル終了 / ベストマッチキャリア様）。3 件とも `根拠種別_最終 = stage_rule`、`判定理由_最終` は設定済み、ステージは 9.本契約 ではない。担当はエフェクチュアル=岩瀬、クラス/ベストマッチ=宮本。closed_won=0、fallback=0。
※ 前回ランの「3 件」という**選定自体は（日付単独フィルタで）偶然正しかった**が、source_type・担当・過去背景を実データで出せず、期限超過件数（67 / 112）は本契約・終了案件を含む**過大計上**だった。

---

## 1. 前回ラン（2026-06-22）で何が起きたか

| 項目 | 前回ランの挙動 | 問題 |
|---|---|---|
| 抽出 | `次回ナーチャリング日_最終` の**日付のみ**でフィルタ → 3 件 | 仕様の `根拠種別≠null AND 判定理由≠null` を未適用。たまたま正しい集合だったが、保証はない |
| source_type | 「Day.aiで確認要」プレースホルダ | 値が読めず分類不能 |
| 担当 | 「Day.aiで確認」 | 値が読めず未表示 |
| 過去背景 | title + 組織サマリのみ | 判定理由・根拠抜粋の本文が読めず内容が薄い |
| 期限超過 1–30 | 67 件 | `本契約` `商談終了` `終了` を含む（source_type/stage 未除外）→ 過大 |
| 期限超過 31+ | 約 112 件 | 同上。ほぼ全 DB に近い数 |

前回ランは「読めない」を制約として報告したが、**もし仕様の複合述語を素直に 1 クエリで実装していたら 0 件となり「今週対象 0 件」と誤報**していた（制約B）。つまり放置すると偽陰性のリスクがある。

---

## 2. 根本原因分析

### 2.1 制約A — カスタムプロパティ値が読めない

- `search_objects` は `propertiesToReturn`（配列でも `"*"` でも）を**実質無視**し、`objectId` / `title` / `description` / `createdAt` / `updatedAt` の固定サマリのみ返す。
  - 検証: 3 件を `objectIds` + `propertiesToReturn:"*"` で取得 → サマリのみ。`ownerEmail` / `stageId`（必ず値がある標準プロパティ）すら返らない。
  - 各オブジェクト型のサマリ投影は型ごとに異なる: `native_user` は `title`=メール, `description`=ACTIVE。`native_organization` は `title`=社名, `description`=AI 要約。`native_opportunity` は `title`=商談名, `description`=domain。**この投影に載る値だけが読める。**
- `export_to_sandbox`（本来の値取得経路）は本環境で `Failed to upload CSV to Anthropic Files API: Could not resolve authentication method` で失敗。これは Day.ai サーバ → Anthropic Files API のサーバ側認証問題で、**ローカルからは修正不可**・headless/cron では恒久的とみなす。
- 補足: `通知ステータス`(`baeee2e7`) を含む export は `attribute ... not found in schema` で失敗。値が一度も書かれていないカスタムプロパティは Turbopuffer に属性が存在せず、`include_attributes` に載らない。

**帰結**: 判定理由本文・根拠抜粋本文・source_type ラベル・担当メール・最終連絡日などの**値は読めない**。→ フィルタの集合演算で「分類」を復元するしかない。

### 2.2 制約B — 複合カスタムプロパティ AND フィルタのバグ（偽陰性）

`where` フィルタはカスタムプロパティでも効く（値は読めないが「絞り込み」はできる）。ただし **AND の中に日付以外の異なるカスタムプロパティ条件を 2 つ以上入れると、誤って 0 件を返す**。

- 動く（正しい結果）:
  - `日付レンジ(6f7779ad) + 根拠種別(c94) eq <option>` → 3 件 ✓
  - `日付レンジ(6f7779ad) + 根拠種別(c94) isNotNull` → 3 件 ✓
  - `日付レンジ(6f7779ad) + 判定理由(a2e) isNotNull` → 3 件 ✓
  - `日付レンジ(6f7779ad) + assignee eq <user>` → 正しい部分集合 ✓（assignee はリレーションでバグ対象外）
- 壊れる（誤って 0 件）:
  - `根拠種別(c94) + 判定理由(a2e)`（日付なし、非日付カスタム 2 つ）→ **0** ✗
  - `日付 + 根拠種別(c94) + 判定理由(a2e)`（カスタム 3 種）→ **0** ✗

`根拠種別 isNotNull` 単独 ≈ 全件、`判定理由 isNotNull` 単独 = 210 件、今週 3 件は両方 not null（個別クエリで各 3 件）であるにもかかわらず、両者を AND にすると 0 になる。**論理的に不可能 = エンジンのバグ。** 正確な内部原因（Turbopuffer の複数カスタム属性の連言評価）は不明だが、**観測される再現ルールは明確**:

> **1 クエリの AND には「日付プロパティ + もう 1 つのカスタムプロパティ条件」までしか入れてはならない。日付以外の異なるカスタムプロパティ条件を 2 つ以上 AND にしない。**

### 2.3 実証エビデンス（クエリ → 結果マトリクス）

期間条件はすべて `次回ナーチャリング日_最終 (6f7779ad)` を `gte 2026-06-22 / lte 2026-06-28`（=今週）。

| # | フィルタ（AND） | 非日付カスタムprop数 | 結果 | 判定 |
|---|---|---|---|---|
| V1 | 日付 + `根拠種別 isNotNull` | 1 | **3** | 動作 |
| V2 | 日付 + `判定理由 isNotNull` | 1 | **3** | 動作 |
| V3 | 日付 + `判定理由 isNull` | 1 | **0** | 動作（補集合一致）|
| B5 | 日付 + `根拠種別 eq stage_rule` | 1 | **3** | 動作 |
| B1–B4,B6–B8 | 日付 + `根拠種別 eq <他7種>` | 1 | **0** | 動作（該当なし）|
| M1 | 日付 + `根拠種別 isNotNull` + `判定理由 isNotNull` | 2 | **0** | **バグ** |
| M2 | 日付 + `根拠種別 eq stage_rule` + `判定理由 isNotNull` | 2 | **0** | **バグ** |
| M3 | `根拠種別 eq stage_rule` + `判定理由 isNotNull`（日付なし）| 2 | **0** | **バグ** |
| M4 | 日付gte + `根拠種別 isNotNull` + `判定理由 isNotNull` | 2 | **0** | **バグ** |
| M5 | `根拠種別 isNotNull` + `判定理由 isNotNull`（日付なし）| 2 | **0** | **バグ** |

`V1=3, V2=3` かつ `M1/M5=0` が共存 → 連言バグの確定的証拠。

担当（assignee + 日付）の実証:
- 宮本(`02e22bf3…`) → クラス, ベストマッチ（2 件）
- 岩瀬(`2e0c1615…`) → エフェクチュアル（1 件）
- 鈴木/松井/持永/山下 → 0 件

---

## 3. 制約をクリアする実行方式（フィルタオンリー・アーキテクチャ）

定数:
- `PROP_DATE = 6f7779ad-2aec-45de-9124-f4555480d2da`（次回ナーチャリング日_最終）
- `PROP_TYPE = c94bdef8-43fa-4ddd-9ba1-87f5fcbfcf7c`（根拠種別_最終, picklist）
- `PROP_REASON = a2e29ef6-257a-4996-812d-beb7b6ad629b`（判定理由_最終, textarea）
- `PROP_STATUS = baeee2e7-1b01-42c4-8065-007921147115`（通知ステータス）
- `STAGE_本契約 = 92de9362-3e40-41d6-9e4f-1eca43797d61`

各「期間窓」（今週 / 超過1-30 / 超過31+）について:

1. **バケット分類**: 8 つの source_type option それぞれで
   `AND[ PROP_DATE gte WS, PROP_DATE lte WE, PROP_TYPE eq <optionId> ]` を実行。
   → これは「日付 + カスタム 1 つ」= **動く安全パターン**。`根拠種別 ≠ null` を自動保証し、通知優先度の分類も同時に得る。
2. **判定理由 not null 検証**: `AND[ PROP_DATE gte WS, PROP_DATE lte WE, PROP_REASON isNotNull ]` → 集合 R（objectId）。
   主対象 = (全 active バケットの和) ∩ R。R に無い objectId は「判定理由欠落＝データ整備対象」として主リストから外し、件数のみ計上。
   （仕様の `根拠種別≠null AND 判定理由≠null` を **2 つの単一クエリ + objectId 論理積**に分解 = 制約B回避）
3. **本契約除外**: `AND[ PROP_DATE gte WS, PROP_DATE lte WE, stageId contains STAGE_本契約 ]` → 集合 H。主対象から H を除外。
4. **担当付与**: 社内ユーザー uid ごとに `AND[ PROP_DATE gte WS, PROP_DATE lte WE, assignee eq uid ]` → owner_map。
5. **重複通知制御**: `AND[ PROP_DATE gte WS, PROP_DATE lte WE, PROP_STATUS eq 通知済み(986a3bca…) ]` → 既通知集合を末尾へ。
   （現状 `PROP_STATUS` は値未設定で 0 件＝全件未通知。本ルーチンはステータスを**更新しない**＝読み取りのみ）
6. **並び順**: source_type 優先度 `recording_explicit > email_explicit > note_explicit > active_followup_guard > stage_rule > closed_lost_rule > closed_won_rule > fallback_insufficient_data`。
   バケット内の「日付昇順」は値が読めないため、必要なら `PROP_DATE` を日単位の sub-range に分割して擬似ソート（件数が少なければ省略可）。
7. **枠分け**: `closed_won_rule` → 「更新/活用確認枠」、`fallback_insufficient_data` → 「データ整備枠（件数のみ・営業通知しない）」、それ以外 → 営業ナーチャリング本体。

> 実装上の注意:
> - 手順3（`日付 + stageId contains`）は「日付カスタム + 標準プロパティ stageId」の組合せで、連言バグの対象（非日付カスタム 2 つ）には当たらない安全形だが、未実測のため最初の本番実行で件数の妥当性を確認すること。
> - 手順5の `PROP_STATUS eq 通知済み` は、`通知ステータス` に一度も値が書かれていない間は Turbopuffer に属性が存在せず、クエリが 0 件またはスキーマ未存在エラーを返しうる。**いずれの場合も「既通知 0 件＝全件未通知」として扱う**（本ルーチンはステータスを書き込まないため、この状態が正常）。

**送信前の整合性自己チェック（必須）**
- `日付のみの件数`（参考クエリ）と `Σ active バケット + closed_won + fallback + reason欠落` が一致するか。乖離 → 未知 option か制約B の影響を疑い、送信前に調査。
- 期限超過は**必ず**バケット + 本契約除外を適用（前回の 67/112 は date-only による過大計上）。

**過去背景の作り方（値が読めない前提）**
- `title` + 組織 `description`（読める）+ source_type（バケット由来）+ stage（membership 由来）+ 担当 から構成。
- `判定理由_最終` / `根拠抜粋_最終` の本文は本環境では機械読取不可。verbatim が要る場合は「Day.ai の該当 Opp で確認」と明記し、**推測で創作しない**。
- 関連ミーティング/ページがあれば `get_meeting_recording_context` / `read_page` で補強。

---

## 4. 今週の正しい抽出結果（2026-06-22〜2026-06-28）

| # | 商談 | domain | source_type | 判定理由 not null | stage 9? | 担当 |
|---|---|---|---|---|---|---|
| 1 | エフェクチュアル様 | effectual.co.jp | stage_rule | ✓ | No | 岩瀬 |
| 2 | クラス - トライアル終了 | kras.co.jp | stage_rule | ✓ | No | 宮本 |
| 3 | 株式会社ベストマッチキャリア様 - AI面談支援ツール初回商談 | bestmatch.co.jp | stage_rule | ✓ | No | 宮本 |

- 今週 主対象: **3 件**（全て営業ナーチャリング本体、closed_won/fallback ではない）
- closed_won_rule: 0 / fallback_insufficient_data: 0 / 判定理由欠落: 0
- 3 件とも `stage_rule`（ステージ別ルール補完）由来 = 明示的な再接触シグナルではなく、ステージ滞留に基づく自動補完日。

---

## 5. 修正版ルーチン・プロンプト（差し替え用）

> ライブのルーチン・プロンプトは Claude のルーチン設定画面で差し替える（API からは編集不可）。以下を**そのまま貼り替え**れば、上記の制約A/Bを回避して実行できる。元プロンプトに「## 重要：Day.ai API 制約と回避策」「抽出はフィルタ集合演算」「整合性自己チェック」を追加し、絶対禁止事項は不変。

```text
あなたは MENDAN / ZenOffice の営業ナーチャリング運用担当です。
毎週月曜の朝、Day.ai の native_opportunity を読み取り、今週ナーチャリングすべき商談を抽出し、
Slack 営業共有チャンネル C0AC7131KDE へ「今週のナーチャリング商談一覧」と推奨アプローチを通知します。

## 重要：Day.ai API 制約と回避策（必読・違反すると誤報する）
1. search_objects は値を返さない。propertiesToReturn は無視され、objectId/title/description/timestamps のみ返る。
   → カスタムプロパティの「値」は読まない。すべて where フィルタの集合演算で分類する。
   → 会社概要は native_organization の description、ユーザー名は native_user の title から取得。
2. export_to_sandbox は本環境で認証失敗するため使用しない。
3. 複合フィルタ・バグ: 1 つの AND には「日付プロパティ(6f7779ad) + もう 1 つのカスタムプロパティ条件」までしか入れない。
   日付以外の異なるカスタムプロパティ条件を 2 つ以上 AND にすると 0 件（偽陰性）になる。
   → 仕様の「根拠種別≠null AND 判定理由≠null」を 1 クエリにしない。別々に取り objectId で論理積する。
   → assignee（担当）はリレーションなのでバグ対象外。日付と AND してよい。

## 今週の定義（JST 基準）
WS=当該週の月曜, WE=当該週の日曜。次回ナーチャリング日_最終(6f7779ad) が [WS, WE] のものを今週対象とする。

## 抽出アルゴリズム（フィルタ集合演算）
PROP_DATE=6f7779ad… / PROP_TYPE=c94bdef8… / PROP_REASON=a2e29ef6… / PROP_STATUS=baeee2e7… / STAGE_本契約=92de9362…
1. 8 つの source_type option ごとに AND[PROP_DATE gte WS, PROP_DATE lte WE, PROP_TYPE eq <option>] を実行しバケット化（根拠種別≠null を自動保証）。
2. AND[PROP_DATE gte WS, PROP_DATE lte WE, PROP_REASON isNotNull] → R。主対象=Σ(activeバケット)∩R。R外は「判定理由欠落=データ整備」件数のみ。
3. AND[PROP_DATE gte WS, PROP_DATE lte WE, stageId contains STAGE_本契約] → H。主対象から H を除外。
4. 社内ユーザーごとに AND[PROP_DATE gte WS, PROP_DATE lte WE, assignee eq uid] → 担当を付与。
5. AND[PROP_DATE gte WS, PROP_DATE lte WE, PROP_STATUS eq 通知済み(986a3bca…)] → 既通知は末尾へ（ステータスは更新しない）。
6. 並び順=source_type優先度(recording_explicit>email_explicit>note_explicit>active_followup_guard>stage_rule>closed_lost_rule>closed_won_rule>fallback_insufficient_data)。
7. closed_won_rule=更新/活用確認枠、fallback_insufficient_data=データ整備枠(件数のみ)、他=営業本体。
8. 期限超過(1-30 / 31+)も必ず同じバケット+本契約除外を適用する（日付だけで数えない）。

## 過去背景の作り方
title + 組織 description + source_type(バケット由来) + stage(membership由来) + 担当 から 2〜3 文で構成。
判定理由_最終 / 根拠抜粋_最終 の本文は読めないため、verbatim が要る場合は「Day.ai の該当 Opp で確認」と明記。推測で創作しない。

## 送信前 自己チェック
- 日付のみ件数 と Σ(activeバケット+closed_won+fallback+reason欠落) が一致するか。乖離なら調査してから送信。
- Day.ai 書き込み 0 / 通知ステータス更新 0 / 通知済み日時更新 0 / Scheduled Task 変更 0 を確認。
- 送信先 C0AC7131KDE が設定済み。今週 0 件でも 0 件と通知する。

## 絶対禁止（不変）
Day.ai の値書き換え・通知ステータス更新・通知済み日時更新・_最終系/候補値(5aeb14d1)/次回更新月(4cc7077b) の書き換え・
backfill_custom_property・batch_create_or_update_opportunities・Scheduled Task の登録/変更/削除・本番 Opp へのメモ追加を行わない。
許可される書き込みは Slack 通知送信のみ。

## Slack フォーマット / 件数が多い場合 / 期限超過・Closed Won・fallback の扱い / エラー時 / 完了報告
（元仕様のまま。期限超過1-30=注意枠を別セクション、31+=件数のみ管理者レビュー、closed_won=更新/活用確認枠、fallback=データ整備枠件数のみ。
 Day.ai 取得失敗時は Slack 送信せずエラー記録。Slack 送信失敗時はステータス更新せずエラー記録。）
```

---

## 6. リファレンス

### プロパティ ID
| 用途 | propertyId |
|---|---|
| 次回ナーチャリング日_最終 | `6f7779ad-2aec-45de-9124-f4555480d2da` |
| 次回ナーチャリング月_最終 | `5420d380-ba16-4e41-9f9a-049ed54bd465` |
| ナーチャリング判定理由_最終 | `a2e29ef6-257a-4996-812d-beb7b6ad629b` |
| ナーチャリング根拠種別_最終 | `c94bdef8-43fa-4ddd-9ba1-87f5fcbfcf7c` |
| ナーチャリング根拠抜粋_最終 | `4d52b7e1-e93e-4840-b334-f1568fc4c0a5` |
| ナーチャリング通知ステータス | `baeee2e7-1b01-42c4-8065-007921147115` |
| ナーチャリング通知済み日時 | `d31c34d6-ff20-4fda-af0d-591f93143fba` |
| 次回ナーチャリング月（Layer1候補・参照のみ）| `5aeb14d1-8916-4059-ad34-e94b8cdbf13c` |
| 次回更新月（手動・絶対に触らない）| `4cc7077b-e5a7-42cc-b590-9d10c6bff5ba` |

### source_type (根拠種別) option ID（優先度 高→低）
| source_type | optionId |
|---|---|
| recording_explicit | `c2ff373c-3ebe-4aad-9d88-f499936dca30` |
| email_explicit | `f0f1ce92-7f76-44a1-bf84-d3d275357ebc` |
| note_explicit | `80fd8dc5-a0d7-45b2-8f08-fd1eb52584d6` |
| active_followup_guard | `a7b61877-8212-44d7-88ef-30afb744793b` |
| stage_rule | `64566d21-9e93-4838-bef9-e3b35f0e1668` |
| closed_lost_rule | `277fb421-ea9f-4294-831d-784a63d450b0` |
| closed_won_rule | `d0277e76-63ab-411e-a8f9-d463cf2120c6` |
| fallback_insufficient_data | `c3ab39d7-938c-43dd-93c9-e755877a2c51` |

### 通知ステータス option ID
| 値 | optionId |
|---|---|
| 未通知 | `92eb242e-4b7d-4063-84b2-1e42252dc4c1` |
| 通知済み | `986a3bca-3bb5-4d20-9f7c-9c7a6983018f` |
| 通知失敗 | `bb994ced-739f-47b9-a7dc-826474813b1f` |
| 保留 | `4bacd915-3505-486b-ade0-9c1ac8fa6c4b` |

### ステージ ID
| ステージ | stageId |
|---|---|
| 1. 要件確認 | `250c9e31-0847-4ca0-bea0-0f2c2a6aecc9` |
| 2. 課題深掘り | `b5912d05-f207-4837-bb4f-86a3ae62f551` |
| 3. デモ実施 | `8f27398d-3b2a-4720-8c88-017f71251723` |
| 4. 提案・見積 | `6a0e67a7-941f-4cfc-b7a4-c1f47fccf694` |
| 5. トライアル/PoC | `9065f6fb-7448-477f-9fc6-002c7aaef836` |
| 6. セキュリティ&リーガルチェック | `88a37447-407e-428c-b022-85ff220df28e` |
| 7. 稟議 | `d66d1dc7-badc-40ea-9722-fba723733927` |
| 8. アップセル | `aa4c7849-7560-4642-b30b-b044b86c7cfe` |
| 9. 本契約 | `92de9362-3e40-41d6-9e4f-1eca43797d61` |
| 10. 終了 | `123eb2d5-d023-4ebe-8f37-41cdabe715bf` |

### ワークスペース ユーザー（assignee）ID
| ユーザー | userId |
|---|---|
| miyamoto@zenoffice.co.jp（宮本）| `02e22bf3-5535-44bc-8454-e00b23789e43` |
| suzuki@zenoffice.co.jp（鈴木）| `96144c47-250d-4d1e-b9f0-a5c438b7e116` |
| matsui@zenoffice.co.jp（松井）| `82b8c8f3-a8da-4d1e-b57b-bed087fad66b` |
| mochinaga@zenoffice.co.jp（持永）| `c68af008-3268-45c9-93c7-8faea79196a4` |
| yamashita@zenoffice.co.jp（山下）| `b455e599-7f8d-4fb4-8483-02ab5bc17383` |
| iwase@zenoffice.co.jp（岩瀬）| `2e0c1615-39ab-4201-939d-917e39ac4bac` |
| system@zenoffice.co.jp | `9e49b361-19aa-4f2e-9993-c3d95c1b150e` |
| tetsu.ota569@gmail.com | `1b4f516e-cba5-4f5a-89eb-b45891823ae2` |

---

## 7. 運用者対応事項

1. **ライブのルーチン・プロンプトを §5 の差し替え版に更新**（Claude ルーチン設定画面。API からは編集不可のため手動）。
2. （任意・別チーム）Day.ai 側で複合カスタムプロパティ AND フィルタの偽陰性、および search_objects が `propertiesToReturn` を無視する点をベンダーに報告。
3. headless 実行での `export_to_sandbox` 認証（Anthropic Files API）が必要なら、ルーチン実行環境に対応する資格情報の配線を検討。なお §3 のフィルタ方式は export 不要で完結する。
4. 値の verbatim（判定理由・根拠抜粋の本文）が営業通知に必須なら、Day.ai 側でそれらを `description`/サマリ投影に載せる、または Slack 連携を Day.ai スキル側へ移すことを検討。

---

_本分析は Day.ai 値の書き換えを一切行っていない（読み取り専用）。Slack への新規営業通知の再送も行っていない（前回ランの通知と重複させないため）。_
