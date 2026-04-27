import { randomUUID } from "node:crypto";
import type { NormalizedTurn } from "./use-cases/adeccoOrderHearingEval";

export const ADECCO_AGENT_ID = "agent_2801kpj49tj1f43sr840cvy17zcc";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function getPath(value: unknown, path: string[]): unknown {
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
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

function scalarToString(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

export function extractAgentId(payload: unknown) {
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

export function extractConversationId(payload: unknown) {
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

export function extractSessionId(payload: unknown, conversationId: string | null) {
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

export function extractTranscriptArray(payload: unknown): unknown[] | null {
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
  const speaker = scalarToString(value).toLowerCase();
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
    turn_id: scalarToString(
      turn["turn_id"] ??
        turn["turnId"] ??
        turn["id"] ??
        `t${String(index).padStart(3, "0")}`
    ),
    speaker: normalizeSpeaker(role),
    text: scalarToString(text),
    timestamp_sec: Number(timestamp) || 0,
  };
}

export function normalizeTranscript(rawTranscript: unknown[]) {
  return rawTranscript.map((turn, index) =>
    normalizeTranscriptTurn(turn, index + 1)
  );
}
