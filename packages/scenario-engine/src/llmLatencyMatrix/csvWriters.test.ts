import { describe, expect, it } from "vitest";
import { buildMetricsCsv, buildSummaryCsv, summarizeRows } from "./csvWriters";
import type { LlmMatrixRow } from "./types";

function row(overrides: Partial<LlmMatrixRow>): LlmMatrixRow {
  return {
    runId: "run-test",
    timestamp: "2026-05-03T00:00:00.000Z",
    provider: "openai",
    model: "gpt-4.1-nano",
    modelCategory: "general-fast",
    reasoningEffort: "",
    caseId: "resp_001",
    category: "short_ack",
    userInput: "はい",
    repeatIndex: 1,
    status: "success",
    llmRequestToFirstTokenMs: 250,
    llmRequestToFirstSentenceMs: 350,
    llmRequestToDoneMs: 700,
    llmOutputChars: 30,
    llmOutputSentences: 1,
    llmOutputCharsPerSec: 30 / 0.7,
    firstSentenceText: "はい、お引き受けします。",
    responseText: "はい、お引き受けします。",
    temperature: 0.2,
    maxOutputTokens: 200,
    seed: null,
    errorCode: "",
    errorMessage: "",
    vendorRequestId: "",
    ...overrides,
  };
}

describe("buildMetricsCsv", () => {
  it("includes all required columns", () => {
    const csv = buildMetricsCsv([row({})]);
    const header = csv.split("\n")[0] ?? "";
    expect(header).toContain("provider");
    expect(header).toContain("model");
    expect(header).toContain("reasoningEffort");
    expect(header).toContain("llmRequestToFirstSentenceMs");
    expect(header).toContain("llmOutputCharsPerSec");
    expect(header).toContain("vendorRequestId");
  });

  it("emits empty cells for null numeric fields", () => {
    const csv = buildMetricsCsv([
      row({
        status: "failed",
        llmRequestToFirstTokenMs: null,
        llmRequestToFirstSentenceMs: null,
        llmRequestToDoneMs: null,
        llmOutputChars: null,
        llmOutputSentences: null,
        llmOutputCharsPerSec: null,
        errorCode: "LLM_THROW",
        errorMessage: "boom",
      }),
    ]);
    const dataLine = csv.split("\n")[1] ?? "";
    expect(dataLine).toContain("LLM_THROW");
    expect(dataLine).toContain("boom");
  });
});

describe("summarizeRows", () => {
  it("groups by provider+model+reasoningEffort and computes p50/p90", () => {
    const rows = [
      row({ repeatIndex: 1, llmRequestToFirstSentenceMs: 200 }),
      row({ repeatIndex: 2, llmRequestToFirstSentenceMs: 300 }),
      row({ repeatIndex: 3, llmRequestToFirstSentenceMs: 400 }),
    ];
    const [s] = summarizeRows(rows);
    expect(s?.total).toBe(3);
    expect(s?.success).toBe(3);
    expect(s?.p50FirstSentenceMs).toBe(300);
    expect(s?.p90FirstSentenceMs).toBeCloseTo(380, 0);
  });

  it("treats different reasoningEffort as separate rows in summary", () => {
    const rows = [
      row({ model: "gpt-5-nano", reasoningEffort: "minimal" }),
      row({ model: "gpt-5-nano", reasoningEffort: "minimal" }),
      row({ model: "gpt-5-nano", reasoningEffort: "low" }),
    ];
    const summaries = summarizeRows(rows);
    expect(summaries).toHaveLength(2);
  });

  it("retains failed rows in totals but excludes from latency stats", () => {
    const rows = [
      row({ repeatIndex: 1, status: "success", llmRequestToFirstSentenceMs: 200 }),
      row({
        repeatIndex: 2,
        status: "failed",
        llmRequestToFirstSentenceMs: null,
      }),
    ];
    const [s] = summarizeRows(rows);
    expect(s?.total).toBe(2);
    expect(s?.success).toBe(1);
    expect(s?.failed).toBe(1);
    expect(s?.successRate).toBeCloseTo(0.5);
    expect(s?.p50FirstSentenceMs).toBe(200);
  });
});

describe("buildSummaryCsv", () => {
  it("includes summary columns", () => {
    const csv = buildSummaryCsv([row({})]);
    const header = csv.split("\n")[0] ?? "";
    expect(header).toContain("p50FirstSentenceMs");
    expect(header).toContain("p90FirstSentenceMs");
    expect(header).toContain("p50CharsPerSec");
  });
});
