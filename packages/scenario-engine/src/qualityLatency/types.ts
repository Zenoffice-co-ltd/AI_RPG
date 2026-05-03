import type { TtsProviderId } from "@top-performer/vendors";

export type QualityCaseCategory =
  | "short_ack"
  | "busy_manager"
  | "condition_hearing"
  | "budget"
  | "objection"
  | "ambiguous"
  | "english_mixed"
  | "long_context"
  | "numbers_dates"
  | "competitor"
  | "next_action"
  | "safety_no_hallucination";

export type QualityLatencyCase = {
  id: string;
  category: QualityCaseCategory;
  userInput: string;
  expectedLength: "short" | "medium" | "long";
  mustInclude?: readonly string[];
  shouldInclude?: readonly string[];
  mustNotInclude?: readonly string[];
  referenceAnswer?: string;
  scoringNotes: string;
};

export type QualityLatencyRow = {
  runId: string;
  timestamp: string;
  provider: string;
  model: string;
  modelCategory: string;
  reasoningEffort: string;
  caseId: string;
  caseCategory: string;
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

export type RuleScoreRow = {
  runId: string;
  caseId: string;
  provider: string;
  model: string;
  repeatIndex: number;
  responseChars: number;
  responseSentences: number;
  tooLong: boolean;
  hasBullet: boolean;
  hasMetaLeak: boolean;
  missingMustInclude: string;
  containsMustNotInclude: string;
  hasUnsupportedClaim: boolean;
  voiceUnfriendlySymbols: boolean;
  rulePenalty: number;
  rulePass: boolean;
  knockout: boolean;
};

export type JudgeScoreRow = {
  runId: string;
  caseId: string;
  candidateProvider: string;
  candidateModel: string;
  repeatIndex: number;
  judgeProvider: string;
  judgeModel: string;
  status: "success" | "failed";
  overallScore: number | null;
  intentFit: number | null;
  businessCorrectness: number | null;
  nextAction: number | null;
  conciseness: number | null;
  japaneseNaturalness: number | null;
  voiceReadiness: number | null;
  penalties: string;
  knockout: boolean;
  knockoutReason: string;
  shortRationale: string;
  errorMessage: string;
};

export type PairwiseRow = {
  runId: string;
  caseId: string;
  repeatIndex: number;
  judgeProvider: string;
  judgeModel: string;
  leftAnonymousId: string;
  leftProvider: string;
  leftModel: string;
  rightAnonymousId: string;
  rightProvider: string;
  rightModel: string;
  winner: "left" | "right" | "tie" | "error";
  reason: string;
  errorMessage: string;
};

export type E2eRow = {
  runId: string;
  llmProvider: string;
  llmModel: string;
  /**
   * Either a registered TtsProviderId, an empty string (LLM-only rows), or a
   * virtual identifier for native-voice lanes such as "elevenlabs" (ConvAI agent).
   */
  ttsProvider: TtsProviderId | "" | "elevenlabs";
  ttsModel: string;
  voiceId: string;
  mode: "first-sentence" | "full-text";
  caseId: string;
  repeatIndex: number;
  status: "success" | "failed";
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
  ttsRequestToFirstAudioMs: number | null;
  ttsRequestToDoneMs: number | null;
  audioDurationMs: number | null;
  rtf: number | null;
  firstAudioAvailable: boolean;
  e2eFirstAudioMs: number | null;
  e2eDoneMs: number | null;
  overlapGainMs: number | null;
  ttsInputMode: string;
  ttsInputChars: number | null;
  qualityScore: number | null;
  rulePass: boolean | null;
  knockout: boolean | null;
  outputFile: string;
  errorCode: string;
  errorMessage: string;
  vendorRequestId: string;
};

export type FrontierTier = 1 | 2 | "dominated";

export type FrontierPoint = {
  llmProvider: string;
  llmModel: string;
  ttsProvider: string;
  mode: string;
  total: number;
  successRate: number;
  rulePassRate: number;
  knockoutRate: number;
  avgQualityScore: number;
  p50E2eFirstAudioMs: number | null;
  p90E2eFirstAudioMs: number | null;
  p50E2eDoneMs: number | null;
  p90E2eDoneMs: number | null;
  paretoTier: FrontierTier;
  compositeScore: number;
};
