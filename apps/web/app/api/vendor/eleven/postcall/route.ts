import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAppContext } from "@/server/appContext";
import { enqueueAdeccoEvaluationTask } from "@/server/cloudTasks";
import {
  ADECCO_AGENT_ID,
  extractAgentId,
  extractConversationId,
  extractSessionId,
  extractTranscriptArray,
  normalizeTranscript,
} from "@/server/elevenPostcall";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const ctx = getAppContext();
    if (!ctx.env.ENABLE_ELEVEN_WEBHOOKS) {
      return NextResponse.json({ status: "disabled" }, { status: 202 });
    }

    const payload: unknown = await request.json();
    const conversationId = extractConversationId(payload) ?? null;
    const sessionId = extractSessionId(payload, conversationId);
    const agentId = extractAgentId(payload);

    try {
      await ctx.repositories.sessions.saveArtifact({
        id: conversationId
          ? `eleven_postcall_${conversationId}`
          : `eleven_postcall_${Date.now()}`,
        kind: "eleven_webhook_payload",
        sessionId,
        createdAt: new Date().toISOString(),
        payload:
          typeof payload === "object" && payload
            ? (payload as Record<string, unknown>)
            : { raw: payload },
      });
    } catch (error) {
      console.warn("eleven_postcall_artifact_save_failed", error);
    }

    const targetAgentId =
      process.env["ADECCO_EVAL_ELEVEN_AGENT_ID"] ?? ADECCO_AGENT_ID;

    if (agentId !== targetAgentId) {
      return NextResponse.json({
        status: "ignored",
        reason: "agent_id_mismatch",
        agentId,
        targetAgentId,
      });
    }

    const transcript = extractTranscriptArray(payload);
    const normalizedTranscript = transcript ? normalizeTranscript(transcript) : null;
    const taskName = await enqueueAdeccoEvaluationTask({
      sessionId,
      conversationId,
      agentId: agentId ?? null,
      transcript: normalizedTranscript,
    });

    try {
      await ctx.repositories.sessions.saveArtifact({
        id: conversationId
          ? `adecco_eval_enqueue_${conversationId}`
          : `adecco_eval_enqueue_${Date.now()}`,
        kind: "eleven_webhook_payload",
        sessionId,
        createdAt: new Date().toISOString(),
        payload: {
          agentId,
          conversationId,
          taskName,
          transcriptTurnCount: normalizedTranscript?.length ?? 0,
        },
      });
    } catch (error) {
      console.warn("adecco_eval_enqueue_artifact_save_failed", error);
    }

    console.info(
      "adecco_eval_task_enqueued",
      JSON.stringify({
        sessionId,
        conversationId,
        agentId,
        taskName,
        transcriptTurnCount: normalizedTranscript?.length ?? 0,
      })
    );

    return NextResponse.json(
      {
        status: "accepted",
        evaluation: "enqueued",
        sessionId,
        conversationId,
        agentId,
        taskName,
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
