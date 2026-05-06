import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";

describe("grok-voice locked-response-tts route", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("ENABLE_GROK_VOICE_ROLEPLAY", "true");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("GROK_VOICE_VOICE_ID", "rex");
    vi.stubEnv("GROK_VOICE_SAMPLE_RATE", "24000");
    vi.stubEnv("GROK_VOICE_TTS_CACHE_DISABLE_FIRESTORE", "true");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from([0, 1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/pcm" },
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("resolves the fixed rate response on the server and returns PCM audio", async () => {
    const { POST } = await import(
      "../../app/api/v3/locked-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: {
          sessionId: "gv_sess_test",
          userText: "単価を教えてください",
          text: "client supplied assistant text must be ignored",
        },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["text"]).toBe(
      "請求想定は経験により、せんななひゃくごじゅう円から、せんきゅうひゃく円程度です。"
    );
    expect(body["audioBase64"]).toBe(Buffer.from([0, 1, 2, 3]).toString("base64"));
    expect(body["mimeType"]).toBe("audio/pcm");
    expect(body["sampleRateHz"]).toBe(24_000);
    expect(body["voiceId"]).toBe("rex");
    expect(body["cacheStatus"]).toBe("miss");
    expect(JSON.stringify(body)).not.toContain("xai-test-key");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer xai-test-key",
        }),
      })
    );
    const requestInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const sent = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(sent["text"]).toBe(body["text"]);
    expect(sent["optimize_streaming_latency"]).toBe(1);
  });

  it("documents the current broad /請求/ lock behavior for invoice wording", async () => {
    const { POST } = await import(
      "../../app/api/v3/locked-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: {
          sessionId: "gv_sess_test",
          userText: "請求書の締日は？",
        },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["text"]).toBe(
      "請求想定は経験により、せんななひゃくごじゅう円から、せんきゅうひゃく円程度です。"
    );
  });

  it("rejects non-locked user text before calling xAI", async () => {
    const { POST } = await import(
      "../../app/api/v3/locked-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: {
          sessionId: "gv_sess_test",
          userText: "天気はどうですか",
        },
      })
    );
    expect(response.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without access cookie", async () => {
    const { POST } = await import(
      "../../app/api/v3/locked-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", userText: "単価は？" },
        cookie: "",
      })
    );
    expect(response.status).toBe(401);
  });
});

function validRequest({
  body,
  origin = "http://127.0.0.1:3000",
  referer = "http://127.0.0.1:3000/demo/adecco-roleplay-v3",
  cookie = `roleplay_api_access=${signAccessToken("demo-secret")}`,
}: {
  body: unknown;
  origin?: string | null;
  referer?: string | null;
  cookie?: string;
}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  if (referer) headers.set("referer", referer);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest("http://127.0.0.1:3000/api/v3/locked-response-tts", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

