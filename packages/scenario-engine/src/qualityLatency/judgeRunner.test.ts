import { describe, expect, it } from "vitest";
import {
  type JudgeStructuredClient,
  judgeOneRow,
} from "./judgeRunner";
import type { JudgeResponse } from "./judgeRubric";
import type { QualityLatencyCase, QualityLatencyRow } from "./types";

const caseDef: QualityLatencyCase = {
  id: "ql_001",
  category: "short_ack",
  userInput: "はい、お願いします。",
  expectedLength: "short",
  scoringNotes: "test",
};

function row(): QualityLatencyRow {
  return {
    runId: "r",
    timestamp: "t",
    provider: "openai",
    model: "gpt-test",
    modelCategory: "general-fast",
    reasoningEffort: "",
    caseId: caseDef.id,
    caseCategory: caseDef.category,
    userInput: caseDef.userInput,
    repeatIndex: 1,
    status: "success",
    llmRequestToFirstTokenMs: 100,
    llmRequestToFirstSentenceMs: 200,
    llmRequestToDoneMs: 400,
    llmOutputChars: 10,
    llmOutputSentences: 1,
    llmOutputCharsPerSec: 25,
    firstSentenceText: "はい、承知しました。",
    responseText: "はい、承知しました。",
    temperature: 0.2,
    maxOutputTokens: 200,
    seed: null,
    errorCode: "",
    errorMessage: "",
    vendorRequestId: "",
  };
}

const sample: JudgeResponse = {
  overallScore: 80,
  intentFit: 22,
  businessCorrectness: 18,
  nextAction: 12,
  conciseness: 14,
  japaneseNaturalness: 13,
  voiceReadiness: 9,
  penalties: [],
  knockout: false,
  knockoutReason: null,
  shortRationale: "OK",
};

describe("judgeOneRow", () => {
  it("returns a populated row when judge succeeds", async () => {
    const client: JudgeStructuredClient = {
      judge: async () => sample,
    };
    const result = await judgeOneRow({
      judgeProvider: "anthropic",
      judgeModel: "claude-sonnet",
      judgeClient: client,
      row: row(),
      caseDef,
    });
    expect(result.status).toBe("success");
    expect(result.overallScore).toBe(80);
    expect(result.shortRationale).toBe("OK");
  });

  it("returns failed row on persistent error", async () => {
    const client: JudgeStructuredClient = {
      judge: async () => {
        throw new Error("network down");
      },
    };
    const result = await judgeOneRow({
      judgeProvider: "openai",
      judgeModel: "gpt-4.1",
      judgeClient: client,
      row: row(),
      caseDef,
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("network down");
    expect(result.overallScore).toBeNull();
  });

  it("does not include candidate model name in user prompt", async () => {
    let seenPrompt = "";
    const client: JudgeStructuredClient = {
      judge: async (args) => {
        seenPrompt = args.userPrompt;
        return sample;
      },
    };
    await judgeOneRow({
      judgeProvider: "anthropic",
      judgeModel: "claude-sonnet",
      judgeClient: client,
      row: row(),
      caseDef,
    });
    expect(seenPrompt).not.toContain("openai");
    expect(seenPrompt).not.toContain("gpt-test");
  });
});
