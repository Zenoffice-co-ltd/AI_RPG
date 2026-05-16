import { NextResponse, type NextRequest } from "next/server";
import { getAppContext } from "@/server/appContext";
import { processAdeccoBrowserEvaluationTask } from "@/server/use-cases/adeccoBrowserEval";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const ctx = getAppContext();
    const secret = request.headers.get("x-queue-shared-secret");
    if (secret !== ctx.env.QUEUE_SHARED_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await processAdeccoBrowserEvaluationTask(
      await request.json()
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "adecco_browser_eval_task_failed",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { error: "評価に失敗しました。時間をおいて再試行してください。" },
      { status: 500 }
    );
  }
}
