# 週次ナーチャリング商談通知 — Claude Code rule

**詳細ランブック / Source of Truth:** [`docs/routines/weekly-nurturing-notification-routine.md`](../../docs/routines/weekly-nurturing-notification-routine.md)。
このファイルは「毎週月曜：今週のナーチャリング商談通知」ルーチンの Claude 側オペレーション・サーフェスであり、
**Day.ai MCP の制約を回避して仕様通りに実行するための load-bearing なルール**を再掲する。ルーチン実行セッションは
`.claude/rules/*.md` を自動ロードするため、本ファイルは次回以降の実行に自動適用される。

通知先 Slack: `C0AC7131KDE` ／ 対象: Day.ai `native_opportunity`。

## 必読：Day.ai API の2つの制約（違反すると誤報する）

1. **値読み取り不可** — `search_objects` は `propertiesToReturn`（配列でも `"*"` でも）を無視し、
   `objectId/title/description/timestamps` のサマリのみ返す（`ownerEmail`/`stageId` すら返らない）。
   `export_to_sandbox` は本（headless/cron）環境で Anthropic Files API 認証に失敗し使用不可。
   → カスタムプロパティの**値は読まない**。すべて `where` フィルタの集合演算で分類する。
   会社概要は `native_organization.description`、ユーザー名は `native_user.title` から取得。

2. **複合カスタムプロパティ AND バグ（偽陰性）** — 1つの AND には
   「日付プロパティ `6f7779ad` ＋ もう1つのカスタムプロパティ条件」までしか入れてはならない。
   日付以外の**異なるカスタムプロパティ条件を2つ以上 AND にすると誤って 0 件**を返す。
   → 仕様の `根拠種別≠null AND 判定理由≠null` を**1クエリにしない**。別々に取得し objectId で論理積する。
   `assignee`（担当）はリレーションなのでバグ対象外、日付と AND してよい。

## 抽出アルゴリズム（値を読まずフィルタ集合演算で分類）

定数: `PROP_DATE=6f7779ad…` `PROP_TYPE=c94bdef8…(根拠種別)` `PROP_REASON=a2e29ef6…(判定理由)`
`PROP_STATUS=baeee2e7…(通知ステータス)` `STAGE_本契約=92de9362…`。WS=月曜, WE=日曜(JST)。

1. 8つの source_type option ごとに `AND[PROP_DATE gte WS, PROP_DATE lte WE, PROP_TYPE eq <option>]`
   を実行しバケット化（`根拠種別≠null` を自動保証＋通知優先度を取得）。
2. `AND[PROP_DATE gte WS, PROP_DATE lte WE, PROP_REASON isNotNull]` → R。
   主対象 = Σ(active バケット) ∩ R。R 外は「判定理由欠落＝データ整備枠」件数のみ。
3. `AND[PROP_DATE gte WS, PROP_DATE lte WE, stageId contains STAGE_本契約]` → H。主対象から H を除外。
4. 社内ユーザーごとに `AND[PROP_DATE gte WS, PROP_DATE lte WE, assignee eq uid]` → 担当を付与。
5. `AND[PROP_DATE gte WS, PROP_DATE lte WE, PROP_STATUS eq 通知済み(986a3bca…)]` → 既通知は末尾へ。
   （`PROP_STATUS` は値未設定の間 0 件/スキーマ未存在エラー → いずれも「全件未通知」として扱う。本ルーチンはステータスを書き込まない）
6. 並び順 = source_type 優先度
   `recording_explicit > email_explicit > note_explicit > active_followup_guard > stage_rule > closed_lost_rule > closed_won_rule > fallback_insufficient_data`。
7. `closed_won_rule`=更新/活用確認枠、`fallback_insufficient_data`=データ整備枠(件数のみ・営業通知しない)、他=営業本体。
8. 期限超過(1–30 / 31+)も**必ず**同じバケット＋本契約除外を適用（日付だけで数えない。前回の 67/112 は過大計上）。

**送信前 自己チェック**: 日付のみ件数 と Σ(active バケット＋closed_won＋fallback＋reason欠落) が一致するか確認。
乖離なら未知 option か制約Bの影響を疑い、送信前に調査。過去背景は推測で創作せず、判定理由/根拠抜粋の本文が
必要な場合は「Day.ai の該当 Opp で確認」と明記する。

## 絶対禁止（不変）

Day.ai の値書き換え・通知ステータス更新・通知済み日時更新・`_最終`系/候補値(`5aeb14d1`)/次回更新月(`4cc7077b`)の
書き換え・`backfill_custom_property`・`batch_create_or_update_opportunities`・Scheduled Task の登録/変更/削除・
本番 Opp へのメモ追加を行わない。**許可される書き込みは Slack 通知送信のみ。**

## ID リファレンス

source_type option / ステージ / ユーザー(assignee) ID の完全表、および差し替え用ルーチン・プロンプト全文は
[`docs/routines/weekly-nurturing-notification-routine.md`](../../docs/routines/weekly-nurturing-notification-routine.md) §5–§6 を参照。
