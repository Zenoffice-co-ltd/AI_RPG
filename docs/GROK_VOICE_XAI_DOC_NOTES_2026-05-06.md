# Grok Voice xAI Doc Notes

Checked on: 2026-05-06

## Official xAI Docs Read

- Voice Agent API: https://docs.x.ai/developers/model-capabilities/audio/voice-agent
- Voice REST reference: https://docs.x.ai/developers/rest-api-reference/inference/voice
- Ephemeral Tokens: https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens
- Text to Speech: https://docs.x.ai/developers/model-capabilities/audio/text-to-speech

## Realtime Specs Used

- Browser clients authenticate to `wss://api.x.ai/v1/realtime` with an ephemeral token in the WebSocket subprotocol using the `xai-client-secret.` prefix. The xAI API key stays server-side.
- Realtime session configuration is sent after connection with `session.update`, including `instructions`, `voice`, `turn_detection`, and audio input/output format.
- User text turns use `conversation.item.create` with `role: "user"` and content type `input_text`, followed by `response.create` only when the client wants Grok to generate a response.
- Assistant history seeding uses `conversation.item.create` with `role: "assistant"` and content type `output_text`; no `response.create` is needed for history-only sync.
- `response.cancel` cancels an in-progress response. This PR uses it for barge-in and for preventing Realtime output from racing deterministic locked-response TTS.
- Relevant server event order includes `conversation.item.input_audio_transcription.completed`, `response.created`, `response.output_audio.delta`, `response.output_audio_transcript.delta`, and `response.done`. The REST reference states `response.done` is sent after audio and transcript deltas.
- Audio stays 24 kHz PCM for both Realtime output and browser playback.

## Text-To-Speech Specs Used

- REST TTS endpoint: `POST https://api.x.ai/v1/tts`.
- Request fields used by this PR:
  - `text`
  - `voice_id`
  - `language: "ja"`
  - `output_format: { codec: "pcm", sample_rate: 24000 }`
  - `optimize_streaming_latency: 1`
- The Text to Speech docs currently list `optimize_streaming_latency` as an integer field with accepted values `0` and `1`; `1` lowers time-to-first-audio with a minor quality tradeoff at chunk boundaries. Because this was verified in official docs on 2026-05-06, this PR includes it and bakes that choice into the TTS cache request-shape version.
- xAI also documents a streaming TTS WebSocket at `wss://api.x.ai/v1/tts`, but this PR does not implement it. The current implementation remains server-side REST TTS with caching and does not expose the xAI API key to the browser.

