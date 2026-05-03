import { describe, expect, it } from "vitest";
import { buildMetricsCsv, buildSummaryCsv, summarizeRows } from "./csvWriters";
import type { ResponseLatencyRow } from "./types";

function row(overrides: Partial<ResponseLatencyRow>): ResponseLatencyRow {
  return {
    runId: "run-test",
    timestamp: "2026-05-03T00:00:00.000Z",
    mode: "full-text",
    llmProvider: "openai",
    llmModel: "gpt-test",
    systemPromptVersion: "v1",
    ttsProvider: "cartesia",
    ttsModel: "sonic-3",
    voiceId: "voice_a",
    caseId: "resp_001",
    category: "short_ack",
    userInput: "はい、お願いします。",
    repeatIndex: 1,
    status: "success",
    llmCacheHit: false,
    llmCacheKey: "key1",
    llmLatencyFresh: true,
    llmRequestToFirstTokenMs: 100,
    llmRequestToFirstSentenceMs: 300,
    llmRequestToDoneMs: 600,
    llmOutputChars: 12,
    llmOutputSentences: 1,
    ttsInputMode: "full-text",
    ttsInputText: "返答全文",
    ttsInputChars: 4,
    ttsRequestToFirstAudioMs: 200,
    ttsRequestToDoneMs: 800,
    audioDurationMs: 1500,
    rtf: 0.53,
    firstAudioAvailable: true,
    e2eFirstAudioMs: 800,
    e2eDoneMs: 1400,
    overlapGainMs: null,
    firstSentenceText: "返答全文",
    responseText: "返答全文",
    outputFile: "audio/test.wav",
    errorCode: "",
    errorMessage: "",
    vendorRequestId: "",
    ...overrides,
  };
}

describe("buildMetricsCsv", () => {
  it("includes all required columns and a row", () => {
    const csv = buildMetricsCsv([row({})]);
    const [header, dataLine] = csv.split("\n");
    expect(header).toContain("llmCacheHit");
    expect(header).toContain("ttsInputMode");
    expect(header).toContain("e2eFirstAudioMs");
    expect(header).toContain("overlapGainMs");
    expect(dataLine).toContain("resp_001");
    expect(dataLine).toContain("cartesia");
  });

  it("emits empty cells for null numeric fields", () => {
    const csv = buildMetricsCsv([
      row({
        ttsRequestToFirstAudioMs: null,
        e2eFirstAudioMs: null,
        firstAudioAvailable: false,
      }),
    ]);
    const dataLine = csv.split("\n")[1] ?? "";
    expect(dataLine).toContain("false");
  });
});

describe("summarizeRows", () => {
  it("computes p50/p90 from llmLatencyFresh=true rows only", () => {
    const rows = [
      row({ repeatIndex: 1, llmLatencyFresh: true, llmRequestToFirstSentenceMs: 100 }),
      row({ repeatIndex: 2, llmLatencyFresh: true, llmRequestToFirstSentenceMs: 200 }),
      row({ repeatIndex: 3, llmLatencyFresh: false, llmRequestToFirstSentenceMs: 9999 }),
    ];
    const [s] = summarizeRows(rows);
    expect(s?.freshLlmRows).toBe(2);
    expect(s?.p50LlmFirstSentenceMs).toBeLessThan(500);
    expect(s?.p90LlmFirstSentenceMs).toBeLessThan(500);
  });

  it("marks firstAudioAvailable=false when no first-audio data", () => {
    const rows = [
      row({
        ttsProvider: "google_gemini",
        ttsRequestToFirstAudioMs: null,
        e2eFirstAudioMs: null,
        firstAudioAvailable: false,
      }),
    ];
    const [s] = summarizeRows(rows);
    expect(s?.firstAudioAvailable).toBe(false);
    expect(s?.p50TtsFirstAudioMs).toBeNull();
    expect(s?.p50E2eFirstAudioMs).toBeNull();
  });

  it("retains failed rows in totals but excludes from latency stats", () => {
    const rows = [
      row({ repeatIndex: 1, status: "success", llmRequestToFirstSentenceMs: 200 }),
      row({
        repeatIndex: 2,
        status: "failed",
        llmRequestToFirstSentenceMs: null,
        llmCacheHit: false,
        llmLatencyFresh: false,
      }),
    ];
    const [s] = summarizeRows(rows);
    expect(s?.total).toBe(2);
    expect(s?.success).toBe(1);
    expect(s?.failed).toBe(1);
    expect(s?.successRate).toBeCloseTo(0.5);
  });
});

describe("buildSummaryCsv", () => {
  it("includes fresh-only LLM percentile columns", () => {
    const csv = buildSummaryCsv([
      row({ llmLatencyFresh: true, llmRequestToFirstSentenceMs: 100 }),
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("p50LlmFirstSentenceMs");
    expect(lines[0]).toContain("freshLlmRows");
    expect(lines[0]).toContain("p90E2eFirstAudioMs");
  });
});
