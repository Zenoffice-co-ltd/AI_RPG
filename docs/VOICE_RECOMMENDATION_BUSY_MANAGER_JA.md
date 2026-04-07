# Busy Manager Japanese Voice Recommendation

この文書は、`busy_manager_medium` の採用 voice を確定するための記録です。

## Final Decision

- primary profile: `busy_manager_ja_primary_v3_f06`
- fallback profile: `busy_manager_ja_fallback_v3_m03`
- active scenario mapping: `staffing_order_hearing_busy_manager_medium -> busy_manager_ja_primary_v3_f06`
- decision date: `2026-04-07`

## Approved Profiles

### Primary

- candidate: `F06`
- profileId: `busy_manager_ja_primary_v3_f06`
- voiceId: `4lOQ7A2l7HPuG7UIHiKA`
- voiceName: `Kyoko`
- model: `eleven_v3`
- firstMessageJa: `ありがとうございます。お時間に限りがあると思うので、要点から確認させてください。`
- textNormalisationType: `elevenlabs`
- settings: `speed=0.96`, `style=0`

### Fallback

- candidate: `M03`
- profileId: `busy_manager_ja_fallback_v3_m03`
- voiceId: `umjlutQo1p1XQpWffYUI`
- voiceName: `ken`
- model: `eleven_v3`
- firstMessageJa: `ありがとうございます。お時間に限りがあると思うので、要点から確認させてください。`
- textNormalisationType: `elevenlabs`
- settings: `speed=0.96`, `style=0`

## Selection Notes

- Round 1 は `eleven_multilingual_v2` 固定で 15 候補を比較した
- Round 2 では shortlist を `v3` に展開し、`F06`, `M03`, `F05`, `M06`, `R02` と initial voice-id control を聴き比べた
- 最終採用は `F06`、バックアップは `M03`
- `R01` から `R03` は引き続き rescue track として保持するが、採用 profile にはしない

## Rejected Finalists

- `F05` `Z5Rahxh8jMhJKEgBfCSS` `Yukiko`
- `M06` `TgOeD7klye637sG2MesF` `Hiro`
- `R02` `JR1hjFne0jQEA059Vyez` `Kuya`

## Why These Won

- `F06` は busy manager の距離感を保ちながら、硬すぎず電話口で聞きやすい
- `M03` は fallback として安定感が高く、primary 不使用時でも違和感が小さい
- 両者とも `eleven_v3` で数字・固有名詞・締めの一言の自然さが高かった

## Residual Risks

- `eleven_v3` は context-aware なので、offline benchmark と live 会話の印象差は今後も注意する
- pronunciation dictionary locator は profile にはまだ載せていないため、将来の本番読み補正は別途 ElevenLabs 側 dictionary 登録が必要
- rescue track は explicit Voice Design の再評価余地を残している

## Related Files

- active mapping: `config/voice-profiles/scenario-map.json`
- primary profile: `config/voice-profiles/busy_manager_ja_primary_v3_f06.json`
- fallback profile: `config/voice-profiles/busy_manager_ja_fallback_v3_m03.json`
- cohort: `config/voice-profiles/ja_voice_variations/cohort.json`
- v3 benchmark run: `data/generated/voice-benchmark/ja-voice15-round2-v3-2026-04-07/`
