import { NextResponse } from "next/server";
import { endSession } from "@/server/use-cases/sessions";

export const runtime = "nodejs";

export async function POST(
  _: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    return NextResponse.json(await endSession(sessionId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
