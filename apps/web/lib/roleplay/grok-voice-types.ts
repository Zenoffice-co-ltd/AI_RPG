"use client";

export type GrokVoiceMicState = "idle" | "listening" | "speaking" | "paused";

export type GrokVoiceTurnDetectionConfig = {
  type: "server_vad" | null;
  threshold?: number;
  silence_duration_ms?: number;
  prefix_padding_ms?: number;
};

export type GrokVoiceAudioConfig = {
  inputFormat: string; // e.g. "audio/pcm"
  outputFormat: string;
  sampleRate: number; // Hz
};

// What the server returns from POST /api/v3/session — the API key is
// never present here; only a short-lived ephemeral token plus metadata the
// client needs to open the WebSocket and configure the session.
export type GrokVoiceSession = {
  sessionId: string;
  scenarioId: string;
  backend: "grok-voice-think-fast";
  promptVersion: string;
  promptHash: string;
  guardrailVersion: string;
  grokVoiceModel: string;
  grokVoiceVoiceId: string;
  wsUrl: string;
  ephemeralToken: string;
  ephemeralExpiresAt: string;
  audio: GrokVoiceAudioConfig;
  turnDetection: GrokVoiceTurnDetectionConfig;
  instructions: string;
  firstMessage: string;
};

export type GrokVoiceTurnMetricsClient = {
  sessionId: string;
  turnIndex: number;
  inputMode: "voice" | "text";
  userTextLen: number;
  agentTextLen: number;
  firstAudioMs: number | null;
  doneMs: number | null;
  audioBytes: number;
  error: string | null;
  promptHash: string;
  promptVersion: string;
  guardrailVersion: string;
  grokVoiceModel: string;
  grokVoiceVoiceId: string;
};

// Subset of xAI Voice Agent server → client events that we react to.
// Reference: https://docs.x.ai/developers/model-capabilities/audio/voice-agent
export type GrokVoiceServerEvent =
  | { type: "session.created"; session?: unknown }
  | { type: "session.updated"; session?: unknown }
  | { type: "response.created"; response?: unknown }
  | { type: "response.output_audio.delta"; delta: string; item_id?: string }
  | { type: "response.output_audio_transcript.delta"; delta: string; item_id?: string }
  | { type: "response.text.delta"; delta: string; item_id?: string }
  | { type: "response.audio_transcript.delta"; delta: string; item_id?: string }
  | {
      type: "conversation.item.input_audio_transcription.completed";
      transcript: string;
      item_id?: string;
      // xAI returns confidence on completion when available.
      logprobs?: unknown;
    }
  | {
      type: "conversation.item.input_audio_transcription.failed";
      error?: { message?: string };
    }
  | { type: "response.done"; response?: unknown }
  | { type: "input_audio_buffer.speech_started" }
  | { type: "input_audio_buffer.speech_stopped" }
  | { type: "input_audio_buffer.committed" }
  | { type: "error"; error: { message?: string; code?: string; type?: string } };
