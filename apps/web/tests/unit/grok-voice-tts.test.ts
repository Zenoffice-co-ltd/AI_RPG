import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("grok voice TTS helper and cache", () => {
  beforeEach(() => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("GROK_VOICE_VOICE_ID", "rex");
    vi.stubEnv("GROK_VOICE_SAMPLE_RATE", "24000");
    vi.stubEnv("GROK_VOICE_TTS_CACHE_DISABLE_FIRESTORE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("calls xAI /v1/tts with current official PCM request shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from([0, 1, 2, 3]), { status: 200 })
    );
    const { synthesizeGrokVoiceTts } = await import(
      "../../server/grokVoice/tts"
    );
    const result = await synthesizeGrokVoiceTts({
      text: "請求想定です。",
      purpose: "locked_response",
    });
    expect(result.audio.byteLength).toBe(4);
    expect(result.mimeType).toBe("audio/pcm");
    expect(result.sampleRateHz).toBe(24_000);
    const requestInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const sent = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(sent).toEqual({
      text: "請求想定です。",
      voice_id: "rex",
      language: "ja",
      output_format: { codec: "pcm", sample_rate: 24_000 },
      optimize_streaming_latency: 1,
    });
  });

  it("throws on upstream failure or empty audio", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream failed", { status: 500 })
    );
    const { synthesizeGrokVoiceTts } = await import(
      "../../server/grokVoice/tts"
    );
    await expect(
      synthesizeGrokVoiceTts({ text: "hello", purpose: "greeting" })
    ).rejects.toMatchObject({ status: 500 });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(Buffer.alloc(0), { status: 200 })
    );
    await expect(
      synthesizeGrokVoiceTts({ text: "hello", purpose: "greeting" })
    ).rejects.toMatchObject({ status: 502 });
  });

  it("varies cache keys by text, voice, sample rate, codec/language shape", async () => {
    const { buildGrokVoiceTtsCacheKey } = await import(
      "../../server/grokVoice/ttsCache"
    );
    const base = buildGrokVoiceTtsCacheKey({
      text: "単価は？",
      voiceId: "rex",
      sampleRateHz: 24_000,
      purpose: "locked_response",
    });
    const changedText = buildGrokVoiceTtsCacheKey({
      text: "時給は？",
      voiceId: "rex",
      sampleRateHz: 24_000,
      purpose: "locked_response",
    });
    const changedVoice = buildGrokVoiceTtsCacheKey({
      text: "単価は？",
      voiceId: "eve",
      sampleRateHz: 24_000,
      purpose: "locked_response",
    });
    const changedRate = buildGrokVoiceTtsCacheKey({
      text: "単価は？",
      voiceId: "rex",
      sampleRateHz: 16_000,
      purpose: "locked_response",
    });
    expect(new Set([
      base.cacheKeyHash,
      changedText.cacheKeyHash,
      changedVoice.cacheKeyHash,
      changedRate.cacheKeyHash,
    ]).size).toBe(4);
  });

  it("serves memory cache hits without upstream fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getCachedGrokVoiceTts, saveGrokVoiceTtsCache } = await import(
      "../../server/grokVoice/ttsCache"
    );
    saveGrokVoiceTtsCache({
      text: "お時間ありがとうございます。",
      purpose: "greeting",
      result: {
        audio: Buffer.from([0, 1, 2, 3]),
        mimeType: "audio/pcm",
        sampleRateHz: 24_000,
        textLen: 11,
        voiceId: "rex",
        vendorMs: 99,
        language: "ja",
        codec: "pcm",
        xaiTtsRequestShapeVersion: "xai-tts-rest-v2026-05-06-pcm24k-optlat1",
      },
    });
    const hit = await getCachedGrokVoiceTts({
      text: "お時間ありがとうございます。",
      voiceId: "rex",
      sampleRateHz: 24_000,
      purpose: "greeting",
    });
    expect(hit?.audioBytes).toBe(4);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
