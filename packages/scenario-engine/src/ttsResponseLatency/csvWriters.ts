import Papa from "papaparse";
import { percentile } from "./stats";
import type {
  ResponseLatencyMode,
  ResponseLatencyRow,
  ResponseLatencySummary,
} from "./types";

function nullableNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

function roundOrEmpty(value: number | null, digits: number): string {
  if (value === null) return "";
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

function toBool(value: boolean): string {
  return value ? "true" : "false";
}

export function buildMetricsCsv(rows: ResponseLatencyRow[]): string {
  return Papa.unparse(
    rows.map((row) => ({
      runId: row.runId,
      timestamp: row.timestamp,
      mode: row.mode,
      llmProvider: row.llmProvider,
      llmModel: row.llmModel,
      systemPromptVersion: row.systemPromptVersion,
      ttsProvider: row.ttsProvider,
      ttsModel: row.ttsModel,
      voiceId: row.voiceId,
      caseId: row.caseId,
      category: row.category,
      userInput: row.userInput,
      repeatIndex: row.repeatIndex,
      status: row.status,
      llmCacheHit: toBool(row.llmCacheHit),
      llmCacheKey: row.llmCacheKey,
      llmLatencyFresh: toBool(row.llmLatencyFresh),
      llmRequestToFirstTokenMs: nullableNumber(row.llmRequestToFirstTokenMs),
      llmRequestToFirstSentenceMs: nullableNumber(row.llmRequestToFirstSentenceMs),
      llmRequestToDoneMs: nullableNumber(row.llmRequestToDoneMs),
      llmOutputChars: nullableNumber(row.llmOutputChars),
      llmOutputSentences: nullableNumber(row.llmOutputSentences),
      ttsInputMode: row.ttsInputMode,
      ttsInputText: row.ttsInputText,
      ttsInputChars: nullableNumber(row.ttsInputChars),
      ttsRequestToFirstAudioMs: nullableNumber(row.ttsRequestToFirstAudioMs),
      ttsRequestToDoneMs: nullableNumber(row.ttsRequestToDoneMs),
      audioDurationMs: nullableNumber(row.audioDurationMs),
      rtf: roundOrEmpty(row.rtf, 4),
      firstAudioAvailable: toBool(row.firstAudioAvailable),
      e2eFirstAudioMs: nullableNumber(row.e2eFirstAudioMs),
      e2eDoneMs: nullableNumber(row.e2eDoneMs),
      overlapGainMs: nullableNumber(row.overlapGainMs),
      firstSentenceText: row.firstSentenceText,
      responseText: row.responseText,
      outputFile: row.outputFile,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      vendorRequestId: row.vendorRequestId,
    }))
  );
}

function groupKey(row: ResponseLatencyRow): string {
  return [
    row.mode,
    row.llmProvider,
    row.llmModel,
    row.ttsProvider,
    row.ttsModel,
    row.voiceId,
  ].join("|");
}

export function summarizeRows(rows: ResponseLatencyRow[]): ResponseLatencySummary[] {
  const groups = new Map<string, ResponseLatencyRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const summaries: ResponseLatencySummary[] = [];
  for (const list of groups.values()) {
    const head = list[0]!;
    const success = list.filter((row) => row.status === "success");

    const fresh = success.filter((row) => row.llmLatencyFresh);
    const llmFirstToken = collectNumbers(fresh, (r) => r.llmRequestToFirstTokenMs);
    const llmFirstSentence = collectNumbers(fresh, (r) => r.llmRequestToFirstSentenceMs);
    const llmDone = collectNumbers(fresh, (r) => r.llmRequestToDoneMs);

    const ttsFirst = collectNumbers(success, (r) => r.ttsRequestToFirstAudioMs);
    const ttsDone = collectNumbers(success, (r) => r.ttsRequestToDoneMs);
    const e2eFirst = collectNumbers(success, (r) => r.e2eFirstAudioMs);
    const e2eDone = collectNumbers(success, (r) => r.e2eDoneMs);
    const overlap = collectNumbers(success, (r) => r.overlapGainMs);

    summaries.push({
      mode: head.mode,
      llmProvider: head.llmProvider,
      llmModel: head.llmModel,
      ttsProvider: head.ttsProvider,
      ttsModel: head.ttsModel,
      voiceId: head.voiceId,
      total: list.length,
      success: success.length,
      failed: list.length - success.length,
      successRate: list.length === 0 ? 0 : success.length / list.length,
      freshLlmRows: fresh.length,
      p50LlmFirstTokenMs: percentile(llmFirstToken, 50),
      p90LlmFirstTokenMs: percentile(llmFirstToken, 90),
      p50LlmFirstSentenceMs: percentile(llmFirstSentence, 50),
      p90LlmFirstSentenceMs: percentile(llmFirstSentence, 90),
      p50LlmDoneMs: percentile(llmDone, 50),
      p90LlmDoneMs: percentile(llmDone, 90),
      p50TtsFirstAudioMs: percentile(ttsFirst, 50),
      p90TtsFirstAudioMs: percentile(ttsFirst, 90),
      p50TtsDoneMs: percentile(ttsDone, 50),
      p90TtsDoneMs: percentile(ttsDone, 90),
      p50E2eFirstAudioMs: percentile(e2eFirst, 50),
      p90E2eFirstAudioMs: percentile(e2eFirst, 90),
      p50E2eDoneMs: percentile(e2eDone, 50),
      p90E2eDoneMs: percentile(e2eDone, 90),
      p50OverlapGainMs: percentile(overlap, 50),
      p90OverlapGainMs: percentile(overlap, 90),
      firstAudioAvailable: ttsFirst.length > 0,
    });
  }

  summaries.sort((a, b) => {
    if (a.mode !== b.mode) return a.mode.localeCompare(b.mode);
    if (a.ttsProvider !== b.ttsProvider) return a.ttsProvider.localeCompare(b.ttsProvider);
    return a.voiceId.localeCompare(b.voiceId);
  });
  return summaries;
}

function collectNumbers<T>(rows: T[], pick: (row: T) => number | null): number[] {
  return rows
    .map(pick)
    .filter((value): value is number => value !== null);
}

export function buildSummaryCsv(rows: ResponseLatencyRow[]): string {
  const summaries = summarizeRows(rows);
  return Papa.unparse(
    summaries.map((s) => ({
      mode: s.mode,
      llmProvider: s.llmProvider,
      llmModel: s.llmModel,
      ttsProvider: s.ttsProvider,
      ttsModel: s.ttsModel,
      voiceId: s.voiceId,
      total: s.total,
      success: s.success,
      failed: s.failed,
      successRate: roundOrEmpty(s.successRate, 4),
      freshLlmRows: s.freshLlmRows,
      p50LlmFirstTokenMs: roundOrEmpty(s.p50LlmFirstTokenMs, 1),
      p90LlmFirstTokenMs: roundOrEmpty(s.p90LlmFirstTokenMs, 1),
      p50LlmFirstSentenceMs: roundOrEmpty(s.p50LlmFirstSentenceMs, 1),
      p90LlmFirstSentenceMs: roundOrEmpty(s.p90LlmFirstSentenceMs, 1),
      p50LlmDoneMs: roundOrEmpty(s.p50LlmDoneMs, 1),
      p90LlmDoneMs: roundOrEmpty(s.p90LlmDoneMs, 1),
      p50TtsFirstAudioMs: s.firstAudioAvailable ? roundOrEmpty(s.p50TtsFirstAudioMs, 1) : "",
      p90TtsFirstAudioMs: s.firstAudioAvailable ? roundOrEmpty(s.p90TtsFirstAudioMs, 1) : "",
      p50TtsDoneMs: roundOrEmpty(s.p50TtsDoneMs, 1),
      p90TtsDoneMs: roundOrEmpty(s.p90TtsDoneMs, 1),
      p50E2eFirstAudioMs: s.firstAudioAvailable ? roundOrEmpty(s.p50E2eFirstAudioMs, 1) : "",
      p90E2eFirstAudioMs: s.firstAudioAvailable ? roundOrEmpty(s.p90E2eFirstAudioMs, 1) : "",
      p50E2eDoneMs: roundOrEmpty(s.p50E2eDoneMs, 1),
      p90E2eDoneMs: roundOrEmpty(s.p90E2eDoneMs, 1),
      p50OverlapGainMs: roundOrEmpty(s.p50OverlapGainMs, 1),
      p90OverlapGainMs: roundOrEmpty(s.p90OverlapGainMs, 1),
      firstAudioAvailable: toBool(s.firstAudioAvailable),
    }))
  );
}

export function buildResponseSummaryCsv(rows: ResponseLatencyRow[]): string {
  const wide: Array<Record<string, string | number>> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.caseId}|${row.repeatIndex}|${row.mode}|${row.ttsProvider}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wide.push({
      caseId: row.caseId,
      category: row.category,
      userInput: row.userInput,
      repeatIndex: row.repeatIndex,
      mode: row.mode,
      ttsProvider: row.ttsProvider,
      voiceId: row.voiceId,
      status: row.status,
      llmRequestToFirstSentenceMs: nullableNumber(row.llmRequestToFirstSentenceMs),
      llmRequestToDoneMs: nullableNumber(row.llmRequestToDoneMs),
      ttsRequestToFirstAudioMs: nullableNumber(row.ttsRequestToFirstAudioMs),
      e2eFirstAudioMs: nullableNumber(row.e2eFirstAudioMs),
      e2eDoneMs: nullableNumber(row.e2eDoneMs),
      overlapGainMs: nullableNumber(row.overlapGainMs),
      ttsInputMode: row.ttsInputMode,
      firstSentenceText: row.firstSentenceText,
      responseText: row.responseText,
    });
  }
  wide.sort((a, b) => {
    const ca = String(a["caseId"]);
    const cb = String(b["caseId"]);
    if (ca !== cb) return ca.localeCompare(cb);
    const ra = Number(a["repeatIndex"]);
    const rb = Number(b["repeatIndex"]);
    if (ra !== rb) return ra - rb;
    const ma = String(a["mode"]);
    const mb = String(b["mode"]);
    if (ma !== mb) return ma.localeCompare(mb);
    return String(a["ttsProvider"]).localeCompare(String(b["ttsProvider"]));
  });
  return Papa.unparse(wide);
}
