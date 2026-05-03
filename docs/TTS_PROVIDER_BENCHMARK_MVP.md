# TTS Provider Benchmark MVP

オフラインで音声生成・レイテンシ測定・試聴比較を行うための最小実装。生成 runtime (LiveAvatar / ConvAI publish / Firestore / Next.js UI) には**一切影響しない**。

## 目的

ロープレ用音声品質と日本語レイテンシの観点で、ElevenLabs 以外の TTS provider を横断比較するための baseline 材料を生成する。

- 各 provider × 各 utterance × repeats 回の音声を生成
- レイテンシ (first audio / total / RTF) を `metrics.csv` に記録
- 集計 (p50 / p90) を `summary.csv` に出力
- 人手評価用のシートを `review-sheet.csv` に出力
- 試聴用 `index.html` を生成 (provider 名は blind toggle 可能)

## 対象 provider

| id | model 既定値 | env |
|---|---|---|
| `openai` | `gpt-4o-mini-tts` | `OPENAI_API_KEY`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` |
| `cartesia` | `sonic-3` | `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID`, `CARTESIA_TTS_MODEL` |
| `inworld` | `inworld-tts-1.5-mini` | `INWORLD_API_KEY`, `INWORLD_VOICE_ID`, `INWORLD_TTS_MODEL` |
| `fish` | `s2-pro` | `FISH_API_KEY`, `FISH_REFERENCE_ID`, `FISH_TTS_MODEL` |
| `google_gemini` | `gemini-3.1-flash-tts-preview` | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (or `GCLOUD_LOCATION`), `GOOGLE_TTS_MODEL`, `GOOGLE_TTS_VOICE`. ADC 認証 (`gcloud auth application-default login`) または `GOOGLE_ACCESS_TOKEN` |
| `elevenlabs_baseline` (任意) | `DEFAULT_ELEVEN_MODEL` | `ELEVENLABS_API_KEY`, `DEFAULT_ELEVEN_VOICE_ID` (`--include-elevenlabs-baseline` 指定時のみ呼ばれる) |

## 実行コマンド

```bash
# preflight: 必要 env をチェック (HTTP call なし)
pnpm benchmark:tts:mvp -- --preflight
pnpm benchmark:tts:mvp -- --providers cartesia,inworld,fish,google_gemini,openai --preflight

# 単一 provider で1回試す
pnpm benchmark:tts:mvp -- --providers openai --repeats 1

# 5 provider × repeats=5
pnpm benchmark:tts:mvp -- --providers cartesia,inworld,fish,google_gemini,openai --repeats 5 --mode warm

# ElevenLabs baseline を混ぜる
pnpm benchmark:tts:mvp -- --providers openai,cartesia --include-elevenlabs-baseline
```

CLI option:

```text
--providers <csv>         provider id をカンマ区切りで指定 (default: openai)
--repeats <n>             utterance ごとの繰り返し回数 (default: 1)
--mode warm|cold          warm はベンチ前にダミー call で provider をウォームアップ (default: warm)
--output-dir <path>       出力先 dir (default: data/generated/tts-provider-benchmark/<runId>)
--utterances <csv>        utterance CSV path (default: data/voice-benchmark/utterances_ja_busy_manager_sanity.csv)
--include-elevenlabs-baseline   既存 ElevenLabsClient.renderSpeech() を baseline として混ぜる
--preflight               必要 env を表示してから exit。HTTP call は一切しない
```

## 出力先

```text
data/generated/tts-provider-benchmark/<runId>/
  audio/
    <provider>__<utteranceId>__r<NN>.{wav|mp3|...}
  manifest.json
  metrics.csv
  summary.csv
  review-sheet.csv
  index.html
```

`runId` は `mvp-<ISO timestamp without colons>` 形式 (例: `mvp-20260503T120000Z`)。

## metrics.csv

provider × utterance × repeat ごとに 1 行。

| カラム | 意味 |
|---|---|
| `runId`, `timestamp` | 実行 id と call 時刻 |
| `provider`, `model`, `voiceId` | provider id / モデル / voice id |
| `utteranceId`, `repeatIndex`, `mode` | 入力 utterance、何回目の繰り返しか、warm/cold |
| `textLength` | 入力テキスト文字数 |
| `status` | `success` / `failed` |
| `requestToFirstAudioMs` | リクエスト送出から最初の非空 audio chunk までの ms。**streaming 非対応 provider は空欄** |
| `requestToLastAudioMs` | リクエスト送出から最終 chunk までの ms (= total) |
| `audioDurationMs` | 生成音声の再生時間 (PCM サイズから推定) |
| `rtf` | `requestToLastAudioMs / audioDurationMs`。1未満ならリアルタイム以上 |
| `bytes`, `sampleRateHz`, `format` | 出力ファイル属性 |
| `outputFile` | audio file の絶対 path |
| `errorCode`, `errorMessage`, `vendorRequestId` | 失敗時診断情報 |

## summary.csv

provider × model × voiceId 単位で集計。

| カラム | 意味 |
|---|---|
| `total`, `success`, `failed`, `successRate` | 件数と成功率 |
| `firstAudioAvailable` | streaming 計測が取れる provider なら `true` |
| `p50FirstAudioMs`, `p90FirstAudioMs` | first-audio レイテンシの分位点。`firstAudioAvailable=false` なら空欄 |
| `p50TotalMs`, `p90TotalMs` | 総レイテンシの分位点 |
| `p50Rtf`, `p90Rtf` | Real-Time Factor の分位点 |

## review-sheet.csv

success 行のみが対象。`providerHiddenId` は `sha1(runId|provider|voiceId)` の先頭 8 桁で、blind 試聴時に provider 名を伏せて評価するための識別子。CSV には provider 名も復元用に含めるが、`index.html` の "Toggle blind mode" ボタンで provider 名を隠すと hiddenId だけが表示される。

評価カラム: 自然さ / 滑らかさ / 日本語発音 / 読みの正確さ / 速度感 / ノイズ・破綻 / 総合 / knockout 理由 / comments

## 重要な定義

- **first-audio latency**: HTTP streaming 受信時、最初に**非空** chunk が到着した瞬間を `requestToFirstAudioMs` とする。空 chunk は無視する。streaming 非対応 (Inworld 非ストリーム / Google Gemini preview / ElevenLabs baseline) は **必ず null** とし、`summary.csv` で `firstAudioAvailable=false` になる。
- **warm vs cold**: `warm` は計測開始前に provider ごとに 1 度ダミー call (短い「テスト」) を投げて TLS/コネクション/モデルロードを温めてから本計測する。metrics には warm 後の本計測のみ記録される。`cold` はウォームアップなし。
- **provider 実行順序**: 厳密シリアル (provider → utterance → repeats)。並列化はネットワーク輻輳でレイテンシ計測が歪むため意図的に避けている。

## 公式 docs 確認 (毎リリース時に更新)

各 provider の endpoint / model 名 / streaming 形式は preview / GA 状態に応じて頻繁に変わる。実装時の確認結果を以下に1行で残す。

- 2026-05-03: 初版実装。各 provider の endpoint・model 名は plan に基づく既定値で実装。**実 API smoke 実行時に公式 docs を再確認する必要あり**。

## 影響範囲

- 既存 `packages/scenario-engine/src/benchmarkRenderer.ts` (`renderVoiceBenchmark`) には**触っていない**。
- 既存 `packages/vendors/src/elevenlabs.ts` の ConvAI / agent / publish / branch / test 系には**触っていない**。
- `config/voice-profiles/`, `scenario-map.json` は**変更していない**。
- Firestore / Cloud Tasks / LiveAvatar / LiveKit / Next.js routing には**接続しない**。
- Firebase 初期化を避けるため `getAppContext()` は使わず、CLI が vendor client を直接 `new` する。

## 制約 / 既知の制限

- WebSocket 直結 (Cartesia / Fish のライブ TTS、Inworld の SSE) は MVP では未実装。HTTP streaming で代用しているが、adapter interface は `synthesize(input)` で固定なので、後で WS に置換しても呼び出し側は変更不要。
- Google Gemini TTS は preview。voice 名・endpoint・auth スコープは公式 docs を実行直前に再確認すること。
- 生成音声ファイルは原則 commit しない。レポート用途で添付したい場合は PR 本文で明示する。
