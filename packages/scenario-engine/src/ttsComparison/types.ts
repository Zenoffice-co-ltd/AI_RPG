import type { TtsProviderId } from "@top-performer/vendors";

export type BenchmarkMode = "warm" | "cold";

export type BenchmarkRow = {
  runId: string;
  timestamp: string;
  provider: TtsProviderId;
  providerHiddenId: string;
  model: string;
  voiceId: string;
  utteranceId: string;
  utterance: string;
  category: string;
  repeatIndex: number;
  mode: BenchmarkMode;
  textLength: number;
  status: "success" | "failed";
  requestToFirstAudioMs: number | null;
  requestToLastAudioMs: number | null;
  audioDurationMs: number | null;
  rtf: number | null;
  bytes: number;
  sampleRateHz: number;
  format: string;
  outputFile: string;
  errorCode: string;
  errorMessage: string;
  vendorRequestId: string;
  appliedNormalizationRules: string[];
};

export type ProviderSummary = {
  provider: TtsProviderId;
  model: string;
  voiceId: string;
  total: number;
  success: number;
  failed: number;
  successRate: number;
  firstAudioAvailable: boolean;
  p50FirstAudioMs: number | null;
  p90FirstAudioMs: number | null;
  p50TotalMs: number | null;
  p90TotalMs: number | null;
  p50Rtf: number | null;
  p90Rtf: number | null;
};
