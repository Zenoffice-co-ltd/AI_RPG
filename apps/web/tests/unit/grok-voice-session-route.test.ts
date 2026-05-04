import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";
import { resetSessionTokenRateLimit } from "../../lib/roleplay/rate-limit";

function validRequest({
  origin = "http://127.0.0.1:3000",
  referer = "http://127.0.0.1:3000/demo/adecco-roleplay-v3",
  cookie = `roleplay_api_access=${signAccessToken("demo-secret")}`,
  body = {},
}: {
  origin?: string | null;
  referer?: string | null;
  cookie?: string;
  body?: unknown;
} = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  if (referer) headers.set("referer", referer);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest("http://127.0.0.1:3000/api/v3/session", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("grok-voice session route", () => {
  beforeEach(() => {
    resetSessionTokenRateLimit();
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("ENABLE_GROK_VOICE_ROLEPLAY", "true");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("GROK_VOICE_MODEL", "grok-voice-think-fast-1.0");
    vi.stubEnv("GROK_VOICE_VOICE_ID", "rex");
    vi.stubEnv("GROK_VOICE_INPUT_FORMAT", "audio/pcm");
    vi.stubEnv("GROK_VOICE_OUTPUT_FORMAT", "audio/pcm");
    vi.stubEnv("GROK_VOICE_SAMPLE_RATE", "24000");
    vi.stubEnv("GROK_VOICE_REALTIME_BASE", "wss://api.x.ai/v1/realtime");
    vi.stubEnv(
      "GROK_VOICE_EPHEMERAL_BASE",
      "https://api.x.ai/v1/realtime/client_secrets"
    );
    vi.stubEnv("GROK_VOICE_TURN_DETECTION_THRESHOLD", "0.5");
    vi.stubEnv("GROK_VOICE_TURN_DETECTION_SILENCE_MS", "500");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns 503 when ENABLE_GROK_VOICE_ROLEPLAY is false", async () => {
    vi.stubEnv("ENABLE_GROK_VOICE_ROLEPLAY", "false");
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(503);
  });

  it("returns 503 when XAI_API_KEY is missing", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(503);
  });

  it("returns 401 without an access cookie", async () => {
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest({ cookie: "" }));
    expect(response.status).toBe(401);
  });

  it("returns 403 when origin doesn't match", async () => {
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(
      validRequest({
        origin: "http://evil.example.com",
        referer: null,
      })
    );
    expect(response.status).toBe(403);
  });

  it("issues an ephemeral token and returns wsUrl + firstMessage WITHOUT exposing XAI_API_KEY", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            value: "xai-realtime-client-secret-test-value",
            expires_at: 1747_000_000,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(typeof body["sessionId"]).toBe("string");
    expect(body["backend"]).toBe("grok-voice-think-fast");
    expect(body["wsUrl"]).toMatch(
      /^wss:\/\/api\.x\.ai\/v1\/realtime\?model=grok-voice-think-fast-1\.0$/
    );
    expect(body["ephemeralToken"]).toBe(
      "xai-realtime-client-secret-test-value"
    );
    expect(body["grokVoiceModel"]).toBe("grok-voice-think-fast-1.0");
    expect(body["grokVoiceVoiceId"]).toBe("rex");
    expect(typeof body["firstMessage"]).toBe("string");
    expect(typeof body["instructions"]).toBe("string");
    expect((body["instructions"] as string).length).toBeGreaterThan(2_000);
    expect(typeof body["promptVersion"]).toBe("string");
    expect(typeof body["promptHash"]).toBe("string");
    expect(typeof body["guardrailVersion"]).toBe("string");
    // CRITICAL: The xAI API key must NEVER be returned to the client.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("xai-test-key");
    // We also confirm the upstream request used the API key header.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.x.ai/v1/realtime/client_secrets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer xai-test-key",
        }),
      })
    );
    // Body must NOT include session config (the xAI ephemeral endpoint
    // explicitly rejects `session` and `expires_after.anchor`); only
    // `expires_after.seconds`.
    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body as string
    ) as Record<string, unknown>;
    expect(sentBody).toEqual({ expires_after: { seconds: 300 } });
  });

  it("returns 502 when the ephemeral token endpoint fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream blew up", { status: 502 })
    );
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(502);
  });

  it("returns 429 with Retry-After once rate-limited", async () => {
    // Each fetch call needs a fresh Response — Response bodies are streams
    // and become "unusable" after the first read.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ value: "xai-test-token", expires_at: 1 }),
          { status: 200 }
        )
      )
    );
    const { POST } = await import("../../app/api/v3/session/route");
    for (let i = 0; i < 3; i += 1) {
      const ok = await POST(validRequest());
      expect(ok.status).toBe(200);
    }
    const limited = await POST(validRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });
});
