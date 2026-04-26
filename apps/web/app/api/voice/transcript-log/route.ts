import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";

const transcriptLogSchema = z.object({
  scenarioId: z.literal("adecco-orb"),
  conversationLocalId: z.string().min(1).max(160),
  generation: z.number().int().safe(),
  phase: z.enum(["sdk-received", "displayed", "local-user-message"]),
  role: z.enum(["agent", "user", "system"]),
  channel: z.enum(["voice", "chat", "system"]),
  status: z.enum(["interim", "final", "sending", "sent", "failed"]).optional(),
  source: z.enum(["sdk", "local", "mock", "system"]).optional(),
  text: z.string().max(8_000),
  sdkMessageId: z.string().max(240).optional(),
  clientMessageId: z.string().max(240).optional(),
  createdAt: z.number().safe().optional(),
});

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) {
    return safeError(403);
  }

  if (!hasDemoApiAccess(request)) {
    return safeError(401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeError(400);
  }

  const parsed = transcriptLogSchema.safeParse(body);
  if (!parsed.success) {
    return safeError(400);
  }

  const event = parsed.data;
  const normalizedText = normalizeLogText(event.text);
  console.info(JSON.stringify({
    message: "Roleplay transcript",
    scenarioId: event.scenarioId,
    conversationLocalId: event.conversationLocalId,
    generation: event.generation,
    phase: event.phase,
    role: event.role,
    channel: event.channel,
    status: event.status,
    source: event.source,
    text: event.text,
    textEscaped: escapeUnicode(event.text),
    textUtf8Base64: Buffer.from(event.text, "utf8").toString("base64"),
    textLength: event.text.length,
    normalizedTextHash: fnv1aHash(normalizedText),
    normalizedTextLength: normalizedText.length,
    sdkMessageId: event.sdkMessageId,
    clientMessageId: event.clientMessageId,
    createdAt: event.createdAt,
  }));

  return NextResponse.json({ ok: true });
}

export function GET() {
  return safeError(405, { Allow: "POST" });
}

function safeError(status: number, headers?: HeadersInit) {
  return NextResponse.json({ ok: false }, headers ? { status, headers } : { status });
}

function normalizeLogText(text: string) {
  return text.replace(/[\s、。，．,.！？!?"'「」『』（）()[\]［］【】]/g, "").trim();
}

function escapeUnicode(text: string) {
  return [...text]
    .map((char) => {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) {
        return "";
      }
      if (codePoint >= 0x20 && codePoint <= 0x7e) {
        return char;
      }
      return `\\u{${codePoint.toString(16)}}`;
    })
    .join("");
}

function fnv1aHash(text: string) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    hash ^= codePoint;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
