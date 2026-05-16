import { NextResponse, type NextRequest } from "next/server";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  adeccoBrowserEvalStartSchema,
  isAdeccoBrowserEvaluationEnabled,
  startAdeccoBrowserEvaluation,
} from "@/server/use-cases/adeccoBrowserEval";

const SAFE_ERROR =
  "評価の開始に失敗しました。時間をおいて再試行してください。";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 403 });
  }
  if (!hasDemoApiAccess(request)) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 401 });
  }
  if (!isAdeccoBrowserEvaluationEnabled()) {
    return NextResponse.json(
      { error: SAFE_ERROR, status: "disabled" },
      { status: 409 }
    );
  }

  try {
    const parsed = adeccoBrowserEvalStartSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: SAFE_ERROR }, { status: 400 });
    }
    const { taskName } = await startAdeccoBrowserEvaluation(parsed.data);
    return NextResponse.json(
      {
        ok: true,
        status: "queued",
        sessionId: parsed.data.sessionId,
        taskName,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error(
      "adecco_browser_eval_start_failed",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json({ error: SAFE_ERROR }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json(
    { error: SAFE_ERROR },
    { status: 405, headers: { Allow: "POST" } }
  );
}
