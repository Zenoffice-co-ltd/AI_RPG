import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateScenarioTestReply } from "@/server/use-cases/scenarioTest";

export const runtime = "nodejs";

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["assistant", "user"]),
        text: z.string().trim().min(1),
      })
    )
    .min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scenarioId: string }> }
) {
  try {
    const { scenarioId } = await params;
    const body = requestSchema.parse(await request.json());
    const result = await generateScenarioTestReply({
      scenarioId,
      messages: body.messages,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      message.startsWith("Scenario not found:") || message.startsWith("Scenario assets not found:")
        ? 404
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
