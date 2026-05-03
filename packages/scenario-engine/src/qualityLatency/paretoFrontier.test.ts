import { describe, expect, it } from "vitest";
import { computeFrontier } from "./paretoFrontier";
import type { E2eRow, JudgeScoreRow } from "./types";

function e2e(overrides: Partial<E2eRow>): E2eRow {
  return {
    runId: "r",
    llmProvider: "openai",
    llmModel: "gpt-test",
    ttsProvider: "cartesia",
    ttsModel: "sonic-3",
    voiceId: "v",
    mode: "first-sentence",
    caseId: "ql_001",
    repeatIndex: 1,
    status: "success",
    llmRequestToFirstSentenceMs: 500,
    llmRequestToDoneMs: 1000,
    ttsRequestToFirstAudioMs: 300,
    ttsRequestToDoneMs: 800,
    audioDurationMs: 1500,
    rtf: 0.5,
    firstAudioAvailable: true,
    e2eFirstAudioMs: 800,
    e2eDoneMs: 1800,
    overlapGainMs: null,
    ttsInputMode: "first-sentence",
    ttsInputChars: 30,
    qualityScore: 80,
    rulePass: true,
    knockout: false,
    outputFile: "",
    errorCode: "",
    errorMessage: "",
    vendorRequestId: "",
    ...overrides,
  };
}

function judge(overrides: Partial<JudgeScoreRow>): JudgeScoreRow {
  return {
    runId: "r",
    caseId: "ql_001",
    candidateProvider: "openai",
    candidateModel: "gpt-test",
    repeatIndex: 1,
    judgeProvider: "anthropic",
    judgeModel: "claude-sonnet",
    status: "success",
    overallScore: 80,
    intentFit: 20,
    businessCorrectness: 18,
    nextAction: 12,
    conciseness: 12,
    japaneseNaturalness: 13,
    voiceReadiness: 8,
    penalties: "",
    knockout: false,
    knockoutReason: "",
    shortRationale: "",
    errorMessage: "",
    ...overrides,
  };
}

describe("computeFrontier", () => {
  it("marks faster + higher quality point as Tier 1, slower + lower as dominated", () => {
    const fast = e2e({ llmModel: "fast", e2eFirstAudioMs: 700, e2eDoneMs: 1500 });
    const slow = e2e({ llmModel: "slow", e2eFirstAudioMs: 1500, e2eDoneMs: 3000 });
    const judges = [
      judge({ candidateModel: "fast", overallScore: 90 }),
      judge({ candidateModel: "slow", overallScore: 60 }),
    ];
    const points = computeFrontier({
      e2eRows: [fast, slow],
      judgeRows: judges,
      ruleRows: [],
    });
    const fastPoint = points.find((p) => p.llmModel === "fast")!;
    const slowPoint = points.find((p) => p.llmModel === "slow")!;
    expect(fastPoint.paretoTier).toBe(1);
    expect(slowPoint.paretoTier).toBe("dominated");
  });

  it("keeps both as Tier 1 when one is faster but lower quality (trade-off)", () => {
    const fast = e2e({ llmModel: "fast", e2eFirstAudioMs: 600, e2eDoneMs: 1400 });
    const quality = e2e({
      llmModel: "quality",
      e2eFirstAudioMs: 1400,
      e2eDoneMs: 2400,
    });
    const judges = [
      judge({ candidateModel: "fast", overallScore: 70 }),
      judge({ candidateModel: "quality", overallScore: 95 }),
    ];
    const points = computeFrontier({
      e2eRows: [fast, quality],
      judgeRows: judges,
      ruleRows: [],
    });
    expect(points.find((p) => p.llmModel === "fast")?.paretoTier).toBe(1);
    expect(points.find((p) => p.llmModel === "quality")?.paretoTier).toBe(1);
  });

  it("computes composite score in [0,1] range", () => {
    const fast = e2e({ llmModel: "fast", e2eFirstAudioMs: 700, e2eDoneMs: 1500 });
    const slow = e2e({ llmModel: "slow", e2eFirstAudioMs: 1500, e2eDoneMs: 3000 });
    const points = computeFrontier({
      e2eRows: [fast, slow],
      judgeRows: [
        judge({ candidateModel: "fast", overallScore: 90 }),
        judge({ candidateModel: "slow", overallScore: 60 }),
      ],
      ruleRows: [],
    });
    for (const p of points) {
      expect(p.compositeScore).toBeGreaterThanOrEqual(0);
      expect(p.compositeScore).toBeLessThanOrEqual(1);
    }
  });
});
