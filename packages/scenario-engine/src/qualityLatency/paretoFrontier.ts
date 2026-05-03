import { percentile } from "../ttsComparison/stats";
import type {
  E2eRow,
  FrontierPoint,
  JudgeScoreRow,
  RuleScoreRow,
} from "./types";

type GroupKey = string;

function groupKey(row: E2eRow): GroupKey {
  return [row.llmProvider, row.llmModel, row.ttsProvider, row.mode].join("|");
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export type ComputeFrontierInput = {
  e2eRows: readonly E2eRow[];
  judgeRows: readonly JudgeScoreRow[];
  ruleRows: readonly RuleScoreRow[];
  /** Tier 2 tolerance: a non-Tier-1 point within this fraction of any frontier
   * dimension still counts as Tier 2; default 0.10 (10%). */
  tier2Tolerance?: number;
};

export function computeFrontier(input: ComputeFrontierInput): FrontierPoint[] {
  const tier2Tol = input.tier2Tolerance ?? 0.1;

  // index judge / rule per (caseId, candidateProvider, candidateModel, repeatIndex)
  const judgeAvgByKey = new Map<string, number[]>();
  for (const j of input.judgeRows) {
    if (j.status !== "success" || j.overallScore === null) continue;
    const k = `${j.caseId}|${j.candidateProvider}|${j.candidateModel}|${j.repeatIndex}`;
    const arr = judgeAvgByKey.get(k) ?? [];
    arr.push(j.overallScore);
    judgeAvgByKey.set(k, arr);
  }
  const ruleByKey = new Map<string, RuleScoreRow>();
  for (const r of input.ruleRows) {
    const k = `${r.caseId}|${r.provider}|${r.model}|${r.repeatIndex}`;
    ruleByKey.set(k, r);
  }

  // group e2e rows
  const groups = new Map<GroupKey, E2eRow[]>();
  for (const row of input.e2eRows) {
    const k = groupKey(row);
    const list = groups.get(k) ?? [];
    list.push(row);
    groups.set(k, list);
  }

  const points: FrontierPoint[] = [];
  for (const list of groups.values()) {
    const head = list[0]!;
    const success = list.filter((r) => r.status === "success");
    const e2eFirst = success
      .map((r) => r.e2eFirstAudioMs)
      .filter((v): v is number => v !== null);
    const e2eDone = success
      .map((r) => r.e2eDoneMs)
      .filter((v): v is number => v !== null);

    const qualityScores: number[] = [];
    let rulePassCount = 0;
    let knockoutCount = 0;
    let qualityAvailable = 0;
    for (const row of list) {
      const k = `${row.caseId}|${row.llmProvider}|${row.llmModel}|${row.repeatIndex}`;
      const judges = judgeAvgByKey.get(k);
      if (judges && judges.length > 0) {
        qualityScores.push(avg(judges));
        qualityAvailable += 1;
      }
      const rule = ruleByKey.get(k);
      if (rule) {
        if (rule.rulePass) rulePassCount += 1;
        if (rule.knockout) knockoutCount += 1;
      }
    }

    points.push({
      llmProvider: head.llmProvider,
      llmModel: head.llmModel,
      ttsProvider: String(head.ttsProvider),
      mode: head.mode,
      total: list.length,
      successRate: rate(success.length, list.length),
      rulePassRate: rate(rulePassCount, list.length),
      knockoutRate: rate(knockoutCount, list.length),
      avgQualityScore: avg(qualityScores),
      p50E2eFirstAudioMs: percentile(e2eFirst, 50),
      p90E2eFirstAudioMs: percentile(e2eFirst, 90),
      p50E2eDoneMs: percentile(e2eDone, 50),
      p90E2eDoneMs: percentile(e2eDone, 90),
      paretoTier: "dominated",
      compositeScore: 0,
    });
  }

  applyParetoTiers(points, tier2Tol);
  applyCompositeScore(points);
  return points;
}

function applyParetoTiers(points: FrontierPoint[], tier2Tol: number): void {
  // Comparable points need both p90E2eFirstAudioMs and avgQualityScore.
  const candidates = points.filter(
    (p) => p.p90E2eFirstAudioMs !== null && p.avgQualityScore > 0
  );
  for (const p of candidates) {
    p.paretoTier = "dominated";
  }

  // Tier 1: not dominated by any other candidate.
  for (const p of candidates) {
    let dominated = false;
    for (const q of candidates) {
      if (p === q) continue;
      const speedBetter = (q.p90E2eFirstAudioMs as number) <= (p.p90E2eFirstAudioMs as number);
      const qualityBetter = q.avgQualityScore >= p.avgQualityScore;
      const strict =
        (q.p90E2eFirstAudioMs as number) < (p.p90E2eFirstAudioMs as number) ||
        q.avgQualityScore > p.avgQualityScore;
      if (speedBetter && qualityBetter && strict) {
        dominated = true;
        break;
      }
    }
    if (!dominated) p.paretoTier = 1;
  }

  // Tier 2: dominated but within tier2Tol of any Tier 1 point on either axis.
  const tier1 = candidates.filter((p) => p.paretoTier === 1);
  for (const p of candidates) {
    if (p.paretoTier === 1) continue;
    const isClose = tier1.some((t) => {
      const speedDelta =
        ((p.p90E2eFirstAudioMs as number) - (t.p90E2eFirstAudioMs as number)) /
        Math.max(t.p90E2eFirstAudioMs as number, 1);
      const qualityDelta =
        (t.avgQualityScore - p.avgQualityScore) / Math.max(t.avgQualityScore, 1);
      return speedDelta <= tier2Tol && qualityDelta <= tier2Tol;
    });
    if (isClose) p.paretoTier = 2;
  }
}

function applyCompositeScore(points: FrontierPoint[]): void {
  const speeds = points
    .map((p) => p.p90E2eFirstAudioMs)
    .filter((v): v is number => v !== null);
  const dones = points
    .map((p) => p.p90E2eDoneMs)
    .filter((v): v is number => v !== null);
  const qualities = points.map((p) => p.avgQualityScore).filter((v) => v > 0);

  const minSpeed = speeds.length === 0 ? 0 : Math.min(...speeds);
  const maxSpeed = speeds.length === 0 ? 1 : Math.max(...speeds);
  const minDone = dones.length === 0 ? 0 : Math.min(...dones);
  const maxDone = dones.length === 0 ? 1 : Math.max(...dones);
  const maxQuality = qualities.length === 0 ? 1 : Math.max(...qualities);

  for (const p of points) {
    const normalizedQuality = maxQuality > 0 ? p.avgQualityScore / maxQuality : 0;
    const normalizedSpeed =
      p.p90E2eFirstAudioMs === null || maxSpeed === minSpeed
        ? 0
        : 1 - (p.p90E2eFirstAudioMs - minSpeed) / (maxSpeed - minSpeed);
    const normalizedDone =
      p.p90E2eDoneMs === null || maxDone === minDone
        ? 0
        : 1 - (p.p90E2eDoneMs - minDone) / (maxDone - minDone);
    p.compositeScore =
      0.35 * normalizedQuality +
      0.25 * normalizedSpeed +
      0.15 * normalizedDone +
      0.15 * p.rulePassRate +
      0.1 * p.successRate;
  }
}
