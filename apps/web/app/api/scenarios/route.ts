import { NextResponse } from "next/server";
import { listScenarios } from "@/server/use-cases/scenarios";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listScenarios());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
