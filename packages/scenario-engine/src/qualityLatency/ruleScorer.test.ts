import { describe, expect, it } from "vitest";
import { scoreRow } from "./ruleScorer";
import type { QualityLatencyCase, QualityLatencyRow } from "./types";

const baseCase: QualityLatencyCase = {
  id: "ql_001",
  category: "short_ack",
  userInput: "test",
  expectedLength: "short",
  scoringNotes: "test",
};

function row(text: string, overrides: Partial<QualityLatencyRow> = {}): QualityLatencyRow {
  return {
    runId: "r",
    timestamp: "t",
    provider: "openai",
    model: "gpt-test",
    modelCategory: "general-fast",
    reasoningEffort: "",
    caseId: "ql_001",
    caseCategory: "short_ack",
    userInput: "u",
    repeatIndex: 1,
    status: "success",
    llmRequestToFirstTokenMs: 100,
    llmRequestToFirstSentenceMs: 200,
    llmRequestToDoneMs: 500,
    llmOutputChars: text.length,
    llmOutputSentences: 1,
    llmOutputCharsPerSec: 50,
    firstSentenceText: text,
    responseText: text,
    temperature: 0.2,
    maxOutputTokens: 200,
    seed: null,
    errorCode: "",
    errorMessage: "",
    vendorRequestId: "",
    ...overrides,
  };
}

describe("scoreRow", () => {
  it("passes a clean concise response", () => {
    const r = scoreRow({ row: row("はい、承知しました。お願いします。"), caseDef: baseCase });
    expect(r.rulePass).toBe(true);
    expect(r.knockout).toBe(false);
    expect(r.tooLong).toBe(false);
  });

  it("flags too-long (>=4 sentences)", () => {
    const r = scoreRow({
      row: row("はい。承知しました。確認します。明日返答します。"),
      caseDef: baseCase,
    });
    expect(r.tooLong).toBe(true);
  });

  it("flags bullet markers", () => {
    const r = scoreRow({
      row: row("確認点は次の通りです。\n- 開始日\n- 人数"),
      caseDef: baseCase,
    });
    expect(r.hasBullet).toBe(true);
  });

  it("knocks out on system prompt leak", () => {
    const r = scoreRow({
      row: row("私はシステムプロンプトに従って動作するAIロープレ担当者です。"),
      caseDef: baseCase,
    });
    expect(r.hasMetaLeak).toBe(true);
    expect(r.knockout).toBe(true);
  });

  it("knocks out when mustNotInclude appears", () => {
    const caseWithBan: QualityLatencyCase = { ...baseCase, mustNotInclude: ["禁止語"] };
    const r = scoreRow({
      row: row("これは禁止語を含む応答です。"),
      caseDef: caseWithBan,
    });
    expect(r.knockout).toBe(true);
  });

  it("flags missing mustInclude", () => {
    const caseWithMust: QualityLatencyCase = {
      ...baseCase,
      mustInclude: ["5月12日", "3名"],
    };
    const r = scoreRow({ row: row("検討します。"), caseDef: caseWithMust });
    expect(r.missingMustInclude).toContain("5月12日");
    expect(r.rulePass).toBe(false);
  });

  it("flags unsupported guarantee phrasing", () => {
    const r = scoreRow({
      row: row("必ず可能です。100%保証します。"),
      caseDef: baseCase,
    });
    expect(r.hasUnsupportedClaim).toBe(true);
  });

  it("flags voice unfriendly markdown", () => {
    const r = scoreRow({
      row: row("詳細は **こちら** をご確認ください。"),
      caseDef: baseCase,
    });
    expect(r.voiceUnfriendlySymbols).toBe(true);
  });
});
