import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { renderScenarioAudioPreview } from "@/server/use-cases/audioPreview";

export const runtime = "nodejs";

const requestBodySchema = z.object({
  sampleKey: z.string().trim().min(1).max(64).optional(),
  text: z.string().trim().min(1).max(500).optional(),
});

function buildAudioResponse(
  audio: Uint8Array<ArrayBuffer>,
  scenarioId: string,
  fileStem: string
) {
  const body = new Blob([audio], { type: "audio/mpeg" });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename=\"${scenarioId}.${fileStem}.mp3\"`,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ scenarioId: string }> }
) {
  try {
    const { scenarioId } = await params;
    const sampleKey = request.nextUrl.searchParams.get("sample") ?? undefined;
    const text = request.nextUrl.searchParams.get("text") ?? undefined;
    const rendered = await renderScenarioAudioPreview({
      scenarioId,
      ...(sampleKey ? { sampleKey } : {}),
      ...(text ? { text } : {}),
    });
    return buildAudioResponse(audioFrom(rendered.audio), scenarioId, sampleKey ?? "preview");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Scenario not found:") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scenarioId: string }> }
) {
  try {
    const { scenarioId } = await params;
    const body = requestBodySchema.parse(await request.json());
    const rendered = await renderScenarioAudioPreview({
      scenarioId,
      ...(body.sampleKey ? { sampleKey: body.sampleKey } : {}),
      ...(body.text ? { text: body.text } : {}),
    });
    return buildAudioResponse(audioFrom(rendered.audio), scenarioId, "custom");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Scenario not found:") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function audioFrom(audio: Buffer) {
  const body = audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength
  ) as ArrayBuffer;
  return new Uint8Array(body);
}
