# Voice Profile Schema

schema の要点はこのファイル、運用込みの ElevenLabs 仕様は `docs/ELEVENLABS_VOICE_SPEC.md` を参照してください。

このドキュメントは、ElevenLabs 日本語音声の profile を repo でどう扱うかを定義します。

## 目的

- scenario ごとに voice を明示的に選べるようにする
- publish 経路で voice / model / normalization / dictionary を一箇所で解決する
- legacy fallback を残しつつ、将来の per-scenario 運用に耐えさせる

## VoiceProfile

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

## 解決順

1. `scenarioId -> activeProfileId` mapping を読む
2. profile をロードする
3. profile があればそれを publish に使う
4. profile がない場合のみ legacy fallback に落とす

## バリデーション

- `id`, `label`, `language`, `model`, `voiceId` は必須
- `voiceId` は空文字不可
- `voiceSettings.speed` は 0 より大きい
- `stability` は 0 から 1 の範囲
- `similarityBoost` は 0 から 1 の範囲
- `style` は 0 から 1 の範囲
- `pronunciationDictionaryLocators` の各要素は `pronunciationDictionaryId` と `versionId` を必須にする

## 既定値

- `busy_manager_medium` の初期値は `language: ja`
- `textNormalisationType` は `elevenlabs`
- first message は短く、忙しいが不機嫌ではない日本語
- dictionary は alias ベース

## 追跡先

- publish 結果は `data/generated/publish/*.json`
- active profile の正本は `config/voice-profiles/`
- benchmark との比較結果は `data/generated/voice-benchmark/<runId>/`
