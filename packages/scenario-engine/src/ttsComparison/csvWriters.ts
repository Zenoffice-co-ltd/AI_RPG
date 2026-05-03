import Papa from "papaparse";
import type { BenchmarkRow, ProviderSummary } from "./types";
import { percentile } from "./stats";

function nullableNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

function roundOrEmpty(value: number | null, digits: number): string {
  if (value === null) {
    return "";
  }
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

export function buildMetricsCsv(rows: BenchmarkRow[]): string {
  return Papa.unparse(
    rows.map((row) => ({
      runId: row.runId,
      timestamp: row.timestamp,
      provider: row.provider,
      model: row.model,
      voiceId: row.voiceId,
      utteranceId: row.utteranceId,
      repeatIndex: row.repeatIndex,
      mode: row.mode,
      textLength: row.textLength,
      status: row.status,
      requestToFirstAudioMs: nullableNumber(row.requestToFirstAudioMs),
      requestToLastAudioMs: nullableNumber(row.requestToLastAudioMs),
      audioDurationMs: nullableNumber(row.audioDurationMs),
      rtf: roundOrEmpty(row.rtf, 4),
      bytes: row.bytes,
      sampleRateHz: row.sampleRateHz,
      format: row.format,
      outputFile: row.outputFile,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      vendorRequestId: row.vendorRequestId,
      appliedNormalizationRules: row.appliedNormalizationRules.join("|"),
    }))
  );
}

export function summarizeRows(rows: BenchmarkRow[]): ProviderSummary[] {
  const groups = new Map<string, BenchmarkRow[]>();
  for (const row of rows) {
    const key = `${row.provider}|${row.model}|${row.voiceId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const summaries: ProviderSummary[] = [];
  for (const list of groups.values()) {
    const head = list[0]!;
    const success = list.filter((row) => row.status === "success");
    const firstAudioValues = success
      .map((row) => row.requestToFirstAudioMs)
      .filter((value): value is number => value !== null);
    const totalValues = success
      .map((row) => row.requestToLastAudioMs)
      .filter((value): value is number => value !== null);
    const rtfValues = success
      .map((row) => row.rtf)
      .filter((value): value is number => value !== null);

    summaries.push({
      provider: head.provider,
      model: head.model,
      voiceId: head.voiceId,
      total: list.length,
      success: success.length,
      failed: list.length - success.length,
      successRate: list.length === 0 ? 0 : success.length / list.length,
      firstAudioAvailable: firstAudioValues.length > 0,
      p50FirstAudioMs: percentile(firstAudioValues, 50),
      p90FirstAudioMs: percentile(firstAudioValues, 90),
      p50TotalMs: percentile(totalValues, 50),
      p90TotalMs: percentile(totalValues, 90),
      p50Rtf: percentile(rtfValues, 50),
      p90Rtf: percentile(rtfValues, 90),
    });
  }

  summaries.sort((a, b) => {
    if (a.provider !== b.provider) {
      return a.provider.localeCompare(b.provider);
    }
    return a.voiceId.localeCompare(b.voiceId);
  });

  return summaries;
}

export function buildSummaryCsv(rows: BenchmarkRow[]): string {
  const summaries = summarizeRows(rows);
  return Papa.unparse(
    summaries.map((s) => ({
      provider: s.provider,
      model: s.model,
      voiceId: s.voiceId,
      total: s.total,
      success: s.success,
      failed: s.failed,
      successRate: roundOrEmpty(s.successRate, 4),
      firstAudioAvailable: s.firstAudioAvailable,
      p50FirstAudioMs: s.firstAudioAvailable ? roundOrEmpty(s.p50FirstAudioMs, 1) : "",
      p90FirstAudioMs: s.firstAudioAvailable ? roundOrEmpty(s.p90FirstAudioMs, 1) : "",
      p50TotalMs: roundOrEmpty(s.p50TotalMs, 1),
      p90TotalMs: roundOrEmpty(s.p90TotalMs, 1),
      p50Rtf: roundOrEmpty(s.p50Rtf, 4),
      p90Rtf: roundOrEmpty(s.p90Rtf, 4),
    }))
  );
}

export function buildReviewSheetCsv(rows: BenchmarkRow[]): string {
  return Papa.unparse(
    rows
      .filter((row) => row.status === "success")
      .map((row) => ({
        runId: row.runId,
        providerHiddenId: row.providerHiddenId,
        provider: row.provider,
        model: row.model,
        voiceId: row.voiceId,
        utteranceId: row.utteranceId,
        utterance: row.utterance,
        outputFile: row.outputFile,
        "自然さ": "",
        "滑らかさ": "",
        "日本語発音": "",
        "読みの正確さ": "",
        "速度感": "",
        "ノイズ/破綻": "",
        "総合": "",
        "knockout理由": "",
        comments: "",
      }))
  );
}
