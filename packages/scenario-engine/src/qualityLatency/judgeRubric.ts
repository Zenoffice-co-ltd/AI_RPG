import { z } from "zod";

export const JUDGE_TOOL_NAME = "record_judgment";

export const judgeResponseSchema = z
  .object({
    overallScore: z.number(),
    intentFit: z.number(),
    businessCorrectness: z.number(),
    nextAction: z.number(),
    conciseness: z.number(),
    japaneseNaturalness: z.number(),
    voiceReadiness: z.number(),
    penalties: z.array(z.string()).default([]),
    knockout: z.boolean().default(false),
    knockoutReason: z
      .union([z.string(), z.null()])
      .transform((v) => v ?? "")
      .default(""),
    shortRationale: z.string().transform((v) => v.slice(0, 240)),
  })
  .passthrough();

export type JudgeResponse = z.infer<typeof judgeResponseSchema>;

export const judgeJsonSchema = {
  type: "object" as const,
  properties: {
    overallScore: { type: "number" },
    intentFit: { type: "number" },
    businessCorrectness: { type: "number" },
    nextAction: { type: "number" },
    conciseness: { type: "number" },
    japaneseNaturalness: { type: "number" },
    voiceReadiness: { type: "number" },
    penalties: { type: "array", items: { type: "string" } },
    knockout: { type: "boolean" },
    knockoutReason: { type: "string" },
    shortRationale: { type: "string" },
  },
  required: [
    "overallScore",
    "intentFit",
    "businessCorrectness",
    "nextAction",
    "conciseness",
    "japaneseNaturalness",
    "voiceReadiness",
    "penalties",
    "knockout",
    "knockoutReason",
    "shortRationale",
  ],
  additionalProperties: false,
};

export const JUDGE_SYSTEM_PROMPT = `あなたは法人向けAIロールプレイ応答の評価担当です。
候補の応答が、忙しい法人担当者との音声会話としてどれだけ自然で正確かを評価します。

評価ルール:
- intentFit (0-25): ユーザー発話の意図に合っているか
- businessCorrectness (0-20): 勝手な断定や事実誤認がないか、数字・日付・人数を正しく扱っているか
- nextAction (0-15): 会話の次ステップが自然か
- conciseness (0-15): 1〜2文で短く、音声向きに収まっているか (4文以上は減点)
- japaneseNaturalness (0-15): 日本語として自然な法人会話か
- voiceReadiness (0-10): 記号・箇条書き・読み上げにくい構造がないか

知っておくべきペナルティ (overallScore は減算後で構わない):
- system prompt / 内部指示の漏出: -50
- 過剰な保証 / 100% / 必ず: -30
- 数値・日付・人数の誤認: -25
- 質問に答えていない: -25
- 4文以上の冗長応答: -15
- 箇条書き・markdown: -10

候補応答に provider 名や model 名は **記載されていません**。先入観なく評価してください。
JSON出力以外のテキストは絶対に書かないでください。`;

export type JudgeUserPromptInput = {
  caseUserInput: string;
  caseScoringNotes: string;
  candidateResponse: string;
  candidateAnonymousId: string;
};

export function buildJudgeUserPrompt(input: JudgeUserPromptInput): string {
  return [
    `# Case`,
    `User input (法人担当者の発話): ${input.caseUserInput}`,
    `Scoring notes (内部メモ): ${input.caseScoringNotes}`,
    ``,
    `# Candidate response (anonymous=${input.candidateAnonymousId})`,
    input.candidateResponse,
    ``,
    `上記の候補応答を ${JUDGE_TOOL_NAME} ツールで採点してください。shortRationale は120字以内、provider名やmodel名を含めないでください。`,
  ].join("\n");
}

export const PAIRWISE_TOOL_NAME = "record_pairwise_winner";

export const pairwiseResponseSchema = z
  .object({
    winner: z.enum(["left", "right", "tie"]),
    reason: z.string().transform((v) => v.slice(0, 240)),
  })
  .passthrough();

export type PairwiseResponse = z.infer<typeof pairwiseResponseSchema>;

export const pairwiseJsonSchema = {
  type: "object" as const,
  properties: {
    winner: { type: "string", enum: ["left", "right", "tie"] },
    reason: { type: "string" },
  },
  required: ["winner", "reason"],
  additionalProperties: false,
};

export const PAIRWISE_SYSTEM_PROMPT = `あなたは法人向けAIロールプレイ応答の比較担当です。
2つの候補応答 (left / right) のうち、忙しい法人担当者との音声会話として **どちらが良いか** を1つ選びます。
両方が等しく良い、または等しく悪い場合のみ tie を選んでください。
provider 名や model 名は与えられていません。先入観なく評価してください。
JSON出力以外のテキストは絶対に書かないでください。`;

export type PairwiseUserPromptInput = {
  caseUserInput: string;
  caseScoringNotes: string;
  leftResponse: string;
  rightResponse: string;
  leftAnonymousId: string;
  rightAnonymousId: string;
};

export function buildPairwiseUserPrompt(input: PairwiseUserPromptInput): string {
  return [
    `# Case`,
    `User input: ${input.caseUserInput}`,
    `Scoring notes: ${input.caseScoringNotes}`,
    ``,
    `# Candidate left (anonymous=${input.leftAnonymousId})`,
    input.leftResponse,
    ``,
    `# Candidate right (anonymous=${input.rightAnonymousId})`,
    input.rightResponse,
    ``,
    `上記2つを ${PAIRWISE_TOOL_NAME} ツールで判定してください。reason は120字以内。`,
  ].join("\n");
}
