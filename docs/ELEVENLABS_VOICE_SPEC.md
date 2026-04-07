# ElevenLabs Voice Specification

このドキュメントは、repo 内で ElevenLabs 音声設定をどう管理し、publish / benchmark / 手動確認へどう流すかを定義します。

## Scope

- 対象 scenario: `staffing_order_hearing_busy_manager_medium`
- 対象 persona: `busy_manager_medium`
- 対象設定: `voiceId`, `tts model`, `first message`, `text normalization`, `voice settings`, `pronunciation dictionary locators`
- 正本:
  - profile 定義: `config/voice-profiles/*.json`
  - scenario ごとの active mapping: `config/voice-profiles/scenario-map.json`
  - schema / validation: `packages/domain/src/voiceProfile.ts`
  - ElevenLabs payload 変換: `packages/vendors/src/elevenlabs.ts`

## Current Active Configuration

2026-04-07 時点の active mapping は以下です。

| scenarioId | activeProfileId |
| --- | --- |
| `staffing_order_hearing_busy_manager_medium` | `busy_manager_ja_primary_v3_f06` |

active profile の実値:

| field | value |
| --- | --- |
| `id` | `busy_manager_ja_primary_v3_f06` |
| `label` | `Busy Manager JA Primary V3 F06` |
| `language` | `ja` |
| `model` | `eleven_v3` |
| `voiceId` | `4lOQ7A2l7HPuG7UIHiKA` |
| `voiceName` | `Kyoko` |
| `firstMessageJa` | `ありがとうございます。お時間に限りがあると思うので、要点から確認させてください。` |
| `textNormalisationType` | `elevenlabs` |
| `voiceSettings.speed` | `0.96` |
| `voiceSettings.style` | `0` |
| `metadata.benchmarkStatus` | `approved` |

`voiceName` は last publish artifact の観測値です。workspace に preferred voice が無い場合は shared voice 追加または auto-resolve が走るため、将来も常に同名とは限りません。

ただし、2026-04-07 時点では ElevenLabs account 上に remote pronunciation dictionary が 0 件で、approved profile には `pronunciationDictionaryLocators` が未設定です。したがって current active profile は mapping 上は approved でも、production publish readiness としては block 中です。

## Profile Matrix

現在 repo に入っている主要な日本語 profile は以下です。

| profileId | tts model | voiceId | firstMessageJa | normalization | settings |
| --- | --- | --- | --- | --- | --- |
| `busy_manager_ja_baseline_v1` | `eleven_flash_v2_5` | `g6xIsTj2HwM6VR4iXFCw` | `お時間ありがとうございます。要点を確認しながら進めさせてください。` | `elevenlabs` | `stability=0.7`, `similarityBoost=0.82`, `speed=0.97`, `style=0`, `useSpeakerBoost=true` |
| `busy_manager_ja_multilingual_candidate_v1` | `eleven_multilingual_v2` | `g6xIsTj2HwM6VR4iXFCw` | `お時間ありがとうございます。要点を整理しながら進めていただけると助かります。` | `elevenlabs` | `stability=0.7`, `similarityBoost=0.82`, `speed=0.97`, `style=0`, `useSpeakerBoost=true` |
| `busy_manager_ja_v3_candidate_v1` | `eleven_v3` | `g6xIsTj2HwM6VR4iXFCw` | `ありがとうございます。お時間に限りがあると思うので、要点から確認させてください。` | `elevenlabs` | `speed=0.97`, `style=0` |
| `busy_manager_ja_primary_v3_f06` | `eleven_v3` | `4lOQ7A2l7HPuG7UIHiKA` | `ありがとうございます。お時間に限りがあると思うので、要点から確認させてください。` | `elevenlabs` | `speed=0.96`, `style=0` |
| `busy_manager_ja_fallback_v3_m03` | `eleven_v3` | `umjlutQo1p1XQpWffYUI` | `ありがとうございます。お時間に限りがあると思うので、要点から確認させてください。` | `elevenlabs` | `speed=0.96`, `style=0` |

最新の v3 shortlist run は `data/generated/voice-benchmark/ja-voice15-round2-v3-2026-04-07/` にあります。

## VoiceProfile Schema

`VoiceProfile` は以下を必須とします。

```ts
type VoiceProfile = {
  id: string;
  label: string;
  language: "ja";
  model: string;
  voiceId: string;
  firstMessageJa?: string;
  textNormalisationType: "system_prompt" | "elevenlabs";
  voiceSettings: {
    stability?: number;
    similarityBoost?: number;
    speed?: number;
    style?: number;
    useSpeakerBoost?: boolean;
  };
  pronunciationDictionaryLocators?: Array<{
    pronunciationDictionaryId: string;
    versionId: string;
  }>;
  metadata?: {
    personaKey?: string;
    scenarioIds?: string[];
    benchmarkStatus?: "candidate" | "approved" | "deprecated";
    notes?: string;
  };
};
```

validation ルール:

- `id`, `label`, `language`, `model`, `voiceId`, `voiceSettings` は必須
- `voiceId` は空文字不可
- `stability` は `0` から `1`
- `similarityBoost` は `0` から `1`
- `speed` は `0` より大きい
- `style` は `0` から `1`
- `pronunciationDictionaryLocators` は最大 3 件
- locator は `pronunciationDictionaryId` と `versionId` を両方必須

dictionary locator が欠落している場合は fail-closed とし、silent fallback は行いません。特に `metadata.benchmarkStatus=approved` の profile は、locator 未設定のまま publish / smoke / acceptance に進めない設計です。

## Resolution Order

publish / smoke / benchmark での解決順は以下です。

1. `scenario-map.json` から `scenarioId -> activeProfileId` を引く
2. 該当 profile JSON を load する
3. `resolveVoiceId()` で preferred voice の利用可否を確認する
4. profile が有効なら profile を publish / benchmark に使う
5. mapping が無い scenario だけ legacy fallback を使う

legacy fallback:

- `DEFAULT_ELEVEN_VOICE_ID`: legacy voice fallback
- `LEGACY_ELEVEN_TTS_MODEL`: `eleven_flash_v2_5`
- `DEFAULT_ELEVEN_MODEL`: agent の LLM fallback。TTS model ではない

## Mapping To ElevenLabs Agents API

agent 作成 / 更新では `packages/vendors/src/elevenlabs.ts` の `buildConversationConfig()` が唯一の変換点です。

| repo field | ElevenLabs payload |
| --- | --- |
| `firstMessageJa` | `agent.first_message` |
| `language` | `agent.language` |
| prompt 本文 | `agent.prompt.prompt` |
| knowledge base | `agent.prompt.knowledge_base` |
| `DEFAULT_ELEVEN_MODEL` | `llm.model` |
| `voiceProfile.model` | `tts.model_id` |
| `voiceId` | `tts.voice_id` |
| `language` | `tts.language_code` |
| `textNormalisationType` | `tts.text_normalisation_type` |
| `voiceSettings.stability` | `tts.stability` |
| `voiceSettings.similarityBoost` | `tts.similarity_boost` |
| `voiceSettings.speed` | `tts.speed` |
| `voiceSettings.style` | `tts.style` |
| `voiceSettings.useSpeakerBoost` | `tts.use_speaker_boost` |
| `pronunciationDictionaryLocators[]` | `tts.pronunciation_dictionary_locators[]` |

注意:

- snake_case 変換は vendors 層に閉じ込める
- repo 側では camelCase を維持する
- `ScenarioPack` 自体に voice 設定は埋め込まない
- publish 結果の追跡は `AgentBinding.voiceProfileId` と `data/generated/publish/*.json` で行う

## Mapping To Raw TTS Benchmark API

offline benchmark は `/v1/text-to-speech/{voiceId}` を使います。

送信項目:

- `text`
- `model_id`
- `language_code` if present
- `seed` if present
- `voice_settings`
- `pronunciation_dictionary_locators`
- text normalization flags

benchmark 出力先:

- `data/generated/voice-benchmark/<runId>/manifest.json`
- `data/generated/voice-benchmark/<runId>/summary.csv`
- `data/generated/voice-benchmark/<runId>/review-sheet.csv`
- `data/generated/voice-benchmark/<runId>/index.html`
- `data/generated/voice-benchmark/<runId>/audio/*.mp3`

## Normalization Rules

`textNormalisationType` の意味:

- `elevenlabs`: ElevenLabs 側の text normalization を使う
- `system_prompt`: system / prompt 側で読み方を寄せ、TTS 側の normalization を切る

raw TTS benchmark では model ごとに送信方法を分けます。

### Non-v3 Models

対象:

- `eleven_flash_v2_5`
- `eleven_multilingual_v2`

送信値:

```json
{
  "apply_text_normalization": "on",
  "apply_language_text_normalization": true
}
```

`system_prompt` 選択時:

```json
{
  "apply_text_normalization": "off",
  "apply_language_text_normalization": false
}
```

### `eleven_v3`

`eleven_v3` では `apply_language_text_normalization` を送ってはいけません。2026-04-07 に実際に `HTTP 400` を引いたため、v3 専用分岐を入れています。

`elevenlabs` 選択時:

```json
{
  "apply_text_normalization": "auto"
}
```

`system_prompt` 選択時:

```json
{
  "apply_text_normalization": "off"
}
```

## Pronunciation Dictionary Policy

2026-04-07 に `GET /v1/pronunciation-dictionaries?page_size=100` を確認した結果、`pronunciation_dictionaries=[]` でした。current profile では remote locator はまだ未設定です。local の元ファイルは `data/pronunciation/adecco-ja-business-v1.pls` を使います。

remote dictionary を profile に載せる条件:

- ElevenLabs 上で dictionary が作成済み
- `pronunciationDictionaryId` が確定している
- `versionId` が確定している
- shortlist / approved profile に紐づく読み補正である

approved profile に関する運用ルール:

- locator 未設定の approved profile は fail-open にしない
- `packages/scenario-engine/src/voiceProfiles.ts` の readiness check が publish / smoke 側で block する
- blocker は `pnpm smoke:eleven -- --preflight` と `pnpm verify:acceptance -- --preflight` にも出す

登録例:

```json
{
  "pronunciationDictionaryLocators": [
    {
      "pronunciationDictionaryId": "pdict_xxxxx",
      "versionId": "v1"
    }
  ]
}
```

## Manual Review Flow

確認フローは 3 段階です。

1. `pnpm voices:list` で workspace 利用可能 voice を棚卸しする
2. `pnpm benchmark:render -- --scenario staffing_order_hearing_busy_manager_medium --profile busy_manager_ja_baseline_v1 --profile busy_manager_ja_multilingual_candidate_v1 --profile busy_manager_ja_v3_candidate_v1 --seed 42` で offline 比較を作る
3. shortlist を publish して、opening line と 2 から 3 ターンを live で確認する

試聴の正本:

- 比較ページ: `data/generated/voice-benchmark/<runId>/index.html`
- 評価シート: `data/generated/voice-benchmark/<runId>/review-sheet.csv`
- publish snapshot: `data/generated/publish/staffing_order_hearing_busy_manager_medium.json`

## Environment Variables

ElevenLabs 周りで運用上重要な env は以下です。

| env | role |
| --- | --- |
| `ELEVENLABS_API_KEY` | ElevenLabs API 認証 |
| `DEFAULT_ELEVEN_VOICE_ID` | mapping が無い scenario の legacy fallback voice |
| `DEFAULT_ELEVEN_MODEL` | agent の LLM fallback |

補足:

- `DEFAULT_ELEVEN_VOICE_ID` は新設 profile 経路では正本ではない
- active profile がある scenario では `voiceProfile.model` が TTS model の正本
- `DEFAULT_ELEVEN_MODEL` は音声モデルではなく会話 LLM の設定

## Operational Notes

- `busy_manager_medium` の publish 主経路は env 直参照ではなく profile 解決を使う
- `AgentBinding` には最小限の追跡情報として `voiceProfileId` を持たせる
- 完全な snapshot は generated publish artifact に残す
- v3 は context-aware なので最終判断は live conversation を優先する
- offline benchmark は音声比較の正本だが、採用確定の正本は publish 後 live review

## Related Files

- `config/voice-profiles/scenario-map.json`
- `config/voice-profiles/busy_manager_ja_baseline_v1.json`
- `config/voice-profiles/busy_manager_ja_multilingual_candidate_v1.json`
- `config/voice-profiles/busy_manager_ja_v3_candidate_v1.json`
- `packages/domain/src/voiceProfile.ts`
- `packages/scenario-engine/src/voiceProfiles.ts`
- `packages/scenario-engine/src/benchmarkRenderer.ts`
- `packages/vendors/src/elevenlabs.ts`
- `docs/VOICE_PROFILE_SCHEMA.md`
- `docs/VOICE_TUNING_RUNBOOK.md`
