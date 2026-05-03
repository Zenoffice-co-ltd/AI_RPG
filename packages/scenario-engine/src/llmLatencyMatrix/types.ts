import type { ReasoningEffort } from "@top-performer/vendors";

export type LlmMatrixProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "zai"
  | "inworld";

export type ModelCategory = "general-fast" | "general-mid" | "reasoning";

export type ModelDefinition = {
  id: string;
  provider: LlmMatrixProvider;
  model: string;
  category: ModelCategory;
  defaultReasoningEffort?: ReasoningEffort;
  notes?: string;
};

export type LlmMatrixMode = "llm-only";

export type LlmMatrixRow = {
  runId: string;
  timestamp: string;
  provider: LlmMatrixProvider;
  model: string;
  modelCategory: ModelCategory;
  reasoningEffort: ReasoningEffort | "";
  caseId: string;
  category: string;
  userInput: string;
  repeatIndex: number;
  status: "success" | "failed";
  llmRequestToFirstTokenMs: number | null;
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
  llmOutputChars: number | null;
  llmOutputSentences: number | null;
  llmOutputCharsPerSec: number | null;
  firstSentenceText: string;
  responseText: string;
  temperature: number | null;
  maxOutputTokens: number | null;
  seed: number | null;
  errorCode: string;
  errorMessage: string;
  vendorRequestId: string;
};

export type LlmMatrixSummary = {
  provider: LlmMatrixProvider;
  model: string;
  modelCategory: ModelCategory;
  reasoningEffort: ReasoningEffort | "";
  total: number;
  success: number;
  failed: number;
  successRate: number;
  p50FirstTokenMs: number | null;
  p90FirstTokenMs: number | null;
  p50FirstSentenceMs: number | null;
  p90FirstSentenceMs: number | null;
  p50DoneMs: number | null;
  p90DoneMs: number | null;
  p50CharsPerSec: number | null;
  p90CharsPerSec: number | null;
};
