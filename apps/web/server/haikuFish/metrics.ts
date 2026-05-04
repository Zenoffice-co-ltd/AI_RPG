export type HaikuFishTurnMetricsProvenance = {
  promptVersion: string;
  agentSystemPromptHash: string;
  knowledgeBaseTextHash: string;
  promptSectionsHash: string;
  guardrailVersion: string;
};

export type HaikuFishTurnMetrics = {
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
  provenance: HaikuFishTurnMetricsProvenance | null;
};

export function buildEmptyTurnMetrics(
  init: Pick<HaikuFishTurnMetrics, "sessionId" | "turnIndex" | "inputMode" | "userTextLength">
): HaikuFishTurnMetrics {
  return {
    ...init,
    llmFirstTokenMs: null,
    llmFirstSentenceMs: null,
    llmDoneMs: null,
    ttsFirstAudioMs: null,
    ttsDoneMs: null,
    e2eFirstAudioMs: null,
    e2eDoneMs: null,
    sttFirstPartialMs: null,
    sttFinalMs: null,
    responseText: "",
    audioBytes: 0,
    error: null,
    provenance: null,
  };
}

export function logHaikuFishTurnMetrics(metrics: HaikuFishTurnMetrics) {
  // Single-line JSON for log aggregators (Cloud Logging picks up structured payloads).
  console.log(
    JSON.stringify({
      scope: "haikuFish.turnMetrics",
      ...metrics,
    })
  );
}
