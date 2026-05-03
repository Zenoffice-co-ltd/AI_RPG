import Papa from "papaparse";
import { bootstrapPercentileCi } from "./bootstrap";
import { percentile } from "../ttsComparison/stats";
import { aggregatePairwise } from "./pairwiseRunner";
import type {
  E2eRow,
  FrontierPoint,
  JudgeScoreRow,
  PairwiseRow,
  QualityLatencyRow,
  RuleScoreRow,
} from "./types";

function nullable(value: number | null): string {
  return value === null ? "" : String(value);
}

function round(value: number | null, digits: number): string {
  if (value === null) return "";
  const f = 10 ** digits;
  return String(Math.round(value * f) / f);
}

function bool(value: boolean | null): string {
  if (value === null) return "";
  return value ? "true" : "false";
}

export function buildMetricsCsv(rows: QualityLatencyRow[]): string {
  return Papa.unparse(
    rows.map((row) => ({
      runId: row.runId,
      timestamp: row.timestamp,
      provider: row.provider,
      model: row.model,
      modelCategory: row.modelCategory,
      reasoningEffort: row.reasoningEffort,
      caseId: row.caseId,
      caseCategory: row.caseCategory,
      userInput: row.userInput,
      repeatIndex: row.repeatIndex,
      status: row.status,
      llmRequestToFirstTokenMs: nullable(row.llmRequestToFirstTokenMs),
      llmRequestToFirstSentenceMs: nullable(row.llmRequestToFirstSentenceMs),
      llmRequestToDoneMs: nullable(row.llmRequestToDoneMs),
      llmOutputChars: nullable(row.llmOutputChars),
      llmOutputSentences: nullable(row.llmOutputSentences),
      llmOutputCharsPerSec: round(row.llmOutputCharsPerSec, 2),
      firstSentenceText: row.firstSentenceText,
      responseText: row.responseText,
      temperature: nullable(row.temperature),
      maxOutputTokens: nullable(row.maxOutputTokens),
      seed: nullable(row.seed),
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      vendorRequestId: row.vendorRequestId,
    }))
  );
}

export function buildLatencySummaryCsv(rows: QualityLatencyRow[]): string {
  const groups = new Map<string, QualityLatencyRow[]>();
  for (const row of rows) {
    const key = [row.provider, row.model, row.reasoningEffort].join("|");
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: Record<string, string | number>[] = [];
  for (const list of groups.values()) {
    const head = list[0]!;
    const success = list.filter((r) => r.status === "success");
    const firstToken = success
      .map((r) => r.llmRequestToFirstTokenMs)
      .filter((v): v is number => v !== null);
    const firstSentence = success
      .map((r) => r.llmRequestToFirstSentenceMs)
      .filter((v): v is number => v !== null);
    const done = success
      .map((r) => r.llmRequestToDoneMs)
      .filter((v): v is number => v !== null);
    const cps = success
      .map((r) => r.llmOutputCharsPerSec)
      .filter((v): v is number => v !== null);
    const ciFirstSentence = bootstrapPercentileCi(firstSentence, 90);
    const ciDone = bootstrapPercentileCi(done, 90);
    out.push({
      provider: head.provider,
      model: head.model,
      reasoningEffort: head.reasoningEffort,
      total: list.length,
      success: success.length,
      failed: list.length - success.length,
      successRate: round(success.length / Math.max(list.length, 1), 4),
      p50FirstTokenMs: round(percentile(firstToken, 50), 1),
      p90FirstTokenMs: round(percentile(firstToken, 90), 1),
      p95FirstTokenMs: round(percentile(firstToken, 95), 1),
      p50FirstSentenceMs: round(percentile(firstSentence, 50), 1),
      p90FirstSentenceMs: round(percentile(firstSentence, 90), 1),
      p95FirstSentenceMs: round(percentile(firstSentence, 95), 1),
      p90FirstSentenceCiLow: round(ciFirstSentence?.low ?? null, 1),
      p90FirstSentenceCiHigh: round(ciFirstSentence?.high ?? null, 1),
      p50DoneMs: round(percentile(done, 50), 1),
      p90DoneMs: round(percentile(done, 90), 1),
      p95DoneMs: round(percentile(done, 95), 1),
      p90DoneCiLow: round(ciDone?.low ?? null, 1),
      p90DoneCiHigh: round(ciDone?.high ?? null, 1),
      p50CharsPerSec: round(percentile(cps, 50), 2),
      p90CharsPerSec: round(percentile(cps, 90), 2),
    });
  }
  out.sort((a, b) => String(a["model"]).localeCompare(String(b["model"])));
  return Papa.unparse(out);
}

export function buildRuleScoresCsv(rows: RuleScoreRow[]): string {
  return Papa.unparse(
    rows.map((r) => ({
      runId: r.runId,
      caseId: r.caseId,
      provider: r.provider,
      model: r.model,
      repeatIndex: r.repeatIndex,
      responseChars: r.responseChars,
      responseSentences: r.responseSentences,
      tooLong: bool(r.tooLong),
      hasBullet: bool(r.hasBullet),
      hasMetaLeak: bool(r.hasMetaLeak),
      missingMustInclude: r.missingMustInclude,
      containsMustNotInclude: r.containsMustNotInclude,
      hasUnsupportedClaim: bool(r.hasUnsupportedClaim),
      voiceUnfriendlySymbols: bool(r.voiceUnfriendlySymbols),
      rulePenalty: r.rulePenalty,
      rulePass: bool(r.rulePass),
      knockout: bool(r.knockout),
    }))
  );
}

export function buildJudgeScoresCsv(rows: JudgeScoreRow[]): string {
  return Papa.unparse(
    rows.map((r) => ({
      runId: r.runId,
      caseId: r.caseId,
      candidateProvider: r.candidateProvider,
      candidateModel: r.candidateModel,
      repeatIndex: r.repeatIndex,
      judgeProvider: r.judgeProvider,
      judgeModel: r.judgeModel,
      status: r.status,
      overallScore: nullable(r.overallScore),
      intentFit: nullable(r.intentFit),
      businessCorrectness: nullable(r.businessCorrectness),
      nextAction: nullable(r.nextAction),
      conciseness: nullable(r.conciseness),
      japaneseNaturalness: nullable(r.japaneseNaturalness),
      voiceReadiness: nullable(r.voiceReadiness),
      penalties: r.penalties,
      knockout: bool(r.knockout),
      knockoutReason: r.knockoutReason,
      shortRationale: r.shortRationale,
      errorMessage: r.errorMessage,
    }))
  );
}

export function buildJudgeSummaryCsv(rows: JudgeScoreRow[]): string {
  const groups = new Map<string, JudgeScoreRow[]>();
  for (const row of rows) {
    if (row.status !== "success") continue;
    const key = `${row.candidateProvider}|${row.candidateModel}|${row.judgeProvider}|${row.judgeModel}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: Record<string, string | number>[] = [];
  for (const list of groups.values()) {
    const head = list[0]!;
    const totals = list.reduce(
      (acc, r) => {
        acc.overall += r.overallScore ?? 0;
        acc.intentFit += r.intentFit ?? 0;
        acc.businessCorrectness += r.businessCorrectness ?? 0;
        acc.nextAction += r.nextAction ?? 0;
        acc.conciseness += r.conciseness ?? 0;
        acc.japaneseNaturalness += r.japaneseNaturalness ?? 0;
        acc.voiceReadiness += r.voiceReadiness ?? 0;
        acc.knockouts += r.knockout ? 1 : 0;
        return acc;
      },
      {
        overall: 0,
        intentFit: 0,
        businessCorrectness: 0,
        nextAction: 0,
        conciseness: 0,
        japaneseNaturalness: 0,
        voiceReadiness: 0,
        knockouts: 0,
      }
    );
    const n = list.length;
    out.push({
      candidateProvider: head.candidateProvider,
      candidateModel: head.candidateModel,
      judgeProvider: head.judgeProvider,
      judgeModel: head.judgeModel,
      total: n,
      avgOverallScore: round(totals.overall / n, 2),
      avgIntentFit: round(totals.intentFit / n, 2),
      avgBusinessCorrectness: round(totals.businessCorrectness / n, 2),
      avgNextAction: round(totals.nextAction / n, 2),
      avgConciseness: round(totals.conciseness / n, 2),
      avgJapaneseNaturalness: round(totals.japaneseNaturalness / n, 2),
      avgVoiceReadiness: round(totals.voiceReadiness / n, 2),
      knockoutRate: round(totals.knockouts / Math.max(n, 1), 4),
    });
  }
  out.sort((a, b) => Number(b["avgOverallScore"]) - Number(a["avgOverallScore"]));
  return Papa.unparse(out);
}

export function buildPairwiseCsv(rows: PairwiseRow[]): string {
  return Papa.unparse(
    rows.map((r) => ({
      runId: r.runId,
      caseId: r.caseId,
      repeatIndex: r.repeatIndex,
      judgeProvider: r.judgeProvider,
      judgeModel: r.judgeModel,
      leftAnonymousId: r.leftAnonymousId,
      leftProvider: r.leftProvider,
      leftModel: r.leftModel,
      rightAnonymousId: r.rightAnonymousId,
      rightProvider: r.rightProvider,
      rightModel: r.rightModel,
      winner: r.winner,
      reason: r.reason,
      errorMessage: r.errorMessage,
    }))
  );
}

export function buildPairwiseSummaryCsv(rows: PairwiseRow[]): string {
  const summaries = aggregatePairwise(rows);
  return Papa.unparse(
    summaries.map((s) => ({
      provider: s.provider,
      model: s.model,
      total: s.total,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      winRate: round(s.winRate, 4),
      btScore: round(s.btScore, 4),
    }))
  );
}

export function buildE2eCsv(rows: E2eRow[]): string {
  return Papa.unparse(
    rows.map((r) => ({
      runId: r.runId,
      llmProvider: r.llmProvider,
      llmModel: r.llmModel,
      ttsProvider: r.ttsProvider,
      ttsModel: r.ttsModel,
      voiceId: r.voiceId,
      mode: r.mode,
      caseId: r.caseId,
      repeatIndex: r.repeatIndex,
      status: r.status,
      llmRequestToFirstSentenceMs: nullable(r.llmRequestToFirstSentenceMs),
      llmRequestToDoneMs: nullable(r.llmRequestToDoneMs),
      ttsRequestToFirstAudioMs: nullable(r.ttsRequestToFirstAudioMs),
      ttsRequestToDoneMs: nullable(r.ttsRequestToDoneMs),
      audioDurationMs: nullable(r.audioDurationMs),
      rtf: round(r.rtf, 4),
      firstAudioAvailable: bool(r.firstAudioAvailable),
      e2eFirstAudioMs: nullable(r.e2eFirstAudioMs),
      e2eDoneMs: nullable(r.e2eDoneMs),
      overlapGainMs: nullable(r.overlapGainMs),
      ttsInputMode: r.ttsInputMode,
      ttsInputChars: nullable(r.ttsInputChars),
      qualityScore: nullable(r.qualityScore),
      rulePass: bool(r.rulePass),
      knockout: bool(r.knockout),
      outputFile: r.outputFile,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      vendorRequestId: r.vendorRequestId,
    }))
  );
}

export function buildE2eSummaryCsv(rows: E2eRow[]): string {
  const groups = new Map<string, E2eRow[]>();
  for (const row of rows) {
    const key = `${row.llmProvider}|${row.llmModel}|${row.ttsProvider}|${row.mode}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: Record<string, string | number>[] = [];
  for (const list of groups.values()) {
    const head = list[0]!;
    const success = list.filter((r) => r.status === "success");
    const e2eFirst = success
      .map((r) => r.e2eFirstAudioMs)
      .filter((v): v is number => v !== null);
    const e2eDone = success
      .map((r) => r.e2eDoneMs)
      .filter((v): v is number => v !== null);
    const ttsFirst = success
      .map((r) => r.ttsRequestToFirstAudioMs)
      .filter((v): v is number => v !== null);
    out.push({
      llmProvider: head.llmProvider,
      llmModel: head.llmModel,
      ttsProvider: head.ttsProvider,
      mode: head.mode,
      total: list.length,
      successRate: round(success.length / Math.max(list.length, 1), 4),
      p50TtsFirstAudioMs: round(percentile(ttsFirst, 50), 1),
      p90TtsFirstAudioMs: round(percentile(ttsFirst, 90), 1),
      p50E2eFirstAudioMs: round(percentile(e2eFirst, 50), 1),
      p90E2eFirstAudioMs: round(percentile(e2eFirst, 90), 1),
      p50E2eDoneMs: round(percentile(e2eDone, 50), 1),
      p90E2eDoneMs: round(percentile(e2eDone, 90), 1),
      firstAudioAvailable: bool(ttsFirst.length > 0),
    });
  }
  out.sort((a, b) =>
    String(a["llmModel"]).localeCompare(String(b["llmModel"])) ||
    String(a["ttsProvider"]).localeCompare(String(b["ttsProvider"]))
  );
  return Papa.unparse(out);
}

export function buildFrontierCsv(points: FrontierPoint[]): string {
  return Papa.unparse(
    points.map((p) => ({
      llmProvider: p.llmProvider,
      llmModel: p.llmModel,
      ttsProvider: p.ttsProvider,
      mode: p.mode,
      total: p.total,
      successRate: round(p.successRate, 4),
      rulePassRate: round(p.rulePassRate, 4),
      knockoutRate: round(p.knockoutRate, 4),
      avgQualityScore: round(p.avgQualityScore, 2),
      p50E2eFirstAudioMs: round(p.p50E2eFirstAudioMs, 1),
      p90E2eFirstAudioMs: round(p.p90E2eFirstAudioMs, 1),
      p50E2eDoneMs: round(p.p50E2eDoneMs, 1),
      p90E2eDoneMs: round(p.p90E2eDoneMs, 1),
      paretoTier: p.paretoTier,
      compositeScore: round(p.compositeScore, 4),
    }))
  );
}
