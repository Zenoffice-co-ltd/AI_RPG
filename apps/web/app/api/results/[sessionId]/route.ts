import { NextResponse } from "next/server";
import { getSessionResult } from "@/server/use-cases/analysis";

export const runtime = "nodejs";

export async function GET(
  _: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    const result = await getSessionResult(sessionId);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
