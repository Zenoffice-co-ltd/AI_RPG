import { z } from "zod";

export const grokFirstV50EvaluationSchema = z.object({
  total_score: z.number().min(0).max(100),
  must_capture: z.object({
    capture_level: z.number().min(0).max(5),
    evidence: z.array(
      z.object({
        turn_id: z.string().min(1),
        quote: z.string().min(1),
      })
    ),
  }),
  culture_fit: z.object({
    score: z.number().min(0).max(10),
    evidence: z.array(z.object({ turn_id: z.string(), quote: z.string() })),
  }),
  management_style: z.object({
    score: z.number().min(0).max(10),
    evidence: z.array(z.object({ turn_id: z.string(), quote: z.string() })),
  }),
  job_level_timeline: z.object({
    score: z.number().min(0).max(10),
    evidence: z.array(z.object({ turn_id: z.string(), quote: z.string() })),
  }),
  ai_preleaked_facts_counted_as_learner_capture: z.literal(false),
  learner_feedback: z.object({
    strengths: z.array(z.string()).min(1),
    missing_perspectives: z.array(z.string()).min(1),
    next_question_examples: z.array(z.string()).min(1),
    priority_improvement_actions: z.array(z.string()).min(3),
  }),
});

export type GrokFirstV50Evaluation = z.infer<
  typeof grokFirstV50EvaluationSchema
>;

export type GrokFirstV50TranscriptTurn = {
  turn_id: string;
  role: "agent" | "user";
  text: string;
};

export function buildPostSessionEvaluationInput(input: {
  sessionId: string;
  transcript: GrokFirstV50TranscriptTurn[];
}) {
  return {
    sessionId: input.sessionId,
    transcript: input.transcript,
    requirements: {
      schema: "grokFirstV50EvaluationSchema",
      sameTranscriptFiveRunTotalScoreVarianceMax: 2,
      mustCaptureLevelVarianceMax: 0.5,
      requireTurnIdAndQuoteForAllScoredEvidence: true,
      aiPreleakedFactsCountAsLearnerCapture: false,
      requiredRubricKeys: [
        "culture_fit",
        "management_style",
        "job_level_timeline",
      ],
      requiredFeedbackKeys: [
        "strengths",
        "missing_perspectives",
        "next_question_examples",
        "priority_improvement_actions",
      ],
    },
  };
}

export function validateGrokFirstV50Evaluation(
  payload: unknown
): GrokFirstV50Evaluation {
  return grokFirstV50EvaluationSchema.parse(payload);
}
