import { describe, expect, it } from "vitest";
import {
  buildMockAgentResponse,
  canSendMessage,
  transcriptReducer,
} from "../../lib/roleplay/transcript";

describe("roleplay transcript", () => {
  it("orders messages by timestamp", () => {
    const messages = transcriptReducer([], {
      type: "appendMany",
      messages: [
        { id: "b", role: "user", text: "b", at: 2 },
        { id: "a", role: "agent", text: "a", at: 1 },
      ],
    });
    expect(messages.map((message) => message.id)).toEqual(["a", "b"]);
  });

  it("prevents empty message sends", () => {
    expect(canSendMessage("   ")).toBe(false);
    expect(canSendMessage("こんにちは")).toBe(true);
  });

  it("returns deterministic mock responses", () => {
    expect(buildMockAgentResponse("募集背景を教えてください", 1).text).toContain(
      "現行ベンダー"
    );
  });
});
