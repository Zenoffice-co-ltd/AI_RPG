import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";

describe("grok-voice sanitized-response-tts route", () => {
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

  it("synthesizes PCM audio for sanitized text and returns 200", async () => {
    const { POST } = await import(
      "../../app/api/v3/sanitized-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: {
          sessionId: "gv_sess_test",
          text: "受発注経験の確認から進めます。",
        },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["text"]).toBe("受発注経験の確認から進めます。");
    expect(body["displayText"]).toBe("受発注経験の確認から進めます。");
    expect(body["audioBase64"]).toBe(Buffer.from([0, 1, 2, 3]).toString("base64"));
    expect(body["mimeType"]).toBe("audio/pcm");
    expect(body["sampleRateHz"]).toBe(24_000);
    expect(body["voiceId"]).toBe("rex");
    expect(body["cacheStatus"]).toBe("miss");
    expect(JSON.stringify(body)).not.toContain("xai-test-key");
    // Confirms the route hits xAI TTS with sanitized text in the payload.
    const requestInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const sent = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(sent["text"]).toBe(body["text"]);
    expect(sent["optimize_streaming_latency"]).toBe(1);
  });

  it("re-sanitizes server-side and returns 400 if the text was actually all suffix", async () => {
    const { POST } = await import(
      "../../app/api/v3/sanitized-response-tts/route"
    );
    // The client SHOULD have caught this in sanitizedToEmpty — server is
    // belt-and-suspenders.
    const response = await POST(
      validRequest({
        body: {
          sessionId: "gv_sess_test",
          text: "他に何か質問はありますか。",
        },
      })
    );
    expect(response.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("re-sanitizes server-side and trims trailing suffix from a mixed payload before TTS", async () => {
    const { POST } = await import(
      "../../app/api/v3/sanitized-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: {
          sessionId: "gv_sess_test",
          text: "確認しました。何か他にご質問ありますか。",
        },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["text"]).toBe("確認しました。");
    const requestInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const sent = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    // The xAI request body must contain ONLY the sanitized fragment.
    expect(sent["text"]).toBe("確認しました。");
  });

  it("returns 502 when the xAI TTS endpoint fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream blew up", { status: 502 })
    );
    const { POST } = await import(
      "../../app/api/v3/sanitized-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: {
          sessionId: "gv_sess_test",
          text: "受発注経験の確認から進めます。",
        },
      })
    );
    expect(response.status).toBe(502);
  });

  it("returns 401 without access cookie", async () => {
    const { POST } = await import(
      "../../app/api/v3/sanitized-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", text: "確認しました。" },
        cookie: "",
      })
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 when origin doesn't match", async () => {
    const { POST } = await import(
      "../../app/api/v3/sanitized-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", text: "確認しました。" },
        origin: "http://evil.example.com",
        referer: null,
      })
    );
    expect(response.status).toBe(403);
  });

  it("returns 503 when ENABLE_GROK_VOICE_ROLEPLAY is false", async () => {
    vi.stubEnv("ENABLE_GROK_VOICE_ROLEPLAY", "false");
    const { POST } = await import(
      "../../app/api/v3/sanitized-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", text: "確認しました。" },
      })
    );
    expect(response.status).toBe(503);
  });

  it("returns 400 on schema mismatch (missing text)", async () => {
    const { POST } = await import(
      "../../app/api/v3/sanitized-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test" },
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when text exceeds the 800-char cap", async () => {
    const { POST } = await import(
      "../../app/api/v3/sanitized-response-tts/route"
    );
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", text: "あ".repeat(801) },
      })
    );
    expect(response.status).toBe(400);
  });
});

describe("ttsCache assertCacheableGrokVoiceTtsPurpose guard", () => {
  beforeEach(() => {
    vi.stubEnv("GROK_VOICE_TTS_CACHE_DISABLE_FIRESTORE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("getCachedGrokVoiceTts throws for purpose=sanitized_response", async () => {
    const { getCachedGrokVoiceTts } = await import(
      "../../server/grokVoice/ttsCache"
    );
    await expect(
      getCachedGrokVoiceTts({
        text: "any sanitized text",
        voiceId: "rex",
        sampleRateHz: 24_000,
        purpose: "sanitized_response",
      })
    ).rejects.toThrow(/sanitized_response/);
  });

  it("saveGrokVoiceTtsCache throws for purpose=sanitized_response", async () => {
    const { saveGrokVoiceTtsCache } = await import(
      "../../server/grokVoice/ttsCache"
    );
    expect(() =>
      saveGrokVoiceTtsCache({
        text: "any sanitized text",
        purpose: "sanitized_response",
        result: {
          audio: Buffer.from([0, 1, 2]),
          mimeType: "audio/pcm",
          sampleRateHz: 24_000,
          textLen: 5,
          voiceId: "rex",
          vendorMs: 100,
          language: "ja",
          codec: "pcm",
          xaiTtsRequestShapeVersion: "xai-tts-rest-v2026-05-06-pcm24k-optlat1",
        },
      })
    ).toThrow(/sanitized_response/);
  });

  it("permits purpose=greeting and purpose=locked_response", async () => {
    const { getCachedGrokVoiceTts } = await import(
      "../../server/grokVoice/ttsCache"
    );
    // Memory cache miss returns null without throwing.
    await expect(
      getCachedGrokVoiceTts({
        text: "test",
        voiceId: "rex",
        sampleRateHz: 24_000,
        purpose: "greeting",
      })
    ).resolves.toBeNull();
    await expect(
      getCachedGrokVoiceTts({
        text: "test",
        voiceId: "rex",
        sampleRateHz: 24_000,
        purpose: "locked_response",
      })
    ).resolves.toBeNull();
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
  return new NextRequest("http://127.0.0.1:3000/api/v3/sanitized-response-tts", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
