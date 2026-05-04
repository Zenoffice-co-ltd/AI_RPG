import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";

describe("grok-voice event route", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("ENABLE_GROK_VOICE_ROLEPLAY", "true");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logSpy.mockRestore();
  });

  it("logs a generic clientEvent line for every accepted kind", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "ws.connected",
          sessionId: "gv_sess_test",
          details: {},
        },
      })
    );
    expect(response.status).toBe(200);
    const lines = logSpy.mock.calls.map(
      (c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>
    );
    const clientEventLine = lines.find(
      (line: Record<string, unknown>) =>
        (line as { scope?: string }).scope === "grokVoice.clientEvent"
    );
    expect(clientEventLine).toBeDefined();
    expect((clientEventLine as { kind?: string }).kind).toBe("ws.connected");
  });

  it("emits dedicated grokVoice.stt + clientEvent lines for stt.completed (補強案 #1)", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "stt.completed",
          sessionId: "gv_sess_test",
          details: { turnIndex: 3, textLen: 27, confidence: 0.92, vendorMs: 140 },
        },
      })
    );
    expect(response.status).toBe(200);
    const lines = logSpy.mock.calls.map(
      (c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>
    );
    const sttLine = lines.find(
      (line: Record<string, unknown>) =>
        (line as { scope?: string }).scope === "grokVoice.stt"
    ) as
      | {
          sessionId: string;
          turnIndex: number;
          textLen: number;
          confidence: number | null;
          vendorMs: number | null;
        }
      | undefined;
    expect(sttLine).toBeDefined();
    expect(sttLine!.sessionId).toBe("gv_sess_test");
    expect(sttLine!.turnIndex).toBe(3);
    expect(sttLine!.textLen).toBe(27);
    expect(sttLine!.confidence).toBe(0.92);
    expect(sttLine!.vendorMs).toBe(140);
  });

  it("emits a dedicated grokVoice.stt.skipped line for empty STT (補強案 #2)", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "stt.skipped",
          sessionId: "gv_sess_test",
          details: { turnIndex: 4, reason: "empty" },
        },
      })
    );
    expect(response.status).toBe(200);
    const lines = logSpy.mock.calls.map(
      (c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>
    );
    const skippedLine = lines.find(
      (line: Record<string, unknown>) =>
        (line as { scope?: string }).scope === "grokVoice.stt.skipped"
    ) as { reason?: string; turnIndex?: number } | undefined;
    expect(skippedLine).toBeDefined();
    expect(skippedLine!.reason).toBe("empty");
    expect(skippedLine!.turnIndex).toBe(4);
  });

  it("includes promptHash + promptVersion + guardrailVersion in turn.completed metrics (補強案 #3)", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "turn.completed",
          sessionId: "gv_sess_test",
          details: {
            turnIndex: 1,
            inputMode: "text",
            userTextLen: 10,
            agentTextLen: 80,
            firstAudioMs: 420,
            doneMs: 1830,
            audioBytes: 9000,
            promptHash: "abc123def456",
            promptVersion: "v0.1.2",
            guardrailVersion: "gv-think-fast-v1-2026-05-04",
            grokVoiceModel: "grok-voice-think-fast-1.0",
            grokVoiceVoiceId: "rex",
          },
        },
      })
    );
    expect(response.status).toBe(200);
    const lines = logSpy.mock.calls.map(
      (c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>
    );
    const metricsLine = lines.find(
      (line: Record<string, unknown>) =>
        (line as { scope?: string }).scope === "grokVoice.turnMetrics"
    ) as Record<string, unknown> | undefined;
    expect(metricsLine).toBeDefined();
    expect(metricsLine!["agentSystemPromptHash"]).toBe("abc123def456");
    expect(metricsLine!["promptVersion"]).toBe("v0.1.2");
    expect(metricsLine!["guardrailVersion"]).toBe("gv-think-fast-v1-2026-05-04");
    expect(metricsLine!["grokVoiceModel"]).toBe("grok-voice-think-fast-1.0");
    expect(metricsLine!["grokVoiceVoiceId"]).toBe("rex");
    expect(metricsLine!["firstAudioMs"]).toBe(420);
    expect(metricsLine!["doneMs"]).toBe(1830);
  });

  it("emits a dedicated grokVoice.mic.state line on mic state transitions (補強案 #4)", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "mic.state.changed",
          sessionId: "gv_sess_test",
          details: { from: "listening", to: "speaking", durationMs: 1200 },
        },
      })
    );
    expect(response.status).toBe(200);
    const lines = logSpy.mock.calls.map(
      (c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>
    );
    const micLine = lines.find(
      (line: Record<string, unknown>) =>
        (line as { scope?: string }).scope === "grokVoice.mic.state"
    ) as
      | { from: string; to: string; durationMs: number | null }
      | undefined;
    expect(micLine).toBeDefined();
    expect(micLine!.from).toBe("listening");
    expect(micLine!.to).toBe("speaking");
    expect(micLine!.durationMs).toBe(1200);
  });

  it("trims long string values in details to bound log volume", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const huge = "x".repeat(500);
    const response = await POST(
      validRequest({ body: { kind: "ws.error", details: { message: huge } } })
    );
    expect(response.status).toBe(200);
    const clientEventLine = logSpy.mock.calls
      .map((c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>)
      .find(
        (line: Record<string, unknown>) =>
          (line as { scope?: string }).scope === "grokVoice.clientEvent"
      ) as { details: { message: string } } | undefined;
    expect(clientEventLine!.details.message.length).toBeLessThan(500);
    expect(clientEventLine!.details.message.endsWith("…")).toBe(true);
  });

  it("rejects unknown event kinds with 400", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({ body: { kind: "totally.fake.kind" } })
    );
    expect(response.status).toBe(400);
  });

  it("returns 401 without access cookie", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({ body: { kind: "ws.connected" }, cookie: "" })
    );
    expect(response.status).toBe(401);
  });

  it("returns 503 when ENABLE_GROK_VOICE_ROLEPLAY=false", async () => {
    vi.stubEnv("ENABLE_GROK_VOICE_ROLEPLAY", "false");
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({ body: { kind: "ws.connected" } })
    );
    expect(response.status).toBe(503);
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
  return new NextRequest("http://127.0.0.1:3000/api/v3/event", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
