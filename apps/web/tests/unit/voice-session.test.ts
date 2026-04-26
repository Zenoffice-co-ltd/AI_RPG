import { describe, expect, it, vi } from "vitest";
import { issueConversationToken } from "../../lib/roleplay/voice-session";

describe("voice session token", () => {
  it("maps upstream token to conversation token", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchImpl = vi.fn((_: RequestInfo | URL, __?: RequestInit) =>
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
          ELEVENLABS_VOICE_PROFILE_ID:
            "staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2",
        },
        scenarioId: "adecco-orb",
        participantName: "demo-user",
        fetchImpl,
      })
    ).resolves.toBe("conversation-token");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toContain("agent_id=agent");
    expect(String(url)).toContain("branch_id=branch");
    expect(String(url)).toContain("environment=production");
    expect(String(url)).toContain("participant_name=demo-user");
    const logLine = String(infoSpy.mock.calls[0]?.[0] ?? "");
    expect(logLine).toContain("staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2");
    expect(logLine).not.toContain("key");
    expect(logLine).not.toContain("conversation-token");
    infoSpy.mockRestore();
  });

  it("retries one upstream failure", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchImpl = vi
      .fn((_: RequestInfo | URL, __?: RequestInit) =>
        Promise.resolve(new Response("bad", { status: 500 }))
      )
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
        scenarioId: "adecco-orb",
        fetchImpl,
      })
    ).resolves.toBe("conversation-token");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    infoSpy.mockRestore();
  });
});
