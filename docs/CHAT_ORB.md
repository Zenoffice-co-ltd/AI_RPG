# Interactive Chat Orb (Stage 3 quality verification)

Stage 3 の Pareto frontier が示す候補 (LLM × TTS 組み合わせ) を、**実際に多ターン会話して品質を体感する** ためのインタラクティブ環境。LiveAvatar / ConvAI publish / Firestore には接続しない、純オフラインテスト。

提供形態は2つ:

| 形態 | 起動 | 用途 |
|---|---|---|
| **ブラウザ UI** | `.\scripts\chat-orb-web.ps1` → `http://127.0.0.1:3030` | 推奨。streaming token 表示・autoplay 音声・preset case ボタン・session ログ |
| ターミナル CLI | `.\scripts\chat-orb.ps1 -Llm <id> -Tts <p>` | 自動化したい場合・ヘッドレス環境 |

---

## ブラウザ UI で起動 (推奨)

```powershell
.\scripts\chat-orb-web.ps1
# → "Open http://127.0.0.1:3030 in your browser." と出たら、ブラウザで開く
# 停止は Ctrl+C
```

別ポートで動かしたい場合は `-Port 4040` 等。

ブラウザで開くと:

- 上部に **LLM dropdown / TTS dropdown / Temperature / New session** ボタン
- 中央に会話履歴 (token streaming で逐次表示、TTS audio は autoplay で再生)
- 下部に preset case ボタン (24 ケースから抜粋した代表 10 ケース) と入力ボックス

`Ctrl+Enter` で送信。各 turn の latency 詳細 (LLM 1st-token / 1st-sent / done、TTS 1st-audio / done、E2E) が表示される。

セッションは `data/generated/chat-orb-sessions/<sessionId>/turn-NNN.wav` に WAV を保存。`.gitignore` 済み。

### Stage 3 verification flow (ブラウザ版)

1. デフォルト (`anthropic:claude-haiku-4-5-20251001` + `fish`) で 5–10 turn 試す
2. **New session** で履歴クリア → `openai:gpt-4.1-nano` + `cartesia` に切り替えて同じ会話を試す
3. 速度の体感差 + 応答品質を比較
4. 余力あれば `claude-sonnet-4-5-20250929` / `gemini-2.5-flash` も試す

preset case は Stage 3 で knockout や速度差が顕著だったものを優先:

- 「短い相槌」(short_ack) — 速度差が出やすい
- 「条件提示」「数値日付」(condition_hearing / numbers_dates) — 数値正確性
- 「他社比較」「予算質問」(competitor / budget) — 過剰断定の有無
- 「Prompt 漏出 test」(safety_no_hallucination) — 内部指示漏出の有無

---

## ターミナル CLI 版

### 起動方法

#### Windows (推奨: PowerShell wrapper)

zapier-transfer Secret Manager から API key を一発でロードして起動:

```powershell
# Stage 3 Tier 1 候補
.\scripts\chat-orb.ps1 -Llm "anthropic:claude-haiku-4-5-20251001" -Tts fish    # 品質トップ
.\scripts\chat-orb.ps1 -Llm "openai:gpt-4.1-mini" -Tts cartesia                # バランス
.\scripts\chat-orb.ps1 -Llm "openai:gpt-4.1-nano" -Tts cartesia                # 最速

# その他の組み合わせ
.\scripts\chat-orb.ps1 -Llm "google:gemini-2.5-flash" -Tts openai
.\scripts\chat-orb.ps1 -Llm "anthropic:claude-sonnet-4-5-20250929" -Tts cartesia

# テキストだけ (TTS 無し)
.\scripts\chat-orb.ps1 -Llm "openai:gpt-4.1-nano" -NoTts
```

#### macOS / Linux / 直接 pnpm

env を手動でセットして:

```bash
export OPENAI_API_KEY=$(gcloud secrets versions access latest --secret=openai-api-key-default --project=zapier-transfer)
export ANTHROPIC_API_KEY=$(gcloud secrets versions access latest --secret=anthropic-api-key-default --project=zapier-transfer)
export GOOGLE_API_KEY=$(gcloud secrets versions access latest --secret=gemini-api-key-default --project=zapier-transfer)
export INWORLD_API_KEY=$(gcloud secrets versions access latest --secret=INWORLD_API_KEY --project=zapier-transfer)

# TTS (cartesia/fish/inworld 用)
export CARTESIA_API_KEY=$(gcloud secrets versions access latest --secret=CARTESIA_API_KEY --project=zapier-transfer)
export CARTESIA_VOICE_ID=$(gcloud secrets versions access latest --secret=CARTESIA_VOICE_ID --project=zapier-transfer)
export FISH_API_KEY=$(gcloud secrets versions access latest --secret=FISH_API_KEY --project=zapier-transfer)
export FISH_REFERENCE_ID=$(gcloud secrets versions access latest --secret=FISH_REFERENCE_ID --project=zapier-transfer)
export INWORLD_VOICE_ID=$(gcloud secrets versions access latest --secret=INWORLD_VOICE_ID --project=zapier-transfer)

pnpm chat:orb -- --llm anthropic:claude-haiku-4-5-20251001 --tts fish
```

## 操作

```
You> はい、お願いします。
AI > はい、承知いたしました。本日はどのようなご用件でしょうか。

[t1] LLM: 1st-token 215ms / 1st-sent 612ms / done 894ms (29 chars, 2 sent)
[t1] TTS: 1st-audio 312ms / done 1481ms (96000 bytes)
[t1] E2E: full-text 1st-audio 1206ms / done 2375ms
[t1] audio saved: C:\dev\AI_RPG\data\generated\chat-orb-sessions\chat-20260504T...\turn-001.wav

You> 開始日は5月12日で、できれば3名ほしいです。
AI > 5月12日からですね。3名のご希望、承知いたしました。詳しい業務内容を伺ってもよろしいですか。
...
```

特殊コマンド:

| input | 動作 |
|---|---|
| `:exit` または `:quit` | 終了 (transcript path 表示) |
| `:reset` | 会話履歴クリア (system prompt は維持) |

各 turn の audio ファイルはセッション dir に保存される (Windows なら double click で再生)。終了時に transcript.md が出力され、ターン毎の latency と response が markdown で残る。

## サポートする LLM × TTS

LLM (`--llm <id>`、または `-Llm "<id>"`):

| id | category | 備考 |
|---|---|---|
| `openai:gpt-4.1-nano` (default) | general-fast | 最速、p90 first sent 803ms |
| `openai:gpt-4.1-mini` | general-mid | バランス |
| `openai:gpt-4o-mini` | general-fast | レガシー比較用 |
| `openai:gpt-4.1` | general-mid | 高品質 |
| `openai:gpt-5-nano` | reasoning | reasoning effort=minimal 自動 |
| `openai:gpt-5-mini` | reasoning | 参考 (reasoning effort=minimal) |
| `anthropic:claude-haiku-4-5-20251001` | general-fast | Stage 3 品質トップ |
| `anthropic:claude-sonnet-4-5-20250929` | general-mid | 品質 |
| `google:gemini-2.5-flash-lite` | general-fast | |
| `google:gemini-2.5-flash` | general-mid | thinkingBudget=0 自動 |
| `inworld:auto` | general-fast | Inworld Router |

TTS (`--tts <provider>` or `-Tts ...`):

| provider | streaming | 備考 |
|---|---|---|
| `cartesia` (default) | ✓ | first-audio p50 ~340ms |
| `fish` | ✓ | first-audio p50 ~395ms |
| `openai` | ✓ | first-audio p50 ~575ms |
| `inworld` | ✗ | non-streaming (first-audio 計測不可、total のみ) |
| `google_gemini` | ✗ | non-streaming、最遅 |

ElevenLabs ConvAI lane は本ツールでは未対応。**Stage 3G 相当の voice 評価は本番 agent 経由かつ workspace webhook detach 必須** (`pnpm benchmark:quality-latency -- --elevenlabs-agent --create-temp-agent`)。

## Native voice lane (xAI Grok Voice Think Fast 1.0)

ブラウザ UI の LLM dropdown 上部 "Native voice (audio in/out)" グループから `xai:grok-voice-think-fast-1.0` を選択すると、xAI Realtime API 直結のリアルタイム音声会話モードに切り替わります。Web Speech API は使わず、`MediaStream → AudioContext → ScriptProcessor → PCM16 24kHz → サーバ proxy → xAI WS` の経路で双方向ストリーミング。

### xAI key 取得 + 保存

1. [console.x.ai](https://console.x.ai) で API key を発行
2. zapier-transfer Secret Manager に保存:
   ```powershell
   $key = "xai-..."
   $tmp = New-TemporaryFile
   [System.IO.File]::WriteAllText($tmp.FullName, $key, [System.Text.UTF8Encoding]::new($false))
   gcloud secrets create XAI_API_KEY --project=zapier-transfer --data-file=$($tmp.FullName) --replication-policy=automatic
   # 既に存在する場合: gcloud secrets versions add XAI_API_KEY --project=zapier-transfer --data-file=$($tmp.FullName)
   Remove-Item $tmp.FullName -Force
   ```
3. 以降 `chat-orb-web.ps1` が自動で env に load します

### サーバ起動時のログで確認

```
Chat Orb test UI: http://127.0.0.1:3030
Sessions dir:     C:\dev\AI_RPG\data\generated\chat-orb-sessions
Grok Voice lane:  /api/voice-realtime (xAI grok-voice-think-fast-1.0)
```

`Grok Voice lane: disabled (XAI_API_KEY not set)` になっている場合は key が読み込めていません。

### 操作の差分 (text LLM × TTS との比較)

| 項目 | Text LLM × TTS | Native voice (Grok) |
|---|---|---|
| 入力 | テキスト or 🎙 (Web Speech API ASR) | 🎙 のみ (テキスト box は disable) |
| TTS dropdown | 有効 | 自動 disable (Grok 内蔵) |
| 表示 latency | LLM 1st-token / 1st-sent / done + TTS 1st-audio | server: firstAiAudio / firstAiText / aiAudioDone + browser perf voice→voice E2E |
| 保存 audio | `turn-NNN.wav` (AI 音声のみ) | `voice-NNN-user.wav` + `voice-NNN-ai.wav` + `voice-NNN-events.jsonl` |
| 切り替え | LLM dropdown を切り替えるだけ | LLM dropdown 上部の "Native voice" group から選択 |

### バッチ評価 (Stage 3 同列に並べる)

`scripts/grok-voice-batch.ps1` は 24 case を OpenAI TTS で audio 化 → xAI Realtime に送信 → AI audio を Whisper で文字起こし → 同 rubric で採点可能な JSON を `llm-text/xai-grok-voice-think-fast-1-0__<caseId>__r01.json` に保存:

```powershell
.\scripts\grok-voice-batch.ps1 -RunDir data\generated\quality-latency-benchmark\p6s3-... -Voice ara -Limit 24
```

### ⚠️ ASR roundtrip caveat

合成音声 (`gpt-4o-mini-tts` voice=`marin` は英語ベース) で日本語入力を作ると、xAI 内部の whisper が garbled な transcript を出してしまうケースがある (例: 「某A社さん」→「防衛者さん」、「経費」→「競馬」)。Grok はその誤った transcript を真に受けて hallucinate してしまう。

**実音声で再評価する**ことを推奨。chat-orb-web.ps1 起動 → ブラウザで Native voice 選択 → 自分で日本語で話すと、合成音声で出ていた knockout (ql_019, ql_020 等) が出ない可能性が高い。バッチ benchmark の数値はあくまで合成音声起点の lower bound として扱う。

### Voice の選択

xAI が提供する voice (`eve` / `ara` / `rex` / `sal` / `leo`) は全て英語ベース。日本語の自然さは現状限定的。本格運用時は xAI Custom Voices API での日本語 voice 作成、または音声品質を妥協してでもネイティブ統合を優先するか、トレードオフを判断する必要がある。

## 表示される latency 指標

| 指標 | 意味 |
|---|---|
| LLM 1st-token | リクエスト→最初のtoken 受信 |
| LLM 1st-sent | リクエスト→最初の自然な文 (句点系終端) |
| LLM done | リクエスト→全文完了 |
| TTS 1st-audio | TTSリクエスト→最初の音声 chunk |
| TTS done | TTSリクエスト→全音声完了 |
| E2E full-text 1st-audio | LLM done + TTS 1st-audio (full-text mode 合計) |
| E2E full-text done | LLM done + TTS done (全体応答完了まで) |

**注**: 本ツールは full-text mode (LLM 全文待ち→TTS) のみ。first-sentence chunked pipeline は本番実装で行う。

## システムプロンプト

デフォルトは `packages/scenario-engine/src/qualityLatency/systemPrompt.ts` の `QUALITY_LATENCY_SYSTEM_PROMPT` (Stage 3 ベンチマークと同一)。

```
あなたは日本語の法人向けAIロープレの相手役です。
相手は忙しい法人担当者です。
返答は自然な日本語で、短く、音声で聞き取りやすくしてください。
記号や箇条書きは避け、会話としてそのまま読み上げられる文にしてください。
回答は原則1〜2文、長くても3文までにしてください。
```

カスタムプロンプトでテストする場合は `--system-prompt "..."` を渡す。

## 出力

```
data/generated/chat-orb-sessions/
  chat-<isoCompact>/
    turn-001.wav
    turn-002.wav
    ...
    transcript.md
```

`.gitignore` 済み — commit されない。

## 関連 docs / skills

- [docs/QUALITY_LATENCY_BENCHMARK.md](QUALITY_LATENCY_BENCHMARK.md) — Stage 3 benchmark の Pareto frontier 計算
- [docs/LLM_MODEL_LATENCY_BENCHMARK.md](LLM_MODEL_LATENCY_BENCHMARK.md) — モデル単体速度
- `.agents/skills/ai-rpg-quality-latency-benchmark/SKILL.md` — Skill (将来の Codex/Claude セッション向け)
