import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";
import { resetSessionTokenRateLimit } from "../../lib/roleplay/rate-limit";

const mocks = vi.hoisted(() => ({
  getVoiceServerEnvWithSecretFallback: vi.fn(),
  issueConversationToken: vi.fn(),
}));

vi.mock("@/lib/roleplay/server-env", () => ({
  getVoiceServerEnvWithSecretFallback: mocks.getVoiceServerEnvWithSecretFallback,
}));

vi.mock("@/lib/roleplay/voice-session", async () => {
  const actual = await vi.importActual<typeof import("../../lib/roleplay/voice-session")>(
    "../../lib/roleplay/voice-session"
  );
  return {
    ...actual,
    issueConversationToken: mocks.issueConversationToken,
  };
});

describe("session token route", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    resetSessionTokenRateLimit();
    mocks.getVoiceServerEnvWithSecretFallback.mockResolvedValue({
      ELEVENLABS_API_KEY: "server-key",
      ELEVENLABS_AGENT_ID: "agent",
      ELEVENLABS_BRANCH_ID: "branch",
      ELEVENLABS_ENVIRONMENT: "production",
    });
    mocks.issueConversationToken.mockResolvedValue("conversation-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns a conversation token for a valid same-origin request", async () => {
    const { POST } = await import("../../app/api/voice/session-token/route");
    const response = await POST(validRequest());
    const body = (await response.json()) as { conversationToken?: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ conversationToken: "conversation-token" });
    expect(JSON.stringify(body)).not.toContain("server-key");
  });

  it("rejects invalid scenario and missing access", async () => {
    const { POST } = await import("../../app/api/voice/session-token/route");

    const invalidScenario = await POST(
      validRequest({ body: { scenarioId: "wrong", participantName: "demo-user" } })
    );
    expect(invalidScenario.status).toBe(400);

    const missingAccess = await POST(validRequest({ cookie: "" }));
    expect(missingAccess.status).toBe(401);
  });

  it("rejects disallowed origin and referer", async () => {
    const { POST } = await import("../../app/api/voice/session-token/route");

    const badOrigin = await POST(
      validRequest({ origin: "https://example.invalid", referer: undefined })
    );
    expect(badOrigin.status).toBe(403);

    const badReferer = await POST(
      validRequest({ origin: null, referer: "https://example.invalid/demo" })
    );
    expect(badReferer.status).toBe(403);
  });

  it("returns safe responses for upstream failure and rate limit", async () => {
    const { POST } = await import("../../app/api/voice/session-token/route");
    mocks.issueConversationToken.mockRejectedValueOnce(new Error("upstream boom"));

    const failed = await POST(validRequest());
    const failedBody = (await failed.json()) as { error: string };
    expect(failed.status).toBe(502);
    expect(failedBody.error).toBe(
      "セッションの開始に失敗しました。時間をおいて再試行してください。"
    );
    expect(JSON.stringify(failedBody)).not.toContain("server-key");

    mocks.issueConversationToken.mockResolvedValue("conversation-token");
    await POST(validRequest());
    await POST(validRequest());
    await POST(validRequest());
    const limited = await POST(validRequest());
    expect(limited.status).toBe(429);
  });

  it("rejects non-POST methods", async () => {
    const { GET, PUT, DELETE } = await import("../../app/api/voice/session-token/route");
    expect(GET().status).toBe(405);
    expect(PUT().status).toBe(405);
    expect(DELETE().status).toBe(405);
  });
});

function validRequest({
  body = { scenarioId: "adecco-orb", participantName: "demo-user" },
  origin = "http://127.0.0.1:3000",
  referer = "http://127.0.0.1:3000/demo/adecco-roleplay",
  cookie = `roleplay_api_access=${signAccessToken("demo-secret")}`,
}: {
  body?: unknown;
  origin?: string | null | undefined;
  referer?: string | null | undefined;
  cookie?: string;
} = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) {
    headers.set("origin", origin);
  }
  if (referer) {
    headers.set("referer", referer);
  }
  if (cookie) {
    headers.set("cookie", cookie);
  }

  return new NextRequest("http://127.0.0.1:3000/api/voice/session-token", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
