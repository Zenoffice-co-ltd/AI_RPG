import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AnthropicMessagesStructuredClient,
  OpenAiResponsesClient,
} from "@top-performer/vendors";
import {
  PAIRWISE_SYSTEM_PROMPT,
  PAIRWISE_TOOL_NAME,
  buildPairwiseUserPrompt,
  pairwiseJsonSchema,
  pairwiseResponseSchema,
  type PairwiseResponse,
} from "./judgeRubric";
import type { PairwiseRow, QualityLatencyCase, QualityLatencyRow } from "./types";

export interface PairwiseStructuredClient {
  comparePair(args: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<PairwiseResponse>;
}

export class OpenAiPairwiseClient implements PairwiseStructuredClient {
  constructor(
    private readonly responses: OpenAiResponsesClient,
    private readonly model: string
  ) {}

  async comparePair(args: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<PairwiseResponse> {
    return this.responses.createStructuredOutput({
      model: this.model,
      schemaName: "pairwise_response",
      jsonSchema: pairwiseJsonSchema,
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt,
      responseSchema: pairwiseResponseSchema,
    });
  }
}

export class AnthropicPairwiseClient implements PairwiseStructuredClient {
  constructor(
    private readonly client: AnthropicMessagesStructuredClient,
    private readonly model: string
  ) {}

  async comparePair(args: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<PairwiseResponse> {
    const result = await this.client.createStructuredOutput({
      model: this.model,
      systemPrompt: args.systemPrompt,
      userMessage: args.userPrompt,
      toolName: PAIRWISE_TOOL_NAME,
      jsonSchema: pairwiseJsonSchema,
      responseSchema: pairwiseResponseSchema,
      maxOutputTokens: 256,
    });
    return result.parsed;
  }
}

export function pairwiseAnonymousIdFor(row: QualityLatencyRow, suffix: "left" | "right"): string {
  return createHash("sha1")
    .update(
      `${row.runId}|${row.provider}|${row.model}|${row.caseId}|${row.repeatIndex}|${suffix}`
    )
    .digest("hex")
    .slice(0, 12);
}

const RETRY_LIMIT = 1;

function isRetryable(error: unknown): boolean {
  if (error instanceof z.ZodError) return true;
  const message = error instanceof Error ? error.message : "";
  return /JSON|parse|tool_use/i.test(message);
}

/**
 * Returns left/right ordering for a pair. Order is randomized using a deterministic
 * hash of (runId, caseId, repeatIndex, modelA, modelB) so the test is reproducible
 * but unbiased per (case, repeat).
 */
export function decidePairOrdering(
  rowA: QualityLatencyRow,
  rowB: QualityLatencyRow
): { left: QualityLatencyRow; right: QualityLatencyRow } {
  const key = createHash("sha1")
    .update(
      `${rowA.runId}|${rowA.caseId}|${rowA.repeatIndex}|${rowA.provider}:${rowA.model}|${rowB.provider}:${rowB.model}`
    )
    .digest("hex");
  const flip = parseInt(key.slice(0, 1), 16) % 2 === 1;
  return flip ? { left: rowB, right: rowA } : { left: rowA, right: rowB };
}

export async function comparePair(args: {
  judgeProvider: "openai" | "anthropic";
  judgeModel: string;
  client: PairwiseStructuredClient;
  caseDef: QualityLatencyCase;
  rowA: QualityLatencyRow;
  rowB: QualityLatencyRow;
}): Promise<PairwiseRow> {
  const { left, right } = decidePairOrdering(args.rowA, args.rowB);
  const leftId = pairwiseAnonymousIdFor(left, "left");
  const rightId = pairwiseAnonymousIdFor(right, "right");
  const userPrompt = buildPairwiseUserPrompt({
    caseUserInput: args.caseDef.userInput,
    caseScoringNotes: args.caseDef.scoringNotes,
    leftResponse: left.responseText,
    rightResponse: right.responseText,
    leftAnonymousId: leftId,
    rightAnonymousId: rightId,
  });

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
    try {
      const result = await args.client.comparePair({
        systemPrompt: PAIRWISE_SYSTEM_PROMPT,
        userPrompt,
      });
      return {
        runId: left.runId,
        caseId: left.caseId,
        repeatIndex: left.repeatIndex,
        judgeProvider: args.judgeProvider,
        judgeModel: args.judgeModel,
        leftAnonymousId: leftId,
        leftProvider: left.provider,
        leftModel: left.model,
        rightAnonymousId: rightId,
        rightProvider: right.provider,
        rightModel: right.model,
        winner: result.winner,
        reason: result.reason,
        errorMessage: "",
      };
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) break;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return {
    runId: left.runId,
    caseId: left.caseId,
    repeatIndex: left.repeatIndex,
    judgeProvider: args.judgeProvider,
    judgeModel: args.judgeModel,
    leftAnonymousId: leftId,
    leftProvider: left.provider,
    leftModel: left.model,
    rightAnonymousId: rightId,
    rightProvider: right.provider,
    rightModel: right.model,
    winner: "error",
    reason: "",
    errorMessage: message,
  };
}

/**
 * Aggregates pairwise rows into per-model win/loss/tie + simple Bradley-Terry
 * style log-likelihood scoring.
 */
export type PairwiseSummary = {
  modelKey: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  ties: number;
  total: number;
  winRate: number;
  btScore: number;
};

export function aggregatePairwise(rows: PairwiseRow[]): PairwiseSummary[] {
  const records = new Map<string, PairwiseSummary>();
  function ensure(provider: string, model: string): PairwiseSummary {
    const key = `${provider}:${model}`;
    let rec = records.get(key);
    if (!rec) {
      rec = {
        modelKey: key,
        provider,
        model,
        wins: 0,
        losses: 0,
        ties: 0,
        total: 0,
        winRate: 0,
        btScore: 0,
      };
      records.set(key, rec);
    }
    return rec;
  }

  for (const row of rows) {
    if (row.winner === "error") continue;
    const left = ensure(row.leftProvider, row.leftModel);
    const right = ensure(row.rightProvider, row.rightModel);
    left.total += 1;
    right.total += 1;
    if (row.winner === "tie") {
      left.ties += 1;
      right.ties += 1;
    } else if (row.winner === "left") {
      left.wins += 1;
      right.losses += 1;
    } else {
      right.wins += 1;
      left.losses += 1;
    }
  }

  const summaries = [...records.values()];
  for (const s of summaries) {
    const decisive = s.wins + s.losses;
    s.winRate = s.total === 0 ? 0 : (s.wins + 0.5 * s.ties) / s.total;
    // Simple log-odds proxy for BT score; tied dominators get small positive,
    // pure losers get negative. Not full MLE (which needs iteration), but
    // sufficient for blind ranking.
    if (decisive === 0) {
      s.btScore = 0;
    } else {
      const winsPlus = s.wins + 0.5;
      const lossesPlus = s.losses + 0.5;
      s.btScore = Math.log(winsPlus / lossesPlus);
    }
  }
  summaries.sort((a, b) => b.btScore - a.btScore);
  return summaries;
}
