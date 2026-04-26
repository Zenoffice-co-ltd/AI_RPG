import { describe, expect, it } from "vitest";
import {
  normalizeAgentChatResponsePart,
  normalizeConversationEvent,
} from "../../lib/roleplay/normalize-conversation-event";

describe("normalizeConversationEvent", () => {
  it("normalizes SDK agent and user message payloads", () => {
    expect(
      normalizeConversationEvent({
        message: "こんにちは",
        role: "agent",
        event_id: 1,
      })
    ).toMatchObject({
      role: "agent",
      text: "こんにちは",
      isFinal: true,
      sdkMessageId: "agent-1",
    });

    expect(
      normalizeConversationEvent({
        message: "募集背景を教えてください。",
        source: "user",
        event_id: 2,
      })
    ).toMatchObject({
      role: "user",
      text: "募集背景を教えてください。",
      isFinal: true,
      sdkMessageId: "user-2",
    });
  });

  it("normalizes raw user transcript events and drops empty text", () => {
    expect(
      normalizeConversationEvent({
        type: "user_transcript",
        user_transcription_event: {
          user_transcript: "音声の発話です。",
          event_id: 8,
        },
      })
    ).toMatchObject({
      role: "user",
      text: "音声の発話です。",
      channel: "voice",
      isFinal: true,
      sdkMessageId: "user-8",
    });

    expect(normalizeConversationEvent({ message: "", role: "agent" })).toBeNull();
    expect(normalizeConversationEvent({ message: null, role: "agent" })).toBeNull();
  });

  it("normalizes typed agent chat response parts only through the adapter", () => {
    expect(
      normalizeAgentChatResponsePart({
        text: "承知しました。",
        type: "stop",
        event_id: 99,
      })
    ).toMatchObject({
      role: "agent",
      text: "承知しました。",
      channel: "chat",
      sdkMessageId: "agent-chat-99",
    });
  });
});
