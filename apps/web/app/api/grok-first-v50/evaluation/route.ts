import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  buildPostSessionEvaluationInput,
  validateGrokFirstV50Evaluation,
} from "@/lib/grok-first-roleplay/evaluation-adapter";
import { logGrokFirstV50ServerEvent } from "@/lib/grok-first-roleplay/metrics";

const requestSchema = z.object({
  sessionId: z.string().min(1),
  transcript: z.array(
    z.object({
      turn_id: z.string().min(1),
      role: z.enum(["agent", "user"]),
      text: z.string(),
    })
  ),
  evaluation: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) return NextResponse.json({}, { status: 403 });
  if (!hasDemoApiAccess(request)) return NextResponse.json({}, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({}, { status: 400 });
    const adapterInput = buildPostSessionEvaluationInput(parsed.data);
    logGrokFirstV50ServerEvent({
      kind: "evaluation.requested",
      sessionId: parsed.data.sessionId,
      details: {
        turns: parsed.data.transcript.length,
        schema: adapterInput.requirements.schema,
        requiredRubricKeys: adapterInput.requirements.requiredRubricKeys,
      },
    });
    if (parsed.data.evaluation !== undefined) {
      const evaluation = validateGrokFirstV50Evaluation(parsed.data.evaluation);
      logGrokFirstV50ServerEvent({
        kind: "evaluation.completed",
        sessionId: parsed.data.sessionId,
        details: { total_score: evaluation.total_score },
      });
      return NextResponse.json({ ok: true, adapterInput, evaluation });
    }
    return NextResponse.json({ ok: true, adapterInput });
  } catch (error) {
    logGrokFirstV50ServerEvent({
      kind: "evaluation.failed",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({}, { status: 400 });
  }
}
