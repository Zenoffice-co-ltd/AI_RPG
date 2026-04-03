import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { publishScenarioJob } from "@/server/use-cases/admin";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ scenarioId: string }> }
) {
  try {
    const { scenarioId } = await context.params;
    const body: unknown = await request.json();
    return NextResponse.json(
      await publishScenarioJob({
        ...(typeof body === "object" && body ? body : {}),
        scenarioId,
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
