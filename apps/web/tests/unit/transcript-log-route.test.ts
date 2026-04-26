import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";

describe("transcript log route", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs one-line JSON evidence with stable text hashes", async () => {
    const { POST } = await import("../../app/api/voice/transcript-log/route");
    const response = await POST(validRequest());

    expect(response.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(infoSpy.mock.calls[0]?.[0])) as {
      message: string;
      text: string;
      textEscaped: string;
      textUtf8Base64: string;
      normalizedTextHash: string;
      normalizedTextLength: number;
    };

    expect(payload).toMatchObject({
      message: "Roleplay transcript",
      text: "現行ベンダーに加えて、もう一社の大手にも相談中です。",
      normalizedTextLength: 24,
    });
    expect(payload.textEscaped).toContain("\\u{73fe}");
    expect(payload.textUtf8Base64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(payload.normalizedTextHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("rejects requests without same-origin access", async () => {
    const { POST } = await import("../../app/api/voice/transcript-log/route");

    const missingCookie = await POST(validRequest({ cookie: "" }));
    expect(missingCookie.status).toBe(401);

    const badOrigin = await POST(validRequest({ origin: "https://example.invalid" }));
    expect(badOrigin.status).toBe(403);
  });
});

function validRequest({
  origin = "http://127.0.0.1:3000",
  referer = "http://127.0.0.1:3000/demo/adecco-roleplay",
  cookie = `roleplay_api_access=${signAccessToken("demo-secret")}`,
}: {
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

  return new NextRequest("http://127.0.0.1:3000/api/voice/transcript-log", {
    method: "POST",
    headers,
    body: JSON.stringify({
      scenarioId: "adecco-orb",
      conversationLocalId: "conversation-test",
      generation: 2,
      phase: "displayed",
      role: "agent",
      channel: "voice",
      status: "final",
      source: "sdk",
      text: "現行ベンダーに加えて、もう一社の大手にも相談中です。",
      sdkMessageId: "agent-497",
      createdAt: 1_000,
    }),
  });
}
