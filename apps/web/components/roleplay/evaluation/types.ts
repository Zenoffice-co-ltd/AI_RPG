export type AdeccoBrowserEvaluationStatus =
  | "not_found"
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type AdeccoBrowserEvaluationScorecard = {
  evaluationFormat: "adecco_order_hearing_browser_v1";
  evaluationProfile?: "adecco_order_hearing_eval_v2";
  runtimeVersion?: "v50-7" | "v51";
  scenarioId: string;
  metadata: {
    sessionId: string;
    conversationId: string | null;
    startedAt: string;
    endedAt: string;
  };
  report: Record<string, unknown>;
  model: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  };
  validation: {
    ok: boolean;
    status: string;
  };
  retryNote: string;
  generatedAt: string;
};

export type AdeccoBrowserEvaluationResult =
  | {
      ok: true;
      status: "not_found" | "queued" | "running";
      sessionId: string;
    }
  | {
      ok: true;
      status: "completed";
      sessionId: string;
      scorecard: AdeccoBrowserEvaluationScorecard;
    }
  | {
      ok: false;
      status: "failed";
      sessionId: string;
      error: string;
      retryAvailable?: boolean;
    };
