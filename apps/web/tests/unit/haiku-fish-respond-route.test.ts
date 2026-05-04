import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";
import { resetSessionTokenRateLimit } from "../../lib/roleplay/rate-limit";

const mocks = vi.hoisted(() => ({
  loadHaikuFishScenarioBundle: vi.fn(),
  streamHaikuFishLlm: vi.fn(),
  synthesizeHaikuFishAudio: vi.fn(),
}));

vi.mock("@/server/haikuFish/scenarioLoader", () => ({
  loadHaikuFishScenarioBundle: mocks.loadHaikuFishScenarioBundle,
  HAIKU_FISH_SCENARIO_ID:
    "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
  clearHaikuFishScenarioBundleCache: () => undefined,
}));

vi.mock("@/server/haikuFish/claudeStreaming", () => ({
  streamHaikuFishLlm: mocks.streamHaikuFishLlm,
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

async function* deltaStream(parts: string[]) {
  let accumulated = "";
  for (const p of parts) {
    accumulated += p;
    yield { kind: "delta" as const, text: p };
  }
  yield { kind: "done" as const, fullText: accumulated, responseId: "r-1" };
}

async function readSseEvents(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ event: string; data: unknown }> = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf("\n\n");
      const e = parse(raw);
      if (e) events.push(e);
    }
  }
  return events;
}

function parse(raw: string) {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!event) return null;
  return { event, data: JSON.parse(dataLines.join("\n")) };
}

describe("haiku-fish respond route", () => {
  beforeEach(() => {
    resetSessionTokenRateLimit();
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("ENABLE_HAIKU_FISH_ROLEPLAY", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "anth-test");
    vi.stubEnv("FISH_API_KEY", "fish-test");
    vi.stubEnv("FISH_ADECCO_VOICE_REFERENCE_ID", "voice-test");
    mocks.loadHaikuFishScenarioBundle.mockResolvedValue(VALID_BUNDLE);
    mocks.streamHaikuFishLlm.mockImplementation(() =>
      deltaStream(["はい、", "営業事務一名を", "お願いします。"])
    );
    mocks.synthesizeHaikuFishAudio.mockResolvedValue({
      result: {
        provider: "fish",
        model: "s2-pro",
        success: true,
        audio: Buffer.from([0x52, 0x49, 0x46, 0x46]),
        format: "wav",
        sampleRateHz: 24_000,
        bytes: 4,
        requestToFirstAudioMs: 100,
        requestToLastAudioMs: 200,
        audioDurationMs: 100,
        rtf: 1,
      },
      ttsText: "test",
      appliedRules: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns SSE events in order: status, delta(s), first_sentence, audio_chunk, text_final, metrics, done", async () => {
    const { POST } = await import("../../app/api/haiku-fish/respond/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSseEvents(response.body!);
    const types = events.map((e) => e.event);
    expect(types[0]).toBe("status");
    expect(types).toContain("agent_text_delta");
    expect(types).toContain("agent_first_sentence");
    expect(types).toContain("audio_chunk");
    expect(types).toContain("agent_text_final");
    expect(types).toContain("metrics");
    expect(types[types.length - 1]).toBe("done");
    const firstSentenceIdx = types.indexOf("agent_first_sentence");
    const audioIdx = types.indexOf("audio_chunk");
    expect(audioIdx).toBeGreaterThan(firstSentenceIdx);
  });

  it("returns 401 when access cookie is missing", async () => {
    const { POST } = await import("../../app/api/haiku-fish/respond/route");
    const response = await POST(validRequest({ cookie: "" }));
    expect(response.status).toBe(401);
  });

  it("returns 503 when ENABLE_HAIKU_FISH_ROLEPLAY is false", async () => {
    vi.stubEnv("ENABLE_HAIKU_FISH_ROLEPLAY", "false");
    const { POST } = await import("../../app/api/haiku-fish/respond/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(503);
  });

  it("returns 503 when env keys are missing while feature is enabled", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { POST } = await import("../../app/api/haiku-fish/respond/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(503);
  });

  it("returns 400 when last message role is agent (must end with user)", async () => {
    const { POST } = await import("../../app/api/haiku-fish/respond/route");
    const response = await POST(
      validRequest({
        body: {
          sessionId: "hf_sess_1",
          inputMode: "text",
          messages: [{ role: "user", text: "hi" }, { role: "agent", text: "hello" }],
        },
      })
    );
    expect(response.status).toBe(400);
  });

  it("emits an error event when the TTS provider fails, then still completes with metrics+done", async () => {
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
    const { POST } = await import("../../app/api/haiku-fish/respond/route");
    const response = await POST(validRequest());
    const events = await readSseEvents(response.body!);
    const types = events.map((e) => e.event);
    expect(types).toContain("error");
    expect(types).toContain("metrics");
    expect(types[types.length - 1]).toBe("done");
  });
});

function validRequest({
  body = {
    sessionId: "hf_sess_1",
    inputMode: "text" as const,
    messages: [{ role: "user", text: "募集背景を教えてください" }],
  },
  origin = "http://127.0.0.1:3000",
  referer = "http://127.0.0.1:3000/demo/adecco-roleplay-haiku-fish",
  cookie = `roleplay_api_access=${signAccessToken("demo-secret")}`,
}: {
  body?: unknown;
  origin?: string | null;
  referer?: string | null;
  cookie?: string;
} = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  if (referer) headers.set("referer", referer);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest("http://127.0.0.1:3000/api/haiku-fish/respond", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
