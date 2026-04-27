import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAppContext } from "@/server/appContext";
import type { AdeccoEvaluationTaskPayload } from "@/server/cloudTasks";
import {
  asRecord,
  extractAgentId,
  extractConversationId,
  extractTranscriptArray,
  normalizeTranscript,
} from "@/server/elevenPostcall";
import { runAdeccoOrderHearingEvaluation } from "@/server/use-cases/adeccoOrderHearingEval";

export const runtime = "nodejs";

function readIsoString(value: unknown) {
  return typeof value === "string" && value.length > 0
    ? value
    : new Date().toISOString();
}

export async function POST(request: NextRequest) {
  try {
    const ctx = getAppContext();
    const secret = request.headers.get("x-queue-shared-secret");
    if (secret !== ctx.env.QUEUE_SHARED_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json();
    const payload = asRecord(body) as Partial<AdeccoEvaluationTaskPayload> | null;
    const sessionId = payload?.sessionId;

    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    let conversationId =
      typeof payload?.conversationId === "string" && payload.conversationId
        ? payload.conversationId
        : null;
    let agentId =
      typeof payload?.agentId === "string" && payload.agentId
        ? payload.agentId
        : null;
    let transcript = Array.isArray(payload?.transcript)
      ? payload.transcript
      : null;
    let startedAt = new Date().toISOString();
    let endedAt = startedAt;

    if ((!transcript || transcript.length === 0) && conversationId) {
      const details = await ctx.vendors.elevenLabs.getConversationDetails(
        conversationId
      );
      const detailRecord = asRecord(details);
      transcript = normalizeTranscript(extractTranscriptArray(details) ?? []);
      conversationId = extractConversationId(details) ?? conversationId;
      agentId = extractAgentId(details) ?? agentId;
      startedAt = readIsoString(
        detailRecord?.["start_time"] ??
          detailRecord?.["started_at"] ??
          detailRecord?.["created_at"]
      );
      endedAt = readIsoString(
        detailRecord?.["end_time"] ??
          detailRecord?.["ended_at"] ??
          detailRecord?.["updated_at"]
      );

      try {
        await ctx.repositories.sessions.saveArtifact({
          id: `eleven_conversation_details_${conversationId}`,
          kind: "eleven_webhook_payload",
          sessionId,
          createdAt: new Date().toISOString(),
          payload: details,
        });
      } catch (error) {
        console.warn("eleven_conversation_details_artifact_save_failed", error);
      }
    }

    if (!transcript || transcript.length === 0) {
      console.info(
        "adecco_eval_task_skipped",
        JSON.stringify({
          sessionId,
          conversationId,
          agentId,
          reason: "transcript_not_available",
        })
      );
      return NextResponse.json(
        {
          status: "skipped",
          reason: "transcript_not_available",
          sessionId,
          conversationId,
          agentId,
        },
        { status: 202 }
      );
    }

    const result = await runAdeccoOrderHearingEvaluation({
      sessionId,
      conversationId,
      transcript,
      startedAt,
      endedAt,
      transcriptSource: "elevenlabs_postcall_webhook",
      asrQualityNote: "elevenlabs_postcall",
    });

    try {
      await ctx.repositories.sessions.saveArtifact({
        id: conversationId
          ? `adecco_eval_result_${conversationId}`
          : `adecco_eval_result_${Date.now()}`,
        kind: "eleven_webhook_payload",
        sessionId,
        createdAt: new Date().toISOString(),
        payload: {
          agentId,
          conversationId,
          result,
        },
      });
    } catch (error) {
      console.warn("adecco_eval_result_artifact_save_failed", error);
    }

    console.info(
      "adecco_eval_task_completed",
      JSON.stringify({
        sessionId,
        conversationId,
        agentId,
        model: result.model,
        usage: result.usage,
        validation: result.validation,
        mail: result.mail,
      })
    );

    return NextResponse.json({
      status: "completed",
      sessionId,
      conversationId,
      agentId,
      model: result.model,
      usage: result.usage,
      validation: result.validation,
      mail: result.mail,
      retryNote: result.retryNote,
    });
  } catch (error) {
    console.error("adecco_eval_task_failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
