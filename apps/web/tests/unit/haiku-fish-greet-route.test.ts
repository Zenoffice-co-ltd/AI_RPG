import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";
import { resetSessionTokenRateLimit } from "../../lib/roleplay/rate-limit";

const mocks = vi.hoisted(() => ({
  loadHaikuFishScenarioBundle: vi.fn(),
  synthesizeHaikuFishAudio: vi.fn(),
}));

vi.mock("@/server/haikuFish/scenarioLoader", () => ({
  loadHaikuFishScenarioBundle: mocks.loadHaikuFishScenarioBundle,
  HAIKU_FISH_SCENARIO_ID:
    "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
  clearHaikuFishScenarioBundleCache: () => undefined,
}));

vi.mock("@/server/haikuFish/fishTts", () => ({
  synthesizeHaikuFishAudio: mocks.synthesizeHaikuFishAudio,
}));

const VALID_BUNDLE = {
  scenarioId:
    "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
  promptVersion: "test-v1",
  agentSystemPrompt: "# Personality\n…",
  knowledgeBaseText: "# Scenario\n…",
  firstMessage: "お時間ありがとうございます。",
  agentSystemPromptHash: "a".repeat(64),
  knowledgeBaseTextHash: "b".repeat(64),
  promptSectionsHash: "c".repeat(64),
};

describe("haiku-fish greet route", () => {
  beforeEach(() => {
    resetSessionTokenRateLimit();
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("ENABLE_HAIKU_FISH_ROLEPLAY", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "anth-test");
    vi.stubEnv("FISH_API_KEY", "fish-test");
    vi.stubEnv("FISH_ADECCO_VOICE_REFERENCE_ID", "voice-test");
    mocks.loadHaikuFishScenarioBundle.mockResolvedValue(VALID_BUNDLE);
    mocks.synthesizeHaikuFishAudio.mockResolvedValue({
      result: {
        provider: "fish",
        model: "s2-pro",
        success: true,
        audio: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]),
        format: "wav",
        sampleRateHz: 24_000,
        bytes: 5,
        requestToFirstAudioMs: 100,
        requestToLastAudioMs: 200,
        audioDurationMs: 100,
        rtf: 1,
      },
      ttsText: VALID_BUNDLE.firstMessage,
      appliedRules: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns base64 audio + format + sampleRate for the scenario greeting", async () => {
    const { POST } = await import("../../app/api/haiku-fish/greet/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      base64: string;
      format: string;
      sampleRateHz: number;
    };
    expect(body.format).toBe("wav");
    expect(body.sampleRateHz).toBe(24_000);
    expect(body.base64.length).toBeGreaterThan(0);
    expect(mocks.synthesizeHaikuFishAudio).toHaveBeenCalledWith({
      text: VALID_BUNDLE.firstMessage,
    });
  });

  it("returns 401 when access cookie is missing", async () => {
    const { POST } = await import("../../app/api/haiku-fish/greet/route");
    const response = await POST(validRequest({ cookie: "" }));
    expect(response.status).toBe(401);
  });

  it("returns 503 when ENABLE_HAIKU_FISH_ROLEPLAY=false", async () => {
    vi.stubEnv("ENABLE_HAIKU_FISH_ROLEPLAY", "false");
    const { POST } = await import("../../app/api/haiku-fish/greet/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(503);
  });

  it("returns 502 when Fish TTS fails", async () => {
    mocks.synthesizeHaikuFishAudio.mockResolvedValueOnce({
      result: {
        provider: "fish",
        model: "s2-pro",
        success: false,
        format: "wav",
        sampleRateHz: 24_000,
        bytes: 0,
        requestToFirstAudioMs: null,
        requestToLastAudioMs: null,
        audioDurationMs: null,
        rtf: null,
        errorCode: "VENDOR_ERROR",
        errorMessage: "boom",
      },
      ttsText: "x",
      appliedRules: [],
    });
    const { POST } = await import("../../app/api/haiku-fish/greet/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(502);
  });
});

function validRequest({
  origin = "http://127.0.0.1:3000",
  referer = "http://127.0.0.1:3000/demo/adecco-roleplay-haiku-fish",
  cookie = `roleplay_api_access=${signAccessToken("demo-secret")}`,
}: { origin?: string | null; referer?: string | null; cookie?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  if (referer) headers.set("referer", referer);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest("http://127.0.0.1:3000/api/haiku-fish/greet", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
}
