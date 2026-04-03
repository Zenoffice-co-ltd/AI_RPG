import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { analyzeSessionRequestSchema } from "@top-performer/domain";
import { analyzeSession } from "@/server/use-cases/analysis";
import { getAppContext } from "@/server/appContext";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get("x-queue-shared-secret");
    if (secret !== getAppContext().env.QUEUE_SHARED_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json();
    const payload = analyzeSessionRequestSchema.parse(body);
    return NextResponse.json(await analyzeSession(payload.sessionId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
