import { describe, expect, it } from "vitest";
import {
  normalizeAudioAlignmentEvent,
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

  it("keeps typed chat response metadata for streaming merge", () => {
    expect(
      normalizeAgentChatResponsePart({
        text: "承知",
        type: "delta",
        event_id: 100,
      })
    ).toMatchObject({
      role: "agent",
      text: "承知",
      isFinal: false,
      partType: "delta",
      sdkMessageId: "agent-chat-100",
    });

    expect(
      normalizeAgentChatResponsePart({
        text: "",
        type: "stop",
        event_id: 100,
      })
    ).toMatchObject({
      role: "agent",
      text: "",
      isFinal: true,
      partType: "stop",
      sdkMessageId: "agent-chat-100",
    });
  });

  it("drops tentative agent debug events so drafting text is not shown", () => {
    expect(
      normalizeConversationEvent({
        type: "tentative_agent_response",
        response: "確認しています。",
      })
    ).toBeNull();

    expect(
      normalizeConversationEvent({
        type: "internal_tentative_agent_response",
        tentative_agent_response_internal_event: {
          tentative_agent_response: "少々お待ちください。",
        },
      })
    ).toBeNull();
  });

  it("normalizes agent correction and audio alignment fallbacks", () => {
    expect(
      normalizeConversationEvent({
        type: "agent_response_correction",
        agent_response_correction_event: {
          corrected_agent_response: "訂正後の発話です。",
          event_id: 23,
        },
      })
    ).toMatchObject({
      role: "agent",
      text: "訂正後の発話です。",
      isFinal: true,
      channel: "voice",
      sdkMessageId: "agent-23",
    });

    expect(
      normalizeAudioAlignmentEvent({
        chars: ["受", "発", "注", "、", "在", "庫", "確", "認"],
        char_start_times_ms: [],
        char_durations_ms: [],
      })
    ).toMatchObject({
      role: "agent",
      text: "受発注、在庫確認",
      isFinal: false,
      channel: "voice",
      sdkMessageId: "agent-audio-alignment-latest",
    });
  });
});
