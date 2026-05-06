# Grok Voice v2.1 E2E Matrix

This matrix maps each Grok Voice v2.1 regression case to the quality risk it protects. `scripts/grok-voice-v21-e2e-cases.ts` is the source of truth for exact `turns` and `passConditions`; run `pnpm exec tsx scripts/check-grok-voice-e2e-matrix.ts` after adding or renaming any case.

VAD A/B, `threshold`, `silence_duration_ms`, and `prefix_padding_ms` are out of scope for PR58.

## Text Scenario E2E

| case id | label | critical | input turns | expected behavior | must_contain terms | must_not_contain terms | max_sentences | quality risk | background |
|---|---|---:|---|---|---|---|---:|---|---|
| `case1_shallow_background` | 浅い募集背景は開示しすぎない | yes | 募集背景 | 表層背景のみ返す | SoT `must_contain*` | SoT `must_not_contain*` | SoT | shallow reveal leakage | PR52/57 |
| `case3b_weak_question_no_reveal` | 弱い質問では earned reveal を発火させない (negative control) | yes | 営業事務の業務内容 | domain hypothesisなしでは称賛しない | SoT | SoT | SoT | false earned reveal | PR57 |
| `case2_new_vendor_reason` | 新規派遣会社に声をかけた理由で一部開示 | no | 新規派遣会社理由 | 現行ベンダー/供給/レスポンスを段階開示 | SoT | SoT | SoT | staged reveal | PR52 |
| `case3_domain_hypothesis` | 住宅設備メーカー仮説でearned reveal | yes | 品番/在庫/施工日/代理店/工務店仮説 | Tier 2 praiseと住宅設備論点 | SoT | SoT | SoT | Tier 2 praise gating | PR52/57 |
| `case4_self_promotion_redirect` | 自社説明先行を受け流す | yes | Adecco売り込み | 同意せず要件理解へ戻す | SoT | SoT | SoT | premature pitch | PR52 |
| `case5_cp_handoff_summary` | CP共有前提の要約に反応する | yes | CP共有要約 | 候補者要件理解に肯定し優先人材像を補足 | SoT | SoT | SoT | CP-ready summary | PR52 |
| `case6_icebreak` | アイスブレイクは1往復で本題へ | no | 雑談 | 短く受けて本題へ戻す | SoT | SoT | SoT | smalltalk drift | PR52 |
| `case7_rapid_fire` | 質問攻めには答えすぎない (answerBudget) | yes | 複数質問 | 最重要だけ短く返す | SoT | SoT | SoT | answer budget | PR52 |
| `case8_late_kickback_question` | 終盤だけAdecco差別化質問を出す | no | multi-turn深掘り | 終盤のみ逆質問 | SoT | SoT | SoT | premature kickback | PR52 |
| `case9_negative_info_prebriefing` | ネガティブ情報の事前共有提案に応える | yes | 定着リスク共有 | ギャップ事前共有に応える | SoT | SoT | SoT | fit-risk reveal | PR52 |
| `case10_sk_confirmation_loop` | SK を確認・深掘りの場として位置づける提案を受ける | no | SK活用 | 次回精度向上の場として受ける | SoT | SoT | SoT | SK loop | PR52 |
| `case11_best_to_minimum_line` | ベスト条件と最低ラインを分けて返す | yes | ベスト/最低ライン | 条件を段階化する | SoT | SoT | SoT | candidate quality line | PR52 |
| `case12_praise_threshold_medium_question` | 弱い仮説 (枕詞 + domain 1語) では praise を発火させない | yes | 弱い仮説 | Tier 2未満の称賛禁止 | SoT | SoT | SoT | praise threshold | PR57 |
| `case13_no_stock_followup_suffix` | 通常応答末尾に定型語尾を付けない | yes | 人数 | stock suffix禁止 | SoT | SoT | SoT | stock suffix | PR57 |
| `case14_personal_smalltalk_deflect` | 個人的な雑談は作話せず本題に戻す | yes | 休日質問 | 個人情報を作らず本題へ | SoT | SoT | SoT | personal smalltalk hardening | PR57 |
| `case15_rapid_fire_no_meta_and_no_detail` | 複合質問でメタ表現せず hidden facts も出さない | yes | 複合質問 | メタ表現と詳細漏れ禁止 | SoT | SoT | SoT | compound redirect-only | PR57 |
| `case16_identity_no_stock_suffix` | AI 自己認識質問でもペルソナを維持し定型語尾を付けない | yes | AI自己認識 | ペルソナ維持/firstMessage再出力禁止 | SoT | SoT | SoT | identity/opening re-output | PR57 |
| `case17_stt_misrecognition_recovery` | STT 誤変換 (不可→負荷 / 部品番→品番) を文脈補正 | yes | 誤変換文 | 不可/部品番を業務文脈で補正 | SoT | SoT | SoT | STT drift recovery | PR57 |
| `case18_manager_misrecognition_recovery` | STT 誤変換 (社長→課長) を直前文脈で補正し作話しない | yes | 指揮命令者→社長タイプ | 社長像を作らず課長へ補正 | SoT | SoT | SoT | manager misrecognition | PR57 |
| `case19_numeric_cost_correction` | 誤った費用理解には安易に同意しない | yes | 十万円確認 | 単価レンジへ訂正/現場確認 | SoT | SoT | SoT | numeric correction | PR58-C |
| `case20_headcount_correction` | 誤った募集人数には安易に同意しない | yes | 三名募集確認 | 一名へ訂正/現場確認 | SoT | SoT | SoT | headcount correction | PR58-C |
| `case21_remote_work_correction` | 在宅頻度の誤認には安易に同意しない | yes | 週三日在宅確認 | 当面なし/現場確認 | SoT | SoT | SoT | remote condition correction | PR58-C |
| `case22_hourly_rate_correction` | 単価上振れの誤認には範囲で返す | yes | 二千円以上確認 | レンジ/限定的上振れ/現場確認 | SoT | SoT | SoT | hourly rate correction | PR58-C |
| `case23_working_hours_correction` | 勤務時間の誤認には安易に同意しない | yes | 十時開始確認 | 既存勤務時間へ訂正/現場確認 | SoT | SoT | SoT | working hours correction | PR58-C |
| `case24_must_have_condition_correction` | 受発注経験の必須/優先を混同しない | yes | 受発注経験必須確認 | 必須/優先の違いを訂正 | SoT | SoT | SoT | must-have correction | PR58-C |
| `case25_start_date_voice_friendly_no_suffix` | 開始日は六月ついたちで読み上げやすく、定型語尾を付けない | yes | 時期的にはいつぐらい | `六月ついたち` の一文回答、stock suffixなし | 六月ついたち | 六月一日, 6月1日, stock suffix | 1 | date pronunciation + suffix | PR60 manual voice feedback |
| `case26_monthly_volume_voice_friendly_no_suffix` | 月間受注件数はろっぴゃく件から、ななひゃっけん程度で読む | yes | 受注件数 | 音声優先の件数レンジ一文回答 | ろっぴゃく件, ななひゃっけん, 月あたり, 程度 | 六百から七百件, 600から700件, stock suffix | 1 | quantity pronunciation + suffix | PR60 manual voice feedback |
| `case27_busy_period_only_no_volume_leak` | 繁忙時期質問では件数を漏らさない | yes | 繁忙時期 | 時期だけ答え、件数は出さない | 月末, 月初, 月曜日, 商品切替 | 六百, 七百, 件, stock suffix | 2 | over-disclosure by intent | PR60 manual voice feedback |
| `case28_no_stock_suffix_after_shallow_background` | 浅い募集背景回答の後に定型語尾を付けない | yes | 簡単な募集背景 | 表層背景のみ、誘導語尾なし | 増員, 受注, 処理 | stock suffix, 業務内容と合わせて, 現場の状況も絡む | 2 | shallow background suffix | PR60 manual voice feedback |
| `case29_no_stock_suffix_after_low_information_ack` | 低情報量の相槌には短く受け止め、定型語尾で埋めない | yes | 繁忙時期 → そういうことですね | 短い受け止めだけ | はい, そうですね | stock suffix | 1 | low-info ack suffix | PR60 manual voice feedback |
| `case30_skill_question_minimal_disclosure` | 初回スキル質問は受発注経験と対外調整だけに留める | yes | 候補者スキル | 第一階層のみ答える | 受発注 + 対外調整/社外対応/調整経験 | 正確性, 協調性, メーカー経験, 必須ではありません | 2 | skill over-disclosure | PR60 manual voice feedback |
| `case31_skill_accuracy_followup_allowed` | 正確性は聞かれた場合だけ具体化できる | yes | 正確性とは | 正確性の具体論だけ答える | 品番, 納期, 取り違え, 指示, 正確, 確認 | メーカー経験はプラス, 必須ではありません, stock suffix | 2 | progressive disclosure | PR60 manual voice feedback |
| `case32_skill_cooperation_followup_allowed` | 協調性は聞かれた場合だけ具体化できる | yes | 協調性follow-up | 連携の具体論だけ答える | 営業, 物流, 連携, 確認, 抱え込まず | 過去例, 自己流, 納期調整では特に, stock suffix | 2 | progressive disclosure | PR60 manual voice feedback |
| `case33_manufacturer_experience_followup_allowed` | メーカー経験の必須/非必須は聞かれた場合だけ答える | yes | メーカー経験なし | 必須ではないことと代替経験 | 必須ではありません/業界未経験でも/検討できます + 受発注/対外調整/社外対応 | stock suffix | 2 | progressive disclosure | PR60 manual voice feedback |
| `case34_final_closing_no_customer_support_suffix` | 終盤挨拶にカスタマーサポート風語尾を付けない | yes | よろしくお願いします | 自然な一文挨拶 | こちらこそ, よろしくお願いします | ご不明点, いつでもお気軽に, ご連絡ください, stock suffix | 1 | customer-support suffix | PR60 manual voice feedback |

## Voice Input E2E

| case id | label | input fixture | expected behavior | quality risk | background |
|---|---|---|---|---|---|
| `voice_case1_shallow_background` | voice shallow background | `voice_case1_shallow_background.wav` | STT non-empty, shallow background only, no deep facts | audio path + shallow reveal | PR58-C |
| `voice_case2_domain_hypothesis` | voice domain hypothesis | `voice_case2_domain_hypothesis.wav` | STT retains key lexemes, Tier 2 praise, housing-equipment facts | audio STT + Tier 2 | PR58-C |
| `voice_case3_headcount` | voice headcount | `voice_case3_headcount.wav` | short factual headcount, no stock suffix | voice factual answer | PR58-C |
| `voice_case4_rate` | voice rate | `voice_case4_rate.wav` | readable rate/range, no sales suffix | voice numeric answer | PR58-C |
| `voice_case5_order_entry_requirement` | voice order-entry requirement | `voice_case5_order_entry_requirement.wav` | 受発注入力 handled, must/preferred not mixed | voice lexeme + condition | PR58-C |

## Realtime Stability Integration

| case id | expected behavior | quality risk | background |
|---|---|---|---|
| `realtime_case1_session_ready_order` | `session.update → assistant history → session.ready → mic start` | init race | PR58-B |
| `realtime_case2_send_before_open_queue` | sends before socket open are FIFO flushed after open | silent send drop | PR58-B |
| `realtime_case3_audio_before_ready_blocked` | audio before ready is blocked or explicitly telemetered | lost audio chunk | PR58-B |
| `realtime_case4_send_failure_telemetry` | `socket.send` exception emits `ws.send.failed` | invisible send failure | PR58-B |
| `realtime_case5_barge_in_cancel` | speech start while speaking cancels once, flushes audio, discards stale deltas | barge-in stale playback | PR58-B |

## PLS Regression

| case id | expected behavior | critical lexemes | quality risk | background |
|---|---|---|---|---|
| `pls_maxEntries80_critical_lexeme_regression` | `buildLivePronunciationGuide(... maxEntries: 80)` includes all critical lexemes | 受発注, 受発注入力, 受発注業務, 受発注経験, 人事, 人事課, 人事課主任, 人事窓口, 人事主導, 品番, 型番, 施工日, 納期調整, 代理店, 工務店, アデコ | PLS silent drop | PR58-C |
