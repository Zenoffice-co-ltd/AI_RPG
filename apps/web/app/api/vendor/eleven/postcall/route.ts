import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAppContext } from "@/server/appContext";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const ctx = getAppContext();
    if (!ctx.env.ENABLE_ELEVEN_WEBHOOKS) {
      return NextResponse.json({ status: "disabled" }, { status: 202 });
    }

    const payload: unknown = await request.json();
    const sessionId =
      typeof payload === "object" &&
      payload &&
      "sessionId" in payload &&
      typeof payload.sessionId === "string"
        ? payload.sessionId
        : null;

    if (sessionId) {
      await ctx.repositories.sessions.saveArtifact({
        id: `eleven_postcall_${Date.now()}`,
        kind: "eleven_webhook_payload",
        sessionId,
        createdAt: new Date().toISOString(),
        payload:
          typeof payload === "object" && payload
            ? (payload as Record<string, unknown>)
            : { raw: payload },
      });
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
