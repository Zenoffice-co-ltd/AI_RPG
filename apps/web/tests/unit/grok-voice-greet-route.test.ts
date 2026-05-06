import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";

const mocks = vi.hoisted(() => ({
  loadGrokVoiceScenarioBundle: vi.fn(),
}));

vi.mock("@/server/grokVoice/scenarioLoader", () => ({
  loadGrokVoiceScenarioBundle: mocks.loadGrokVoiceScenarioBundle,
  clearGrokVoiceScenarioBundleCache: () => undefined,
  GROK_VOICE_SCENARIO_ID:
    "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21",
}));

const VALID_BUNDLE = {
  scenarioId:
    "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21",
  promptVersion: "test-v1",
  agentSystemPrompt: "# System prompt must never be returned",
  knowledgeBaseText: "# Knowledge base must never be returned",
  firstMessage: "お時間ありがとうございます。",
  pronunciationGuide: "",
  agentSystemPromptHash: "a".repeat(64),
  knowledgeBaseTextHash: "b".repeat(64),
  promptSectionsHash: "c".repeat(64),
};

describe("grok-voice greet route", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("ENABLE_GROK_VOICE_ROLEPLAY", "true");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("GROK_VOICE_VOICE_ID", "rex");
    vi.stubEnv("GROK_VOICE_SAMPLE_RATE", "24000");
    mocks.loadGrokVoiceScenarioBundle.mockResolvedValue(VALID_BUNDLE);
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

  it("calls xAI TTS with server voice id, ja language, firstMessage text, and PCM output", async () => {
    const { POST } = await import("../../app/api/v3/greet/route");
    const response = await POST(
      validRequest({
        body: {
          sessionId: "gv_sess_test",
          text: VALID_BUNDLE.firstMessage,
          voiceId: "malicious-client-voice",
        },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["audioBase64"]).toBe(Buffer.from([0, 1, 2, 3]).toString("base64"));
    expect(body["mimeType"]).toBe("audio/pcm");
    expect(body["sampleRateHz"]).toBe(24_000);
    expect(body["textLen"]).toBe(VALID_BUNDLE.firstMessage.length);
    expect(body["voiceId"]).toBe("rex");
    expect(JSON.stringify(body)).not.toContain("System prompt");
    expect(JSON.stringify(body)).not.toContain("Knowledge base");
    expect(JSON.stringify(body)).not.toContain("xai-test-key");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer xai-test-key",
          "content-type": "application/json",
        }),
      })
    );
    const requestInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const sent = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(sent).toEqual({
      text: VALID_BUNDLE.firstMessage,
      voice_id: "rex",
      language: "ja",
      output_format: { codec: "pcm", sample_rate: 24_000 },
    });
  });

  it("rejects text that does not exactly match the scenario firstMessage", async () => {
    const { POST } = await import("../../app/api/v3/greet/route");
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", text: "別の文言です。" },
      })
    );
    expect(response.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects overly long text before calling xAI", async () => {
    const { POST } = await import("../../app/api/v3/greet/route");
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", text: "あ".repeat(501) },
      })
    );
    expect(response.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns 503 when XAI_API_KEY is missing", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const { POST } = await import("../../app/api/v3/greet/route");
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", text: VALID_BUNDLE.firstMessage },
      })
    );
    expect(response.status).toBe(503);
  });

  it("returns 401 when access cookie is missing", async () => {
    const { POST } = await import("../../app/api/v3/greet/route");
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", text: VALID_BUNDLE.firstMessage },
        cookie: "",
      })
    );
    expect(response.status).toBe(401);
  });

  it("returns 502 when xAI TTS fails", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("upstream failed", { status: 500 })
    );
    const { POST } = await import("../../app/api/v3/greet/route");
    const response = await POST(
      validRequest({
        body: { sessionId: "gv_sess_test", text: VALID_BUNDLE.firstMessage },
      })
    );
    expect(response.status).toBe(502);
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
  return new NextRequest("http://127.0.0.1:3000/api/v3/greet", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
