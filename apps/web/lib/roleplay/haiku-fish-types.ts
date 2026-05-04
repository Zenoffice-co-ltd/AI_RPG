"use client";

export type HaikuFishSseEvent =
  | { event: "status"; data: { status: "thinking" } }
  | { event: "agent_text_delta"; data: { text: string } }
  | { event: "agent_first_sentence"; data: { text: string } }
  | {
      event: "audio_chunk";
      data: { format: string; sampleRateHz: number; base64: string };
    }
  | { event: "agent_text_final"; data: { text: string } }
  | { event: "metrics"; data: HaikuFishTurnMetricsClient }
  | { event: "error"; data: { scope: string; code: string; message?: string } }
  | { event: "done"; data: Record<string, never> };

export type HaikuFishTurnMetricsClient = {
  sessionId: string;
  turnIndex: number;
  inputMode: "text" | "voice";
  userTextLength: number;
  llmFirstTokenMs: number | null;
  llmFirstSentenceMs: number | null;
  llmDoneMs: number | null;
  ttsFirstAudioMs: number | null;
  ttsDoneMs: number | null;
  e2eFirstAudioMs: number | null;
  e2eDoneMs: number | null;
  sttFirstPartialMs: number | null;
  sttFinalMs: number | null;
  responseText: string;
  audioBytes: number;
  error: string | null;
};

export type HaikuFishSession = {
  sessionId: string;
  scenarioId: string;
  backend: "claude-haiku-fish";
  promptVersion: string;
  firstMessage: string;
};

export const HAIKU_FISH_BACKEND_BADGE = "Backend: Claude Haiku 4.5 + Fish Audio";
