import { NextResponse, type NextRequest } from "next/server";
import { hasDemoApiAccess } from "@/lib/roleplay/auth";
import {
  adeccoBrowserEvalSessionIdSchema,
  getAdeccoBrowserEvaluationResult,
} from "@/server/use-cases/adeccoBrowserEval";

const SAFE_ERROR =
  "評価結果の取得に失敗しました。時間をおいて再試行してください。";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!hasDemoApiAccess(request)) {
    return NextResponse.json({ error: SAFE_ERROR }, { status: 401 });
  }

  try {
    const parsed = adeccoBrowserEvalSessionIdSchema.safeParse(
      request.nextUrl.searchParams.get("sessionId")
    );
    if (!parsed.success) {
      return NextResponse.json({ error: SAFE_ERROR }, { status: 400 });
    }
    return NextResponse.json(
      await getAdeccoBrowserEvaluationResult(parsed.data)
    );
  } catch (error) {
    console.error(
      "adecco_browser_eval_result_failed",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json({ error: SAFE_ERROR }, { status: 500 });
  }
}
