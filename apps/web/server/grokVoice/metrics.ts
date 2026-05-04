// Structured logging for the Grok Voice (`xai`/`grok-voice-think-fast-1.0`)
// roleplay backend. All payloads are emitted as a single line of JSON so that
// Cloud Logging picks them up via `jsonPayload.scope=~"^grokVoice\\."`.

export type GrokVoiceProvenance = {
  promptVersion: string;
  agentSystemPromptHash: string;
  knowledgeBaseTextHash: string;
  promptSectionsHash: string;
  guardrailVersion: string;
  grokVoiceModel: string;
  grokVoiceVoiceId: string;
};

type LogPayload = Record<string, unknown>;

function emit(scope: string, payload: LogPayload) {
  console.log(JSON.stringify({ scope, ...payload }));
}

export function logGrokVoiceSessionCreated(payload: {
  sessionId: string;
  ephemeralExpiresAt: string;
  provenance: GrokVoiceProvenance;
}) {
  emit("grokVoice.session.created", {
    sessionId: payload.sessionId,
    ephemeralExpiresAt: payload.ephemeralExpiresAt,
    ...payload.provenance,
  });
}

export function logGrokVoiceClientEvent(payload: {
  kind: string;
  sessionId: string | null;
  details: Record<string, unknown>;
  ip: string;
}) {
  emit("grokVoice.clientEvent", payload);
}

export function logGrokVoiceTurnMetrics(payload: {
  sessionId: string;
  turnIndex: number;
  inputMode: "voice" | "text";
  userTextLen: number;
  agentTextLen: number;
  firstAudioMs: number | null;
  doneMs: number | null;
  audioBytes: number;
  error: string | null;
  provenance: GrokVoiceProvenance;
}) {
  emit("grokVoice.turnMetrics", {
    sessionId: payload.sessionId,
    turnIndex: payload.turnIndex,
    inputMode: payload.inputMode,
    userTextLen: payload.userTextLen,
    agentTextLen: payload.agentTextLen,
    firstAudioMs: payload.firstAudioMs,
    doneMs: payload.doneMs,
    audioBytes: payload.audioBytes,
    error: payload.error,
    ...payload.provenance,
  });
}

export function logGrokVoiceStt(payload: {
  sessionId: string | null;
  turnIndex: number | null;
  textLen: number;
  confidence: number | null;
  vendorMs: number | null;
}) {
  emit("grokVoice.stt", payload);
}

export function logGrokVoiceSttSkipped(payload: {
  sessionId: string | null;
  turnIndex: number | null;
  reason: string;
}) {
  emit("grokVoice.stt.skipped", payload);
}

export function logGrokVoiceMicState(payload: {
  sessionId: string | null;
  from: string;
  to: string;
  durationMs: number | null;
}) {
  emit("grokVoice.mic.state", payload);
}
