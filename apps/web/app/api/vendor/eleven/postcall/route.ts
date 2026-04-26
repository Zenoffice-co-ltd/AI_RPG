import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAppContext } from "@/server/appContext";
import { randomUUID } from "node:crypto";
import {
  runAdeccoOrderHearingEvaluation,
  type NormalizedTurn,
} from "@/server/use-cases/adeccoOrderHearingEval";

export const runtime = "nodejs";

const ADECCO_AGENT_ID = "agent_2801kpj49tj1f43sr840cvy17zcc";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function getPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record || !(key in record)) {
      return undefined;
    }
    current = record[key];
  }
  return current;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function extractAgentId(payload: unknown) {
  return firstString(
    getPath(payload, ["agent_id"]),
    getPath(payload, ["agentId"]),
    getPath(payload, ["system__agent_id"]),
    getPath(payload, ["data", "agent_id"]),
    getPath(payload, ["data", "agentId"]),
    getPath(payload, ["data", "system__agent_id"]),
    getPath(payload, ["event", "agent_id"]),
    getPath(payload, ["conversation", "agent_id"])
  );
}

function extractConversationId(payload: unknown) {
  return firstString(
    getPath(payload, ["conversation_id"]),
    getPath(payload, ["conversationId"]),
    getPath(payload, ["system__conversation_id"]),
    getPath(payload, ["data", "conversation_id"]),
    getPath(payload, ["data", "conversationId"]),
    getPath(payload, ["data", "system__conversation_id"]),
    getPath(payload, ["event", "conversation_id"]),
    getPath(payload, ["conversation", "conversation_id"])
  );
}

function extractSessionId(payload: unknown, conversationId: string | null) {
  return (
    firstString(
      getPath(payload, ["sessionId"]),
      getPath(payload, ["session_id"]),
      getPath(payload, ["data", "sessionId"]),
      getPath(payload, ["data", "session_id"]),
      getPath(payload, [
        "data",
        "conversation_initiation_client_data",
        "dynamic_variables",
        "session_id",
      ]),
      getPath(payload, [
        "conversation_initiation_client_data",
        "dynamic_variables",
        "session_id",
      ])
    ) ?? conversationId ?? `eleven_${randomUUID().replaceAll("-", "").slice(0, 12)}`
  );
}

function extractTranscriptArray(payload: unknown): unknown[] | null {
  const candidates = [
    getPath(payload, ["transcript"]),
    getPath(payload, ["data", "transcript"]),
    getPath(payload, ["conversation", "transcript"]),
    getPath(payload, ["data", "conversation", "transcript"]),
  ];
  const transcript = candidates.find(Array.isArray);
  return Array.isArray(transcript) ? transcript : null;
}

function normalizeSpeaker(value: unknown): NormalizedTurn["speaker"] {
  const speaker = String(value ?? "").toLowerCase();
  if (["user", "human", "customer", "sales", "learner"].includes(speaker)) {
    return "sales";
  }
  if (["agent", "ai", "assistant", "client", "avatar"].includes(speaker)) {
    return "client";
  }
  return "unknown";
}

function normalizeTranscriptTurn(rawTurn: unknown, index: number): NormalizedTurn {
  const turn = asRecord(rawTurn) ?? {};
  const role = turn["role"] ?? turn["speaker"] ?? turn["source"] ?? turn["type"];
  const text =
    turn["text"] ??
    turn["message"] ??
    turn["transcript"] ??
    turn["content"] ??
    turn["utterance"] ??
    "";
  const timestamp =
    turn["timestamp_sec"] ??
    turn["time_in_call_secs"] ??
    turn["start_time"] ??
    turn["relative_timestamp"] ??
    index - 1;

  return {
    turn_id: String(
      turn["turn_id"] ??
        turn["turnId"] ??
        turn["id"] ??
        `t${String(index).padStart(3, "0")}`
    ),
    speaker: normalizeSpeaker(role),
    text: String(text),
    timestamp_sec: Number(timestamp) || 0,
  };
}

function normalizeTranscript(rawTranscript: unknown[]) {
  return rawTranscript.map((turn, index) =>
    normalizeTranscriptTurn(turn, index + 1)
  );
}

async function runAdeccoEvaluation(input: {
  sessionId: string;
  conversationId: string | null;
  transcript: unknown[];
}) {
  const startedAt = new Date().toISOString();
  const endedAt = new Date().toISOString();
  const result = await runAdeccoOrderHearingEvaluation({
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    transcript: normalizeTranscript(input.transcript),
    startedAt,
    endedAt,
    transcriptSource: "elevenlabs_postcall_webhook",
    asrQualityNote: "elevenlabs_postcall",
  });

  return {
    mode: "node",
    ...result,
  };
}

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

    if (sessionId) {
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

    let transcript = extractTranscriptArray(payload);
    if (!transcript && conversationId) {
      const details = await ctx.vendors.elevenLabs.getConversationDetails(
        conversationId
      );
      transcript = extractTranscriptArray(details);
      await ctx.repositories.sessions.saveArtifact({
        id: `eleven_conversation_details_${conversationId}`,
        kind: "eleven_webhook_payload",
        sessionId,
        createdAt: new Date().toISOString(),
        payload: details,
      });
    }

    if (!transcript || transcript.length === 0) {
      return NextResponse.json(
        {
          status: "accepted",
          evaluation: "skipped",
          reason: "transcript_not_available",
          sessionId,
          conversationId,
          agentId,
        },
        { status: 202 }
      );
    }

    const evaluation = await runAdeccoEvaluation({
      sessionId,
      conversationId,
      transcript,
    });

    await ctx.repositories.sessions.saveArtifact({
      id: conversationId
        ? `adecco_eval_launch_${conversationId}`
        : `adecco_eval_launch_${Date.now()}`,
      kind: "eleven_webhook_payload",
      sessionId,
      createdAt: new Date().toISOString(),
      payload: {
        agentId,
        conversationId,
        evaluation,
      },
    });

    return NextResponse.json({
      status: "accepted",
      evaluation: "launched",
      sessionId,
      conversationId,
      agentId,
      evaluationMode: evaluation.mode,
      model: evaluation.model,
      usage: evaluation.usage,
      validation: evaluation.validation,
      mail: evaluation.mail,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
