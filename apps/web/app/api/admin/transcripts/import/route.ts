import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { importTranscriptsJob } from "@/server/use-cases/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const payload: unknown = await request.json();
    return NextResponse.json(await importTranscriptsJob(payload));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
