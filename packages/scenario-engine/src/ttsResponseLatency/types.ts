import type { TtsProviderId } from "@top-performer/vendors";

export type ResponseLatencyMode = "llm-only" | "full-text" | "first-sentence";

export type LlmProviderId = "openai";

export type TtsInputMode = "" | "full-text" | "first-sentence";

export type ResponseLatencyRow = {
  runId: string;
  timestamp: string;
  mode: ResponseLatencyMode;
  llmProvider: LlmProviderId;
  llmModel: string;
  systemPromptVersion: string;
  ttsProvider: TtsProviderId | "";
  ttsModel: string;
  voiceId: string;
  caseId: string;
  category: string;
  userInput: string;
  repeatIndex: number;
  status: "success" | "failed";

  llmCacheHit: boolean;
  llmCacheKey: string;
  llmLatencyFresh: boolean;

  llmRequestToFirstTokenMs: number | null;
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
  llmOutputChars: number | null;
  llmOutputSentences: number | null;

  ttsInputMode: TtsInputMode;
  ttsInputText: string;
  ttsInputChars: number | null;
  ttsRequestToFirstAudioMs: number | null;
  ttsRequestToDoneMs: number | null;
  audioDurationMs: number | null;
  rtf: number | null;
  firstAudioAvailable: boolean;

  e2eFirstAudioMs: number | null;
  e2eDoneMs: number | null;
  overlapGainMs: number | null;

  firstSentenceText: string;
  responseText: string;

  outputFile: string;
  errorCode: string;
  errorMessage: string;
  vendorRequestId: string;
};

export type ResponseLatencySummary = {
  mode: ResponseLatencyMode;
  llmProvider: LlmProviderId;
  llmModel: string;
  ttsProvider: TtsProviderId | "";
  ttsModel: string;
  voiceId: string;

  total: number;
  success: number;
  failed: number;
  successRate: number;

  freshLlmRows: number;

  p50LlmFirstTokenMs: number | null;
  p90LlmFirstTokenMs: number | null;
  p50LlmFirstSentenceMs: number | null;
  p90LlmFirstSentenceMs: number | null;
  p50LlmDoneMs: number | null;
  p90LlmDoneMs: number | null;

  p50TtsFirstAudioMs: number | null;
  p90TtsFirstAudioMs: number | null;
  p50TtsDoneMs: number | null;
  p90TtsDoneMs: number | null;

  p50E2eFirstAudioMs: number | null;
  p90E2eFirstAudioMs: number | null;
  p50E2eDoneMs: number | null;
  p90E2eDoneMs: number | null;

  p50OverlapGainMs: number | null;
  p90OverlapGainMs: number | null;

  firstAudioAvailable: boolean;
};
