import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AnthropicMessagesStructuredClient,
  OpenAiResponsesClient,
} from "@top-performer/vendors";
import {
  JUDGE_SYSTEM_PROMPT,
  JUDGE_TOOL_NAME,
  buildJudgeUserPrompt,
  judgeJsonSchema,
  judgeResponseSchema,
  type JudgeResponse,
} from "./judgeRubric";
import type { JudgeScoreRow, QualityLatencyCase, QualityLatencyRow } from "./types";

export type JudgeModelSpec = {
  provider: "openai" | "anthropic";
  model: string;
};

export interface JudgeStructuredClient {
  judge(args: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<JudgeResponse>;
}

export class OpenAiJudgeClient implements JudgeStructuredClient {
  constructor(
    private readonly responses: OpenAiResponsesClient,
    private readonly model: string
  ) {}

  async judge(args: { systemPrompt: string; userPrompt: string }): Promise<JudgeResponse> {
    return this.responses.createStructuredOutput({
      model: this.model,
      schemaName: "judge_response",
      jsonSchema: judgeJsonSchema,
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt,
      responseSchema: judgeResponseSchema,
    });
  }
}

export class AnthropicJudgeClient implements JudgeStructuredClient {
  constructor(
    private readonly client: AnthropicMessagesStructuredClient,
    private readonly model: string
  ) {}

  async judge(args: { systemPrompt: string; userPrompt: string }): Promise<JudgeResponse> {
    const result = await this.client.createStructuredOutput({
      model: this.model,
      systemPrompt: args.systemPrompt,
      userMessage: args.userPrompt,
      toolName: JUDGE_TOOL_NAME,
      toolDescription: "Record the structured judgment for the candidate response.",
      jsonSchema: judgeJsonSchema,
      responseSchema: judgeResponseSchema,
      maxOutputTokens: 1024,
    });
    return result.parsed;
  }
}

export function anonymousIdFor(row: QualityLatencyRow): string {
  return createHash("sha1")
    .update(`${row.runId}|${row.provider}|${row.model}|${row.caseId}|${row.repeatIndex}`)
    .digest("hex")
    .slice(0, 12);
}

const RETRY_LIMIT = 1;

function isRetryableJudgeError(error: unknown): boolean {
  if (error instanceof z.ZodError) return true;
  const message = error instanceof Error ? error.message : "";
  return /JSON|parse|tool_use/i.test(message);
}

export async function judgeOneRow(args: {
  judgeProvider: "openai" | "anthropic";
  judgeModel: string;
  judgeClient: JudgeStructuredClient;
  row: QualityLatencyRow;
  caseDef: QualityLatencyCase;
}): Promise<JudgeScoreRow> {
  const anonymousId = anonymousIdFor(args.row);
  const userPrompt = buildJudgeUserPrompt({
    caseUserInput: args.caseDef.userInput,
    caseScoringNotes: args.caseDef.scoringNotes,
    candidateResponse: args.row.responseText,
    candidateAnonymousId: anonymousId,
  });

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
    try {
      const result = await args.judgeClient.judge({
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        userPrompt,
      });
      return {
        runId: args.row.runId,
        caseId: args.row.caseId,
        candidateProvider: args.row.provider,
        candidateModel: args.row.model,
        repeatIndex: args.row.repeatIndex,
        judgeProvider: args.judgeProvider,
        judgeModel: args.judgeModel,
        status: "success",
        overallScore: result.overallScore,
        intentFit: result.intentFit,
        businessCorrectness: result.businessCorrectness,
        nextAction: result.nextAction,
        conciseness: result.conciseness,
        japaneseNaturalness: result.japaneseNaturalness,
        voiceReadiness: result.voiceReadiness,
        penalties: result.penalties.join("|"),
        knockout: result.knockout,
        knockoutReason: result.knockoutReason ?? "",
        shortRationale: result.shortRationale,
        errorMessage: "",
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableJudgeError(error)) break;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return {
    runId: args.row.runId,
    caseId: args.row.caseId,
    candidateProvider: args.row.provider,
    candidateModel: args.row.model,
    repeatIndex: args.row.repeatIndex,
    judgeProvider: args.judgeProvider,
    judgeModel: args.judgeModel,
    status: "failed",
    overallScore: null,
    intentFit: null,
    businessCorrectness: null,
    nextAction: null,
    conciseness: null,
    japaneseNaturalness: null,
    voiceReadiness: null,
    penalties: "",
    knockout: false,
    knockoutReason: "",
    shortRationale: "",
    errorMessage: message,
  };
}
