import { describe, expect, it } from "vitest";
import {
  createTranscriptMessage,
  transcriptReducer,
} from "../../lib/roleplay/transcript-reducer";

describe("transcriptReducer", () => {
  it("orders messages and updates sending status", () => {
    const sending = createTranscriptMessage({
      id: "client-1",
      clientMessageId: "client-1",
      role: "user",
      channel: "chat",
      text: "募集背景を教えてください。",
      status: "sending",
      source: "local",
      createdAt: 20,
    });

    const agent = createTranscriptMessage({
      id: "agent-1",
      role: "agent",
      channel: "voice",
      text: "承知しました。",
      status: "final",
      source: "sdk",
      createdAt: 10,
    });

    const appended = transcriptReducer([], { type: "appendMany", messages: [sending, agent] });
    expect(appended.map((message) => message.id)).toEqual(["agent-1", "client-1"]);

    const sent = transcriptReducer(appended, {
      type: "updateStatus",
      clientMessageId: "client-1",
      status: "sent",
    });
    expect(sent.find((message) => message.id === "client-1")?.status).toBe("sent");
  });

  it("dedupes local sent text echoed by SDK within five seconds", () => {
    const local = createTranscriptMessage({
      id: "client-1",
      clientMessageId: "client-1",
      role: "user",
      channel: "chat",
      text: "募集背景を教えてください。",
      status: "sent",
      source: "local",
      createdAt: 1_000,
    });

    const echo = createTranscriptMessage({
      id: "sdk-user-1",
      sdkMessageId: "user-1",
      role: "user",
      channel: "voice",
      text: "募集背景を教えてください。",
      status: "final",
      source: "sdk",
      createdAt: 3_000,
    });

    const deduped = transcriptReducer([local], { type: "append", message: echo });
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.sdkMessageId).toBe("user-1");
  });

  it("updates a failed message for retry without adding a duplicate bubble", () => {
    const failed = createTranscriptMessage({
      id: "client-1",
      clientMessageId: "client-1",
      role: "user",
      channel: "chat",
      text: "古い文言",
      status: "failed",
      source: "local",
      createdAt: 1,
    });

    const retrying = transcriptReducer([failed], {
      type: "updateTextAndStatus",
      clientMessageId: "client-1",
      text: "募集背景を教えてください。",
      status: "sending",
    });

    expect(retrying).toHaveLength(1);
    expect(retrying[0]).toMatchObject({
      text: "募集背景を教えてください。",
      status: "sending",
    });
  });

  it("merges final agent text into an audio-alignment fallback bubble", () => {
    const fallback = createTranscriptMessage({
      id: "agent-audio-1",
      sdkMessageId: "agent-audio-1",
      role: "agent",
      channel: "voice",
      text: "受発注、在庫確認",
      status: "interim",
      source: "sdk",
      createdAt: 1_000,
    });

    const final = createTranscriptMessage({
      id: "agent-final-1",
      sdkMessageId: "agent-77",
      role: "agent",
      channel: "chat",
      text: "受発注、在庫確認が中心です。",
      status: "final",
      source: "sdk",
      createdAt: 2_000,
    });

    const merged = transcriptReducer([fallback], { type: "append", message: final });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "agent-audio-1",
      sdkMessageId: "agent-audio-1",
      text: "受発注、在庫確認が中心です。",
      status: "final",
    });
  });

  it("dedupes exact agent text arriving through separate SDK event channels", () => {
    const voice = createTranscriptMessage({
      id: "agent-voice-1",
      sdkMessageId: "agent-voice-1",
      role: "agent",
      channel: "voice",
      text: "承知しました。少し整理しますね。",
      status: "final",
      source: "sdk",
      createdAt: 1_000,
    });

    const chat = createTranscriptMessage({
      id: "agent-chat-1",
      sdkMessageId: "agent-chat-1",
      role: "agent",
      channel: "chat",
      text: "承知しました。少し整理しますね。",
      status: "final",
      source: "sdk",
      createdAt: 1_200,
    });

    const deduped = transcriptReducer([voice], { type: "append", message: chat });
    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      id: "agent-voice-1",
      text: "承知しました。少し整理しますね。",
      status: "final",
    });
  });

  it("merges agent-chat and agent final events that share the SDK event id", () => {
    const chat = createTranscriptMessage({
      id: "agent-chat-497",
      sdkMessageId: "agent-chat-497",
      role: "agent",
      channel: "chat",
      text: "現行ベンダーに加えて、もう一社の大手にも相談中です。",
      status: "final",
      source: "sdk",
      createdAt: 1_000,
    });

    const voice = createTranscriptMessage({
      id: "agent-voice-497",
      sdkMessageId: "agent-497",
      role: "agent",
      channel: "voice",
      text: "現行ベンダーに加えて、もう一社の大手にも相談中です。",
      status: "final",
      source: "sdk",
      createdAt: 1_200,
    });

    const merged = transcriptReducer([chat], { type: "append", message: voice });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "agent-chat-497",
      sdkMessageId: "agent-chat-497",
      channel: "voice",
      text: "現行ベンダーに加えて、もう一社の大手にも相談中です。",
      status: "final",
    });
  });

  it("dedupes agent text with punctuation-only differences", () => {
    const first = createTranscriptMessage({
      id: "agent-chat-496",
      sdkMessageId: "agent-chat-496",
      role: "agent",
      channel: "chat",
      text: "現行ベンダーに加えて、もう一社の大手にも相談中です。",
      status: "final",
      source: "sdk",
      createdAt: 1_000,
    });

    const second = createTranscriptMessage({
      id: "agent-chat-497",
      sdkMessageId: "agent-chat-497",
      role: "agent",
      channel: "chat",
      text: "現行ベンダーに加えてもう一社の大手にも相談中です",
      status: "final",
      source: "sdk",
      createdAt: 1_200,
    });

    const deduped = transcriptReducer([first], { type: "append", message: second });
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.text).toBe(
      "現行ベンダーに加えてもう一社の大手にも相談中です"
    );
  });
});
