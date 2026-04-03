import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionTranscript } from "@/server/use-cases/sessions";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    const cursor = Number(request.nextUrl.searchParams.get("cursor") ?? "0");
    return NextResponse.json(await getSessionTranscript(sessionId, cursor));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
