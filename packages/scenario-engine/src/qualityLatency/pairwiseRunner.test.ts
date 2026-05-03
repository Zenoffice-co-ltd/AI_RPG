import { describe, expect, it } from "vitest";
import { aggregatePairwise, decidePairOrdering } from "./pairwiseRunner";
import type { PairwiseRow, QualityLatencyRow } from "./types";

function row(provider: string, model: string): QualityLatencyRow {
  return {
    runId: "r",
    timestamp: "t",
    provider,
    model,
    modelCategory: "general-fast",
    reasoningEffort: "",
    caseId: "ql_001",
    caseCategory: "short_ack",
    userInput: "x",
    repeatIndex: 1,
    status: "success",
    llmRequestToFirstTokenMs: 100,
    llmRequestToFirstSentenceMs: 200,
    llmRequestToDoneMs: 400,
    llmOutputChars: 10,
    llmOutputSentences: 1,
    llmOutputCharsPerSec: 25,
    firstSentenceText: "x",
    responseText: "x",
    temperature: 0.2,
    maxOutputTokens: 200,
    seed: null,
    errorCode: "",
    errorMessage: "",
    vendorRequestId: "",
  };
}

function pwRow(overrides: Partial<PairwiseRow>): PairwiseRow {
  return {
    runId: "r",
    caseId: "ql_001",
    repeatIndex: 1,
    judgeProvider: "anthropic",
    judgeModel: "claude-sonnet",
    leftAnonymousId: "L",
    leftProvider: "openai",
    leftModel: "A",
    rightAnonymousId: "R",
    rightProvider: "openai",
    rightModel: "B",
    winner: "left",
    reason: "",
    errorMessage: "",
    ...overrides,
  };
}

describe("decidePairOrdering", () => {
  it("returns deterministic ordering for the same inputs", () => {
    const a = row("openai", "A");
    const b = row("openai", "B");
    const r1 = decidePairOrdering(a, b);
    const r2 = decidePairOrdering(a, b);
    expect(r1.left.model).toBe(r2.left.model);
  });
});

describe("aggregatePairwise", () => {
  it("counts wins/losses/ties and assigns higher btScore to the winner", () => {
    const rows: PairwiseRow[] = [
      pwRow({ leftModel: "A", rightModel: "B", winner: "left" }),
      pwRow({ leftModel: "A", rightModel: "B", winner: "left" }),
      pwRow({ leftModel: "A", rightModel: "B", winner: "right" }),
      pwRow({ leftModel: "A", rightModel: "B", winner: "tie" }),
    ];
    const summaries = aggregatePairwise(rows);
    const a = summaries.find((s) => s.model === "A");
    const b = summaries.find((s) => s.model === "B");
    expect(a?.wins).toBe(2);
    expect(a?.losses).toBe(1);
    expect(a?.ties).toBe(1);
    expect(b?.wins).toBe(1);
    expect(b?.losses).toBe(2);
    expect((a?.btScore ?? 0) > (b?.btScore ?? 0)).toBe(true);
  });

  it("ignores error rows", () => {
    const rows: PairwiseRow[] = [
      pwRow({ winner: "error", errorMessage: "boom" }),
    ];
    const summaries = aggregatePairwise(rows);
    expect(summaries).toHaveLength(0);
  });
});
