"use client";

import type { TranscriptMessage } from "./conversation-types";

const LOCAL_ECHO_DEDUPE_MS = 5_000;
const AGENT_DEDUPE_MS = 180_000;
const AGENT_COMPETING_FINAL_MS = 3_000;

export type TranscriptAction =
  | { type: "reset"; messages?: TranscriptMessage[] }
  | { type: "append"; message: TranscriptMessage }
  | { type: "appendMany"; messages: TranscriptMessage[] }
  | {
      type: "updateStatus";
      clientMessageId: string;
      status: TranscriptMessage["status"];
    }
  | {
      type: "updateTextAndStatus";
      clientMessageId: string;
      text: string;
      status: TranscriptMessage["status"];
    };

export function transcriptReducer(
  current: TranscriptMessage[],
  action: TranscriptAction
) {
  switch (action.type) {
    case "reset":
      return orderMessages(action.messages ?? []);
    case "append":
      return mergeMessages(current, [action.message]);
    case "appendMany":
      return mergeMessages(current, action.messages);
    case "updateStatus":
      return current.map((message) =>
        message.clientMessageId === action.clientMessageId
          ? { ...message, status: action.status }
          : message
      );
    case "updateTextAndStatus":
      return current.map((message) =>
        message.clientMessageId === action.clientMessageId
          ? { ...message, text: action.text, status: action.status }
          : message
      );
  }
}

export function mergeMessages(
  current: TranscriptMessage[],
  incoming: TranscriptMessage[]
) {
  const merged = [...current];

  for (const nextMessage of incoming) {
    const sdkIndex = nextMessage.sdkMessageId
      ? merged.findIndex((message) => message.sdkMessageId === nextMessage.sdkMessageId)
      : -1;
    if (sdkIndex >= 0) {
      const currentMessage = merged[sdkIndex];
      if (currentMessage) {
        merged[sdkIndex] = mergeMessage(currentMessage, nextMessage);
      }
      continue;
    }

    const canonicalSdkIndex = findCanonicalAgentSdkIndex(merged, nextMessage);
    if (canonicalSdkIndex >= 0) {
      const currentMessage = merged[canonicalSdkIndex];
      if (currentMessage) {
        merged[canonicalSdkIndex] = mergeMessage(currentMessage, nextMessage);
      }
      continue;
    }

    const idIndex = merged.findIndex((message) => message.id === nextMessage.id);
    if (idIndex >= 0) {
      const currentMessage = merged[idIndex];
      if (currentMessage) {
        merged[idIndex] = mergeMessage(currentMessage, nextMessage);
      }
      continue;
    }

    const localEchoIndex = findLocalEchoIndex(merged, nextMessage);
    if (localEchoIndex >= 0) {
      const currentMessage = merged[localEchoIndex];
      if (!currentMessage) {
        continue;
      }
      merged[localEchoIndex] = mergeMessage(currentMessage, {
        ...nextMessage,
        id: currentMessage.id,
        clientMessageId: currentMessage.clientMessageId,
        status: currentMessage.status === "sending" ? "sent" : currentMessage.status,
      });
      continue;
    }

    const agentFallbackIndex = findAgentDuplicateIndex(merged, nextMessage);
    if (agentFallbackIndex >= 0) {
      const currentMessage = merged[agentFallbackIndex];
      if (!currentMessage) {
        continue;
      }
      merged[agentFallbackIndex] = mergeMessage(currentMessage, nextMessage);
      continue;
    }

    const competingAgentIndex = findRecentCompetingAgentIndex(merged, nextMessage);
    if (competingAgentIndex >= 0) {
      const currentMessage = merged[competingAgentIndex];
      if (!currentMessage) {
        continue;
      }
      merged[competingAgentIndex] = replaceAgentMessage(currentMessage, nextMessage);
      continue;
    }

    merged.push(nextMessage);
  }

  return orderMessages(merged);
}

function findCanonicalAgentSdkIndex(
  messages: TranscriptMessage[],
  incoming: TranscriptMessage
) {
  if (incoming.role !== "agent" || incoming.source !== "sdk") {
    return -1;
  }
  const incomingCanonicalId = canonicalAgentSdkMessageId(incoming.sdkMessageId);
  if (!incomingCanonicalId) {
    return -1;
  }

  return messages.findIndex((message) => {
    if (message.role !== "agent" || message.source !== "sdk") {
      return false;
    }
    return canonicalAgentSdkMessageId(message.sdkMessageId) === incomingCanonicalId;
  });
}

function findAgentDuplicateIndex(
  messages: TranscriptMessage[],
  incoming: TranscriptMessage
) {
  if (incoming.role !== "agent" || incoming.source !== "sdk") {
    return -1;
  }

  return messages.findIndex((message) => {
    if (message.role !== "agent" || message.source !== "sdk") {
      return false;
    }
    if (Math.abs(incoming.createdAt - message.createdAt) > AGENT_DEDUPE_MS) {
      return false;
    }
    const currentText = normalizeComparableText(message.text);
    const incomingText = normalizeComparableText(incoming.text);
    if (!currentText || !incomingText) {
      return false;
    }

    if (currentText === incomingText) {
      return true;
    }

    return (
      message.status === "interim" &&
      (incomingText.includes(currentText) || currentText.includes(incomingText))
    );
  });
}

function findRecentCompetingAgentIndex(
  messages: TranscriptMessage[],
  incoming: TranscriptMessage
) {
  if (
    incoming.role !== "agent" ||
    incoming.source !== "sdk" ||
    incoming.status !== "final"
  ) {
    return -1;
  }

  const incomingText = normalizeComparableText(incoming.text);
  if (incomingText.length < 8) {
    return -1;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.role === "user") {
      return -1;
    }
    if (
      message.role !== "agent" ||
      message.source !== "sdk" ||
      message.status !== "final"
    ) {
      continue;
    }
    if (Math.abs(incoming.createdAt - message.createdAt) > AGENT_COMPETING_FINAL_MS) {
      continue;
    }

    const currentText = normalizeComparableText(message.text);
    if (!currentText || currentText === incomingText) {
      continue;
    }

    if (isAgentSdkEventId(message.sdkMessageId) && isAgentSdkEventId(incoming.sdkMessageId)) {
      return index;
    }
  }

  return -1;
}

function normalizeComparableText(text: string) {
  return text.replace(/[\s、。，．,.！？!?"'「」『』（）()[\]［］【】]/g, "").trim();
}

function isAgentSdkEventId(sdkMessageId: string | undefined) {
  return /^agent(?:-chat)?-\d+$/.test(sdkMessageId ?? "");
}

function canonicalAgentSdkMessageId(sdkMessageId: string | undefined) {
  const match = sdkMessageId?.match(/^agent(?:-chat)?-(\d+)$/);
  return match?.[1] ? `agent-event-${match[1]}` : "";
}

export function orderMessages(messages: TranscriptMessage[]) {
  return [...messages].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.id.localeCompare(right.id);
  });
}

function mergeMessage(
  current: TranscriptMessage,
  incoming: TranscriptMessage
): TranscriptMessage {
  return {
    ...current,
    ...incoming,
    id: current.id,
    clientMessageId: current.clientMessageId ?? incoming.clientMessageId,
    sdkMessageId: current.sdkMessageId ?? incoming.sdkMessageId,
    createdAt: Math.min(current.createdAt, incoming.createdAt),
  };
}

function replaceAgentMessage(
  current: TranscriptMessage,
  incoming: TranscriptMessage
): TranscriptMessage {
  return {
    ...current,
    ...incoming,
    id: current.id,
    clientMessageId: current.clientMessageId ?? incoming.clientMessageId,
    createdAt: Math.min(current.createdAt, incoming.createdAt),
  };
}

function findLocalEchoIndex(
  messages: TranscriptMessage[],
  incoming: TranscriptMessage
) {
  if (incoming.role !== "user" || incoming.source !== "sdk") {
    return -1;
  }

  return messages.findIndex((message) => {
    if (message.role !== "user" || message.source !== "local") {
      return false;
    }
    if (message.text.trim() !== incoming.text.trim()) {
      return false;
    }
    return Math.abs(incoming.createdAt - message.createdAt) <= LOCAL_ECHO_DEDUPE_MS;
  });
}

export function createTranscriptMessage(
  input: Omit<TranscriptMessage, "id" | "createdAt"> & {
    id?: string;
    createdAt?: number;
  }
): TranscriptMessage {
  const createdAt = input.createdAt ?? Date.now();
  return {
    ...input,
    id:
      input.id ??
      `${input.source}-${input.role}-${input.channel}-${createdAt}-${Math.random()
        .toString(36)
        .slice(2)}`,
    createdAt,
  };
}
