"use client";

export type NormalizedConversationEvent = {
  role: "agent" | "user";
  text: string;
  isFinal: boolean;
  sdkMessageId?: string | undefined;
  channel: "voice" | "chat";
};

export function normalizeConversationEvent(
  event: unknown
): NormalizedConversationEvent | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const record = event as Record<string, unknown>;

  const messagePayload = normalizeMessagePayload(record);
  if (messagePayload) {
    return messagePayload;
  }

  const rawType = stringValue(record["type"]);
  if (rawType === "agent_response") {
    return normalizeAgentResponse(record);
  }
  if (rawType === "user_transcript" || rawType === "tentative_user_transcript") {
    return normalizeUserTranscript(record, rawType === "user_transcript");
  }
  if (rawType === "agent_chat_response_part") {
    return normalizeAgentChatPart(record);
  }

  return null;
}

export function normalizeAgentChatResponsePart(
  part: unknown
): NormalizedConversationEvent | null {
  if (!part || typeof part !== "object") {
    return null;
  }

  const record = part as Record<string, unknown>;
  const text = stringValue(record["text"]);
  if (!text.trim()) {
    return null;
  }

  const eventId = numberOrString(record["event_id"]);
  const partType = stringValue(record["type"]);
  return {
    role: "agent",
    text,
    isFinal: partType === "stop",
    channel: "chat",
    sdkMessageId: eventId ? `agent-chat-${eventId}` : undefined,
  };
}

function normalizeMessagePayload(
  record: Record<string, unknown>
): NormalizedConversationEvent | null {
  const text =
    stringValue(record["message"]) ||
    stringValue(record["text"]) ||
    stringValue(record["transcript"]);
  if (!text.trim()) {
    return null;
  }

  const role = normalizeRole(record["role"] ?? record["source"] ?? record["type"]);
  if (!role) {
    return null;
  }

  const eventId = numberOrString(record["event_id"] ?? record["id"]);
  return {
    role,
    text,
    isFinal: true,
    channel: role === "user" ? "voice" : "voice",
    sdkMessageId: eventId ? `${role}-${eventId}` : undefined,
  };
}

function normalizeAgentResponse(
  record: Record<string, unknown>
): NormalizedConversationEvent | null {
  const payload = nestedRecord(record["agent_response_event"]);
  const text = stringValue(payload?.["agent_response"]);
  if (!text.trim()) {
    return null;
  }
  const eventId = numberOrString(payload?.["event_id"]);
  return {
    role: "agent",
    text,
    isFinal: true,
    channel: "voice",
    sdkMessageId: eventId ? `agent-${eventId}` : undefined,
  };
}

function normalizeUserTranscript(
  record: Record<string, unknown>,
  isFinal: boolean
): NormalizedConversationEvent | null {
  const payload =
    nestedRecord(record["user_transcription_event"]) ??
    nestedRecord(record["tentative_user_transcription_event"]);
  const text = stringValue(payload?.["user_transcript"]);
  if (!text.trim()) {
    return null;
  }
  const eventId = numberOrString(payload?.["event_id"]);
  return {
    role: "user",
    text,
    isFinal,
    channel: "voice",
    sdkMessageId: eventId ? `user-${eventId}` : undefined,
  };
}

function normalizeAgentChatPart(
  record: Record<string, unknown>
): NormalizedConversationEvent | null {
  return normalizeAgentChatResponsePart(record["text_response_part"]);
}

function normalizeRole(value: unknown) {
  const role = stringValue(value).toLowerCase();
  if (role === "agent" || role === "ai" || role === "assistant") {
    return "agent" as const;
  }
  if (role === "user" || role === "human") {
    return "user" as const;
  }
  return null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberOrString(value: unknown) {
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  return "";
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
