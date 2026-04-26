import { describe, expect, it, vi } from "vitest";
import { issueConversationToken } from "../../lib/roleplay/voice-session";

describe("voice session token", () => {
  it("maps upstream token to conversation token", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ token: "conversation-token" }), { status: 200 })
      )
    );
    await expect(
      issueConversationToken({
        env: {
          ELEVENLABS_API_KEY: "key",
          ELEVENLABS_AGENT_ID: "agent",
          ELEVENLABS_BRANCH_ID: "branch",
          ELEVENLABS_ENVIRONMENT: "production",
        },
        participantName: "demo-user",
        fetchImpl,
      })
    ).resolves.toBe("conversation-token");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries one upstream failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "conversation-token" }), { status: 200 })
      );
    await expect(
      issueConversationToken({
        env: {
          ELEVENLABS_API_KEY: "key",
          ELEVENLABS_AGENT_ID: "agent",
          ELEVENLABS_BRANCH_ID: "branch",
          ELEVENLABS_ENVIRONMENT: "production",
        },
        fetchImpl,
      })
    ).resolves.toBe("conversation-token");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
