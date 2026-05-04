import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";
import { resetSessionTokenRateLimit } from "../../lib/roleplay/rate-limit";

const mocks = vi.hoisted(() => ({
  transcribeHaikuFishAudio: vi.fn(),
}));

vi.mock("@/server/haikuFish/transcribe", () => ({
  transcribeHaikuFishAudio: mocks.transcribeHaikuFishAudio,
  HAIKU_FISH_MIC_DISABLED_PAYLOAD: {
    error: "mic_input_disabled",
    message: "音声入力は現在無効化されています。テキスト入力でテストしてください。",
  },
}));

describe("haiku-fish transcribe route", () => {
  beforeEach(() => {
    resetSessionTokenRateLimit();
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("ENABLE_HAIKU_FISH_ROLEPLAY", "true");
    vi.stubEnv("ENABLE_HAIKU_FISH_MIC_INPUT", "true");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "adecco-mendan");
    mocks.transcribeHaikuFishAudio.mockResolvedValue({
      text: "募集背景を教えてください",
      confidence: 0.92,
      vendorRequestMs: 250,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns transcribed text + confidence + latency", async () => {
    const { POST } = await import("../../app/api/haiku-fish/transcribe/route");
    const audioBase64 = Buffer.from("audio-bytes-must-be-at-least-twenty-chars").toString("base64");
    const response = await POST(validRequest({ body: { audioBase64, audioMimeType: "audio/webm" } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { text: string; confidence: number };
    expect(body.text).toBe("募集背景を教えてください");
    expect(body.confidence).toBe(0.92);
    expect(mocks.transcribeHaikuFishAudio).toHaveBeenCalledWith(
      expect.objectContaining({ audioBase64, audioMimeType: "audio/webm" })
    );
  });

  it("returns 501 when ENABLE_HAIKU_FISH_MIC_INPUT=false", async () => {
    vi.stubEnv("ENABLE_HAIKU_FISH_MIC_INPUT", "false");
    const { POST } = await import("../../app/api/haiku-fish/transcribe/route");
    const audioBase64 = Buffer.from("xxxxxxxxxxxxxxxxxxxxxxxxxx").toString("base64");
    const response = await POST(validRequest({ body: { audioBase64 } }));
    expect(response.status).toBe(501);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("mic_input_disabled");
  });

  it("returns 401 when access cookie is missing", async () => {
    const { POST } = await import("../../app/api/haiku-fish/transcribe/route");
    const audioBase64 = Buffer.from("xxxxxxxxxxxxxxxxxxxxxxxxxx").toString("base64");
    const response = await POST(validRequest({ cookie: "", body: { audioBase64 } }));
    expect(response.status).toBe(401);
  });

  it("returns 400 on missing audioBase64", async () => {
    const { POST } = await import("../../app/api/haiku-fish/transcribe/route");
    const response = await POST(validRequest({ body: {} }));
    expect(response.status).toBe(400);
  });

  it("returns 502 when STT throws", async () => {
    mocks.transcribeHaikuFishAudio.mockRejectedValueOnce(new Error("upstream boom"));
    const { POST } = await import("../../app/api/haiku-fish/transcribe/route");
    const audioBase64 = Buffer.from("xxxxxxxxxxxxxxxxxxxxxxxxxx").toString("base64");
    const response = await POST(validRequest({ body: { audioBase64 } }));
    expect(response.status).toBe(502);
  });
});

function validRequest({
  body,
  origin = "http://127.0.0.1:3000",
  referer = "http://127.0.0.1:3000/demo/adecco-roleplay-haiku-fish",
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
  return new NextRequest("http://127.0.0.1:3000/api/haiku-fish/transcribe", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
