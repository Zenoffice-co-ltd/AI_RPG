import { NextResponse, type NextRequest } from "next/server";
import {
  hasDemoApiAccess,
  validateSameOrigin,
} from "@/lib/roleplay/auth";
import {
  assertGrokFirstV50SessionPayload,
  createGrokFirstV50Session,
} from "@/lib/grok-first-roleplay/session";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) return safeError(403);
  if (!hasDemoApiAccess(request)) return safeError(401);
  try {
    const session = await createGrokFirstV50Session({ variant: "v50.1" });
    assertGrokFirstV50SessionPayload(session);
    return NextResponse.json(session);
  } catch {
    return safeError(503);
  }
}

export function GET() {
  return safeError(405, { Allow: "POST" });
}

function safeError(status: number, headers?: HeadersInit) {
  return NextResponse.json(
    { error: SAFE_ERROR },
    headers ? { status, headers } : { status }
  );
}
