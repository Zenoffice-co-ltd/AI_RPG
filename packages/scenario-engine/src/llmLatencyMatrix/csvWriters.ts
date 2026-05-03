import Papa from "papaparse";
import { percentile } from "./stats";
import type { LlmMatrixRow, LlmMatrixSummary } from "./types";

function nullableNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

function roundOrEmpty(value: number | null, digits: number): string {
  if (value === null) return "";
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

export function buildMetricsCsv(rows: LlmMatrixRow[]): string {
  return Papa.unparse(
    rows.map((row) => ({
      runId: row.runId,
      timestamp: row.timestamp,
      provider: row.provider,
      model: row.model,
      modelCategory: row.modelCategory,
      reasoningEffort: row.reasoningEffort,
      caseId: row.caseId,
      category: row.category,
      userInput: row.userInput,
      repeatIndex: row.repeatIndex,
      status: row.status,
      llmRequestToFirstTokenMs: nullableNumber(row.llmRequestToFirstTokenMs),
      llmRequestToFirstSentenceMs: nullableNumber(row.llmRequestToFirstSentenceMs),
      llmRequestToDoneMs: nullableNumber(row.llmRequestToDoneMs),
      llmOutputChars: nullableNumber(row.llmOutputChars),
      llmOutputSentences: nullableNumber(row.llmOutputSentences),
      llmOutputCharsPerSec: roundOrEmpty(row.llmOutputCharsPerSec, 2),
      firstSentenceText: row.firstSentenceText,
      responseText: row.responseText,
      temperature: nullableNumber(row.temperature),
      maxOutputTokens: nullableNumber(row.maxOutputTokens),
      seed: nullableNumber(row.seed),
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      vendorRequestId: row.vendorRequestId,
    }))
  );
}

function groupKey(row: LlmMatrixRow): string {
  return [row.provider, row.model, row.reasoningEffort].join("|");
}

export function summarizeRows(rows: LlmMatrixRow[]): LlmMatrixSummary[] {
  const groups = new Map<string, LlmMatrixRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const summaries: LlmMatrixSummary[] = [];
  for (const list of groups.values()) {
    const head = list[0]!;
    const success = list.filter((r) => r.status === "success");
    const firstToken = collect(success, (r) => r.llmRequestToFirstTokenMs);
    const firstSentence = collect(success, (r) => r.llmRequestToFirstSentenceMs);
    const done = collect(success, (r) => r.llmRequestToDoneMs);
    const cps = collect(success, (r) => r.llmOutputCharsPerSec);
    summaries.push({
      provider: head.provider,
      model: head.model,
      modelCategory: head.modelCategory,
      reasoningEffort: head.reasoningEffort,
      total: list.length,
      success: success.length,
      failed: list.length - success.length,
      successRate: list.length === 0 ? 0 : success.length / list.length,
      p50FirstTokenMs: percentile(firstToken, 50),
      p90FirstTokenMs: percentile(firstToken, 90),
      p50FirstSentenceMs: percentile(firstSentence, 50),
      p90FirstSentenceMs: percentile(firstSentence, 90),
      p50DoneMs: percentile(done, 50),
      p90DoneMs: percentile(done, 90),
      p50CharsPerSec: percentile(cps, 50),
      p90CharsPerSec: percentile(cps, 90),
    });
  }

  summaries.sort((a, b) => {
    const providerCmp = String(a.provider).localeCompare(String(b.provider));
    if (providerCmp !== 0) return providerCmp;
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return String(a.reasoningEffort).localeCompare(String(b.reasoningEffort));
  });
  return summaries;
}

function collect<T>(rows: T[], pick: (row: T) => number | null): number[] {
  return rows.map(pick).filter((value): value is number => value !== null);
}

export function buildSummaryCsv(rows: LlmMatrixRow[]): string {
  const summaries = summarizeRows(rows);
  return Papa.unparse(
    summaries.map((s) => ({
      provider: s.provider,
      model: s.model,
      modelCategory: s.modelCategory,
      reasoningEffort: s.reasoningEffort,
      total: s.total,
      success: s.success,
      failed: s.failed,
      successRate: roundOrEmpty(s.successRate, 4),
      p50FirstTokenMs: roundOrEmpty(s.p50FirstTokenMs, 1),
      p90FirstTokenMs: roundOrEmpty(s.p90FirstTokenMs, 1),
      p50FirstSentenceMs: roundOrEmpty(s.p50FirstSentenceMs, 1),
      p90FirstSentenceMs: roundOrEmpty(s.p90FirstSentenceMs, 1),
      p50DoneMs: roundOrEmpty(s.p50DoneMs, 1),
      p90DoneMs: roundOrEmpty(s.p90DoneMs, 1),
      p50CharsPerSec: roundOrEmpty(s.p50CharsPerSec, 2),
      p90CharsPerSec: roundOrEmpty(s.p90CharsPerSec, 2),
    }))
  );
}
