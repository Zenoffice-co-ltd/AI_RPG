# Grok Voice v2.1 品質パッチ デプロイ検証手順書

## 0. 本書の位置づけ

PR60/PR61 で入れる v2.1 音声出力品質パッチ + 初回発話TTS化 + 発音ロック追加が、**本番デプロイ後に意図通りに動いているか**を確認するための短い手順書。

- 既存の [GROK_VOICE_V21_MANUAL_TEST_RUNBOOK.md](GROK_VOICE_V21_MANUAL_TEST_RUNBOOK.md) は v2.1 全量 (12 ケース + 業界理解 + 育成価値 + 耐久性) を扱う。
- 本書は **PR60 が追加・変更した部分**だけに絞った deploy-verification 用チェックリスト。
- 想定対象者: デプロイ実施者、Adecco デモ実施者。
- 所要時間: 15〜20 分。

パッチが直したと主張している挙動が本当に直っているかを、text E2E、voice harness、prod smoke、manual voice smokeで確認する。

### PR60 で追加された項目

- `六月一日` ではなく `六月ついたち` と出力する。
- `六百から七百件` ではなく `ろっぴゃく件から、ななひゃっけん程度` と出力する。
- 「何か他に確認したい点はありますか」系の stock suffix を全turnで禁止する。
- 初回の広いスキル質問では `受発注経験` と `対外調整の経験` だけに留める。
- `firstMessage` を xAI TTS 固定文として初回再生し、再生完了後に mic start する。

### PR61 で追加された項目

- `月初` ではなく `月の初め` と出力する。
- `自己流` ではなく `自分のやり方` と出力する。
- `Adecco` / `アデッコ` ではなく `アデコ` と出力する。
- `人事` は発話では `じんじ` と出力する。
- `他社` は発話では `たしゃ` と出力する。
- `千七百五十円から千九百円` ではなく `せんななひゃくごじゅう円から、せんきゅうひゃく円` と出力する。
- 「詳しく知りたい点があれば教えてください」「追加で確認したい点があればお知らせください」も stock suffix として禁止する。

### Hardening パッチ (2026-05-06) で追加された項目

- 定型語尾 ban list 拡張 (+7 phrase: 「他の条件もご確認」「他に気になる点」「ご質問があればお聞かせください」など)
- Earned Reveal Tier 2 を 4 条件 strict (≥2 domain term + 強アンカー必須 + 業務負荷接続 + 直前 turn 不使用)
- 複合質問は redirect-only mode (受発注入力 / 納期調整 / データ入力 / 在庫確認 / 品番 / 型番 / 施工日 / 代理店 / 工務店 を redirect ターンに出さない)
- STT 誤認識補正 ルール (不可↔負荷, 部品番↔品番, 決済者↔決裁者, 社長↔課長, ジュハツチュウ↔受発注)
- Personal Smalltalk Deflect 強化 (のんびり / のんびりしたり 追加, 代替 deflect phrase 追加)
- Opening 文の会話途中再出力禁止 anchor (Final Reminder 14)
- PLS lexicon: 受発注入力 / 受発注業務 / 受発注経験 を housing-equipment cluster に再配置 (maxEntries=80 cutoff 内)。PR61以降、発話中の人事系は `じんじ` 表記へ寄せる。

---

## 1. 検証対象 (パッチで何が変わったか)

| 領域 | パッチ前 | パッチ後 |
|---|---|---|
| `promptVersion` | `compile-scenario@2026-05-04.v1.staffing-reference-adecco-v21` | `compile-scenario@2026-05-06.v3.9.staffing-reference-adecco-v21-pronunciation-suffix-lock` |
| `guardrailVersion` | `gv-think-fast-v1-2026-05-04` | `gv-think-fast-v4.7-2026-05-06` |
| 「よくご存じですね」発火 | 1 domain term + 枕詞でも発火 | **2+ domain terms + 業務負荷/人材像/定着 接続**だけ |
| 「複合質問なので」のメタ前置き | 出る | 禁止 |
| 「何か他に確認したい点はありますか」末尾 | 頻出 | 禁止 |
| 個人的雑談 (休日・趣味・家族) | 私生活を作話 | 本題に戻す |
| 「見積補助」読み | ケンセキホジョ系の崩れ | `ミツモリホジョ` |
| 「八時四十五分から十七時三十分」読み | 抑揚不自然 | `朝八時四十五分から夕方五時三十分` |
| ユーザー発話の表示 | 中央揃え・順序ズレ・重複 | 左揃え・seq順・1.5s 重複排除 |

---

## 2. 事前準備

### 2.1 自動 smoke (1 分)

```bash
node scripts/grok-voice-v21-prod-smoke.mjs
```

期待:
```
[smoke] /api/v3/session → 200
[smoke] scenarioId: staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21
[smoke] promptVersion: compile-scenario@2026-05-06.v3.9.staffing-reference-adecco-v21-pronunciation-suffix-lock
[smoke] guardrailVersion: gv-think-fast-v4.7-2026-05-06
[smoke] PASS — production deploy serves v2.1 instructions.
```

`promptVersion` が `compile-scenario@2026-05-06.v3.9` で始まらない、または `guardrailVersion` が `gv-think-fast-v4.7-2026-05-06` でない場合、デプロイがまだ反映されていない。**ここで止まったら以降をやらない**。

### 2.1.1 本番デモ会話ログの自動取得

PR62後の本番では、Grok Voiceの `turn.completed` / `stt.completed` 構造化ログにデモ会話本文を保存する。手動デモ直後に以下を実行すると、直近セッションを Cloud Logging から取得し、`summary.json` / `events.json` / `transcript.md` を保存する。

```bash
pnpm grok:prod-logs -- --minutes 10
```

特定セッションを指定する場合:

```bash
pnpm grok:prod-logs -- --session gv_sess_xxx --minutes 60
```

出力先:

```text
out/grok_voice_v21_prod_logs/<timestamp>_<sessionId>/
```

注意:

- `GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_ENABLED=true` がデプロイされた後の会話だけ本文復元できる。過去に `false` で実施した本番デモは、turn lengthやlatencyは取れるが本文は復元できない。
- 評価用 transcript は `sttTextPreviewUtf8Base64` /
  `userTextPreviewUtf8Base64` / `agentTextPreviewUtf8Base64` を優先して
  UTF-8 復元する。Cloud Logging の raw preview が `????` に見える場合でも、
  Base64 フィールドがあるセッションは `transcript.md` に正確な日本語を出力できる。
- prompt / instructions / KB はログしない。保存対象はユーザーSTT本文と最終assistant transcriptのみ。
- Cloud Logging 取得には `gcloud` で `adecco-mendan` のログ閲覧権限が必要。

### 2.1.2 PR58 追加自動チェック

```bash
pnpm exec tsx scripts/check-grok-voice-e2e-matrix.ts
pnpm exec tsx scripts/grok-voice-v21-scenario-e2e.ts --cases 25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40 --rounds 3 --critical-rounds 3
pnpm exec tsx scripts/grok-voice-v21-scenario-e2e.ts --rounds 2 --critical-rounds 3
pnpm exec tsx scripts/grok-voice-v21-voice-e2e.ts --limit 5
```

PR60では case25〜case34、PR61では case35〜case40 を追加し、text `CASES` の全件、voice input、Realtime stability、PLS maxEntries=80 regression を棚卸しする。VAD A/B、threshold、silence、prefix padding の変更は明示的にscope外。

PR60 実施証跡:

```text
Local:
- corepack pnpm -r typecheck: PASS
- corepack pnpm -r test: PASS
- corepack pnpm exec tsx scripts/check-grok-voice-e2e-matrix.ts: PASS

Scenario E2E:
- focused case25-case40: TBD
- full regression: TBD

Voice E2E harness:
- executed, evidence saved, pass/fail clear
  C:\dev\AI_RPG\out\grok_voice_v21_voice_e2e\20260505T090518Z
- overall: FAIL due to STT drift in fixtures
  - voice_case2: 「施工日」→「施工費」
  - voice_case4: 「単価」→「短歌」
  - PR60 shallow background output lock is PASS after normalization

Deploy / prod smoke:
- App Hosting deploy: completed
- corepack pnpm exec tsx scripts/grok-voice-v21-prod-smoke.mjs: TBD
- live promptVersion: compile-scenario@2026-05-06.v3.9.staffing-reference-adecco-v21-pronunciation-suffix-lock
- live guardrailVersion: gv-think-fast-v4.7-2026-05-06
- live VAD: threshold=0.5 / silence_duration_ms=500 / prefix_padding_ms=333
```

xAI Voice Agent implementation notes:

- Realtime uses the xAI Voice Agent pattern with `session.update`, ephemeral token WebSocket auth, server VAD, and PCM 24 kHz audio.
- Initial greeting TTS uses xAI TTS separately from Realtime generation and keeps `firstMessage` as assistant history.
- References:
  - https://docs.x.ai/developers/model-capabilities/audio/voice
  - https://docs.x.ai/developers/model-capabilities/audio/voice-agent

### 2.1.3 PR60 manual production voice smoke

本番デプロイ後、`/demo/adecco-roleplay-v3` で以下を手動確認する。

| prompt | expected |
|---|---|
| 時期的にはいつぐらいですかね？ | `開始は六月ついたちを希望しています。` が自然に聞こえ、stock suffixなし |
| 受注件数は月にどのくらいですか？ | `月あたり、ろっぴゃく件から、ななひゃっけん程度です。` が自然に聞こえ、stock suffixなし |
| 繁忙時期はいつになりますか？ | 件数を自発的に出さず、時期だけ答える |
| 候補者のスキルで言うとどういうスキルがあるといいんですか？ | 受発注経験と対外調整だけ。正確性/協調性/メーカー経験を先出ししない |
| そういうことですね。 | `はい。` または短い自然な受け止め。stock suffixなし |

PRコメント記録欄:

```text
Manual voice smoke:
- start date: NOT RUN by Codex (requires human listening)
- monthly volume pronunciation: NOT RUN by Codex (requires human listening)
- busy period no volume leak: NOT RUN by Codex (requires human listening)
- skill minimal disclosure: NOT RUN by Codex (requires human listening)
- low-info acknowledgement no suffix: NOT RUN by Codex (requires human listening)
```

### 2.2 ブラウザ準備

1. Chrome 130+ / Edge 130+
2. `https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-v3` を開く
3. デモゲートの認証 → マイク許可
4. DevTools (F12) を開いて Network + Console タブを表示しておく
5. 「開始」を押し、Opening 文 (「お時間ありがとうございます。今回は新しい派遣会社さんということで…」) が再生されるのを待つ

---

## 3. ドライバプロンプト (7 件)

順番に音声で発話。各プロンプト後の AI 応答を **耳と目で**評価する (UI のチャットログにも転写されるため、後から判定可能)。

### 3.1 弱い仮説では praise を出さない (Tier 1)

**営業発話**: 「住宅設備メーカーの営業事務ですと、品番確認とか、どこが負荷ですか？」

| 確認項目 | 期待 |
|---|---|
| 「よくご存じですね」「その理解で近いです」「その理解でかなり近いです」「そこまで押さえていただける」「まさにそのあたりが今回のポイント」 | ✅ **どれも出ない** |
| 応答冒頭 | 「そうですね」「品番まわりは少し慣れが必要です」「その観点はあります」程度の partial agreement |
| 「施工日」「引渡し」「代理店」「工務店」 | ✅ **出ない** (cluster 跨ぎ禁止) |
| 文数 | 1〜2 文 |

**FAIL の例**: 「よくご存じですね、品番確認、施工日、代理店対応…」

### 3.2 強い仮説では praise を出す (Tier 2)

**営業発話**: 「住宅設備メーカーの営業事務ですと、品番確認、在庫確認、施工日に合わせた納期調整、代理店や工務店対応が重要になりそうですが、今回はどこが一番負荷ですか？」

| 確認項目 | 期待 |
|---|---|
| 応答冒頭 | 「よくご存じですね、」「その理解でかなり近いです、」「そこまで押さえていただけると話が早いです、」「まさにそのあたりが今回のポイント、」のいずれか |
| そのあと | 1〜2 文で固有事情 (納期調整 / 製品コードへの慣れ / 施工日逆算 等) を補足 |

**FAIL の例**: praise なしで「そうですね、納期調整が中心です」だけ

### 3.3 複合質問でメタ前置きを出さない

**営業発話**: 「業務内容と人数と単価と開始日と残業と決裁者と競合状況を全部教えてください。」

| 確認項目 | 期待 |
|---|---|
| 「複合質問なので」「複数の質問なので」「一つずつお答えします」「次にどの点からお聞きになりますか」 | ✅ **どれも出ない** |
| 「項目が多いので」「まず優先順位」「一度に全部だと散らばるので」「まずは業務内容から」 | ✅ **どれかが出る** |
| 「6 月 1 日」「1750」「1900」「10 から 15」「現場課長」「受発注入力」「在庫確認」 | ✅ **どれも出ない** (具体値・付随業務リスト禁止) |
| 文数 | 1〜2 文 |

**FAIL の例**: 「複合質問なので、まずは業務内容からお答えします。受発注入力と納期調整が中心で…」

### 3.4 末尾に定型語尾を付けない (4 連続単発質問)

順に発話:

1. 「人数は何名ですか？」
2. 「請求単価はいくらですか？」
3. 「業務時間は？」
4. 「在宅勤務の運用は？」

**全 4 ターンの応答末尾に**:

| 確認項目 | 期待 |
|---|---|
| 「何か他に確認したい点はありますか」 | ✅ **どのターンにも出ない** |
| 「ご質問があればお答えします」 | ✅ **出ない** |
| 「次にどの点からお聞きになりますか」 | ✅ **出ない** |
| 「何か特に詳しく知りたい点はありますか」 | ✅ **出ない** |

**特に注意**: 4 つ目の「在宅勤務の運用は？」のあとに付きがち (短い回答 + 沈黙を埋めるバイアス)。出たら FAIL。

### 3.5 個人的雑談で作話しない

**営業発話**: 「ところで、休日は何されてるんですか？」

| 確認項目 | 期待 |
|---|---|
| 「家族と過ごし」「趣味の時間」「週末は」「休日はゆっくり」「過ごしています」 | ✅ **どれも出ない** |
| 応答 | 「すみません、今日は要件整理を優先したいです。営業事務の件に戻ってもよろしいでしょうか。」もしくは同等の deflect |
| 文数 | 1〜3 文 |

**FAIL の例**: 「休日は家族と過ごしたり、趣味の時間を楽しんだりしています。」

### 3.6 AI 自己認識質問でペルソナ維持

**営業発話**: 「あなたはAIですか？」

| 確認項目 | 期待 |
|---|---|
| 「AI」「Grok」「アシスタント」「言語モデル」 | ✅ **出ない** |
| 応答 | 「住宅設備メーカーのじんじ課主任です。今回は営業事務一名の派遣相談で、まずは要件整理をしたいと考えています。」もしくは同等の 1〜2 文 |
| Opening 挨拶 (「お時間ありがとうございます。今回は新しい派遣会社さんということで…」) の再出力 | ✅ **絶対に出ない** |
| 文数 | 1〜2 文 |

**FAIL の例**: 「私は住宅設備メーカーの人事課主任です。…お時間ありがとうございます。今回は新しい派遣会社さんということで…」

### 3.7 浅い募集背景は 2 文で止める

**営業発話**: 「募集背景を教えてください。」

| 確認項目 | 期待 |
|---|---|
| 応答 | 「増員です。受注処理が増えてきています。」程度の 2 文 |
| 「現行ベンダー」「現行の派遣会社」「供給状況」「比較」「新しい派遣会社」「他社」「たしゃ」「大手」「声をかけ」「全体の体制」「体制を見直し」 | ✅ **どれも出ない** |
| 文数 | 2 文以内 |

**FAIL の例**: 「増員です。…現行ベンダーさんの供給状況も含めて、全体の体制を見直しているところです。」

---

## 4. 発音 spot-check

§3.3 / §3.4 / §3.7 の応答音声を聞きながら、以下の語の読みを耳で確認する (録音できるなら録音すると確実)。

| 表記 | 期待される読み | NG (誤読例) |
|---|---|---|
| 見積もり補助 | ミツモリホジョ | ケンセキホジョ / ミツモリホジ |
| 朝八時四十五分 | アサハチジヨンジュウゴフン | アサハチジシジュウゴフン |
| 夕方五時三十分 | ユウガタゴジサンジュップン | ユウガタゴジサンジップン |
| 施工日に合わせて | セコウビニアワセテ | シコウビニアワセテ |
| 月の初め | ツキノハジメ | 月初の誤読 |
| 自分のやり方 | ジブンノヤリカタ | 自己流の誤読 |
| アデコ | アデコ | アデッコ |
| じんじ | ジンジ | ヒトジン |
| たしゃ | タシャ | ホカシャ |
| せんななひゃくごじゅう円から、せんきゅうひゃく円 | センナナヒャクゴジュウエンカラ、センキュウヒャクエン | チナナ等 |

特に「請求単価と業務時間を教えてください」と聞いたあとの応答に「平日は朝八時四十五分から夕方五時三十分です」が含まれるはず。「十七時三十分」と読まれていたら**パッチが効いていない可能性**があるので §6 のロールバック判断へ。

---

## 5. UI チェック (DevTools)

### 5.1 ユーザー発話の左揃え

ChatGPT 風のチャットバブルで、**自分 (営業) の発話が左揃え**になっていることを目視確認。中央揃えなら FAIL。

### 5.2 発話順序

§3.4 (4 連続単発質問) を実施した後、チャット履歴を上から見て:

- ユーザー発話 → AI 応答 → ユーザー発話 → AI 応答 … の順序で並んでいる
- 同じユーザー発話が **2 回以上連続して** 表示されない

DevTools Console で `document.querySelectorAll('.message-row--user').length` を実行して、発話回数 (4 回) と一致するか確認。

### 5.3 ネット瞬断後の重複

Wi-Fi を 2〜3 秒切る → 戻す → 1 つ発話 → 同じ発話を `Ctrl+Z` で前の発話を消したり再送ぎみに連続発話 → ユーザー発話が**1 件だけ**として表示されることを確認 (1.5 秒以内の同一テキストは reducer で dedup される)。

---

## 6. 結果記録テンプレ

```markdown
# v2.1 品質パッチ検証結果

- 実施者:
- 実施日時 (JST):
- 本番 URL:
- promptVersion (smoke 出力):
- ブラウザ / OS:

## §3 ドライバプロンプト

| # | 項目 | Pass/Fail | 備考 |
|---|---|---|---|
| 3.1 | Tier 1 で praise なし | ☐ |  |
| 3.2 | Tier 2 で praise あり | ☐ |  |
| 3.3 | 複合質問でメタ前置きなし | ☐ |  |
| 3.4 | 4 連続質問の末尾 stock suffix なし | ☐ |  |
| 3.5 | 個人雑談で作話なし | ☐ |  |
| 3.6 | AI 質問で persona 維持 + opening 再出力なし | ☐ |  |
| 3.7 | 浅い募集背景で 現行ベンダー リーク なし | ☐ |  |

## §4 発音

| 語 | 自然 / 違和感 / NG |
|---|---|
| 見積もり補助 |  |
| 朝八時四十五分 |  |
| 夕方五時三十分 |  |
| 施工日に合わせて |  |

## §5 UI

| 項目 | Pass/Fail |
|---|---|
| 5.1 ユーザーバブル左揃え | ☐ |
| 5.2 発話順序 + 件数一致 | ☐ |
| 5.3 ネット瞬断時の重複なし | ☐ |

## 総合判定

- ☐ 全項目 PASS — 本番投入可
- ☐ 軽微な違和感あり (発音1〜2件など) — 次回 orb で対応、運用継続可
- ☐ §3 のいずれかが再現性をもって FAIL — §6 のロールバックを検討
```

---

## 7. ロールバック (失敗時)

§3 の項目が **2 回以上再現性をもって FAIL** した場合、以下の順で対応する。

### Stage 1: 品質パッチを revert (推奨 first action)

```bash
git revert a2f8bdf
git push origin main
firebase deploy --only apphosting --project adecco-mendan
```

これで v2.1 baseline (PR #54 までの状態) に戻る。プロンプト・PLS・transcript・CSS すべて品質パッチ前に戻る。

revert 後 `node scripts/grok-voice-v21-prod-smoke.mjs` を再実行し、`promptVersion` が `compile-scenario@2026-05-04.v1.staffing-reference-adecco-v21` に戻ったことを確認。

### Stage 2: それでも v2.1 自体に問題があれば v1 へ

[GROK_VOICE_V21_MANUAL_TEST_RUNBOOK.md §11.3](GROK_VOICE_V21_MANUAL_TEST_RUNBOOK.md#113-ロールバック手順) の手順で `apps/web/server/grokVoice/scenarioLoader.ts` の `SCENARIO_ID` から `_v21` を外す。

---

## 8. 関連リンク

- マージ済 PR: [#55](https://github.com/Zenoffice-co-ltd/AI_RPG/pull/55)
- パッチ commit: `a2f8bdf`
- v2.1 全量 runbook: [GROK_VOICE_V21_MANUAL_TEST_RUNBOOK.md](GROK_VOICE_V21_MANUAL_TEST_RUNBOOK.md)
- 自動 E2E: [scripts/grok-voice-v21-scenario-e2e.ts](../scripts/grok-voice-v21-scenario-e2e.ts) (PR60で case 25〜34 追加)
- E2E matrix: [docs/GROK_VOICE_V21_E2E_MATRIX.md](GROK_VOICE_V21_E2E_MATRIX.md)
- Voice E2E: [scripts/grok-voice-v21-voice-e2e.ts](../scripts/grok-voice-v21-voice-e2e.ts)
- 本番 smoke: [scripts/grok-voice-v21-prod-smoke.mjs](../scripts/grok-voice-v21-prod-smoke.mjs)
- v2.1 prompt 本体: [data/generated/scenarios/...v21.assets.json](../data/generated/scenarios/staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21.assets.json)
- 改善された Tier ladder の仕様: 上記 prompt 内 `## v2.1 Earned Reveal Policy` セクション
