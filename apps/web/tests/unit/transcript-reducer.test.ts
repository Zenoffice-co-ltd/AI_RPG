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
});
