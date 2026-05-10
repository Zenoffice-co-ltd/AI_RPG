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

  it("accepts greeting telemetry kinds without logging prompt or transcript body by default", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "greeting.tts.completed",
          sessionId: "gv_sess_test",
          details: {
            textLen: 72,
            audioBytes: 12345,
            voiceId: "rex",
            vendorMs: 320,
            agentTextPreview: "初回発話本文",
            instructions: "絶対にログしない指示全文",
          },
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
    ) as { kind?: string; details?: Record<string, unknown> } | undefined;
    expect(clientEventLine?.kind).toBe("greeting.tts.completed");
    expect(clientEventLine?.details?.["textLen"]).toBe(72);
    expect(JSON.stringify(lines)).not.toContain("初回発話本文");
    expect(JSON.stringify(lines)).not.toContain("指示全文");
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

  it("drops transcript preview details from structured logs by default", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "turn.completed",
          sessionId: "gv_sess_test",
          details: {
            turnIndex: 1,
            inputMode: "voice",
            userTextLen: 12,
            agentTextLen: 14,
            userTextPreview: "ユーザー本文",
            agentTextPreview: "エージェント本文",
            instructions: "絶対にログしてはいけない指示全文",
          },
        },
      })
    );
    expect(response.status).toBe(200);
    const lines = logSpy.mock.calls.map(
      (c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>
    );
    expect(JSON.stringify(lines)).not.toContain("ユーザー本文");
    expect(JSON.stringify(lines)).not.toContain("エージェント本文");
    expect(JSON.stringify(lines)).not.toContain("指示全文");
  });

  it("logs truncated transcript previews plus UTF-8 Base64 only when explicitly enabled", async () => {
    vi.stubEnv("GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_ENABLED", "true");
    vi.stubEnv("GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_MAX_CHARS", "6");
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "stt.completed",
          sessionId: "gv_sess_test",
          details: {
            turnIndex: 2,
            textLen: 20,
            sttTextPreview: "住宅設備メーカーの営業事務ですと",
          },
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
      | { sttTextPreview?: string; sttTextPreviewUtf8Base64?: string }
      | undefined;
    expect(sttLine?.sttTextPreview).toBe("住宅設備メー");
    expect(
      Buffer.from(sttLine?.sttTextPreviewUtf8Base64 ?? "", "base64").toString(
        "utf8"
      )
    ).toBe("住宅設備メー");
    expect(JSON.stringify(lines)).not.toContain("カーの営業事務");
  });

  it("does not trust client-provided transcript Base64 fields", async () => {
    vi.stubEnv("GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_ENABLED", "true");
    vi.stubEnv("GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_MAX_CHARS", "20");
    const { POST } = await import("../../app/api/v3/event/route");
    const spoofed = Buffer.from("偽装された発話", "utf8").toString("base64");
    const response = await POST(
      validRequest({
        body: {
          kind: "turn.completed",
          sessionId: "gv_sess_test",
          details: {
            turnIndex: 2,
            inputMode: "text",
            userTextLen: 8,
            agentTextLen: 9,
            userTextPreview: "正しいユーザー発話",
            userTextPreviewUtf8Base64: spoofed,
            agentTextPreview: "正しいAI発話",
            agentTextPreviewUtf8Base64: spoofed,
            agentSpokenTextPreview: "正しいAI音声発話",
            agentSpokenTextPreviewUtf8Base64: spoofed,
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
    ) as
        | {
            userTextPreviewUtf8Base64?: string;
            agentTextPreviewUtf8Base64?: string;
            agentSpokenTextPreviewUtf8Base64?: string;
          }
      | undefined;
    expect(
      Buffer.from(
        metricsLine?.userTextPreviewUtf8Base64 ?? "",
        "base64"
      ).toString("utf8")
    ).toBe("正しいユーザー発話");
    expect(
      Buffer.from(
        metricsLine?.agentTextPreviewUtf8Base64 ?? "",
        "base64"
      ).toString("utf8")
    ).toBe("正しいAI発話");
    expect(
      Buffer.from(
        metricsLine?.agentSpokenTextPreviewUtf8Base64 ?? "",
        "base64"
      ).toString("utf8")
    ).toBe("正しいAI音声発話");
    expect(JSON.stringify(lines)).not.toContain(spoofed);
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

  // PR A — voice latency observability roadmap, Phase 0.
  // The directive (latency-first roadmap §4 Phase 0) requires that every
  // turn carry routePath, firstAudibleAudioMs, lock-path attribution, and
  // server-measured cacheLookupMs into the typed `grokVoice.turnMetrics`
  // scope so we can group by lane in Cloud Logging without joining
  // against clientEvent details. These tests pin that contract.
  it("forwards latency observability fields to grokVoice.turnMetrics (PR A)", async () => {
    vi.stubEnv("K_REVISION", "adecco-roleplay-build-2026-05-10-test");
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "turn.completed",
          sessionId: "gv_sess_test",
          details: {
            turnIndex: 1,
            inputMode: "voice",
            userTextLen: 12,
            agentTextLen: 33,
            firstAudioMs: 2658,
            firstAudibleAudioMs: 4261,
            firstRealtimeAudioDeltaMs: 2658,
            doneMs: 11303,
            audioBytes: 337920,
            error: null,
            routePath: "rt_voice",
            localLockedAudioHit: false,
            sanitizerDelayMs: 1603,
            outcome: "clean",
            sessionTainted: false,
            promptVersion: "compile-scenario@2026-05-07.v3.10.x",
            promptHash: "750d10ade35a",
            guardrailVersion: "gv-think-fast-v5.0-2026-05-10",
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
    expect(metricsLine!["routePath"]).toBe("rt_voice");
    expect(metricsLine!["firstAudibleAudioMs"]).toBe(4261);
    expect(metricsLine!["firstRealtimeAudioDeltaMs"]).toBe(2658);
    expect(metricsLine!["sanitizerDelayMs"]).toBe(1603);
    expect(metricsLine!["localLockedAudioHit"]).toBe(false);
    expect(metricsLine!["outcome"]).toBe("clean");
    expect(metricsLine!["sessionTainted"]).toBe(false);
    expect(metricsLine!["cloudRunRevision"]).toBe(
      "adecco-roleplay-build-2026-05-10-test"
    );
  });

  it("forwards lock-path TTS observability fields to grokVoice.turnMetrics (PR A)", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "turn.completed",
          sessionId: "gv_sess_test",
          details: {
            turnIndex: 3,
            inputMode: "voice",
            userTextLen: 7,
            agentTextLen: 18,
            firstAudioMs: 5302,
            firstAudibleAudioMs: 5302,
            doneMs: 10432,
            audioBytes: 246240,
            error: null,
            routePath: "lock_voice_network_tts",
            localLockedAudioHit: false,
            lockedResponseKey: "請求想定は経験により、千七百五十円から、千九百円程度です。",
            cacheStatus: "hit",
            cacheLookupMs: 47,
            ttsVendorMsAtCreation: 1867,
            networkTtsMs: 1023,
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
    expect(metricsLine!["routePath"]).toBe("lock_voice_network_tts");
    expect(metricsLine!["cacheStatus"]).toBe("hit");
    expect(metricsLine!["cacheLookupMs"]).toBe(47);
    expect(metricsLine!["ttsVendorMsAtCreation"]).toBe(1867);
    expect(metricsLine!["networkTtsMs"]).toBe(1023);
    expect(metricsLine!["lockedResponseKey"]).toBe(
      "請求想定は経験により、千七百五十円から、千九百円程度です。"
    );
    expect(metricsLine!["localLockedAudioHit"]).toBe(false);
  });

  // Codex P2 follow-up on PR #83: missing optional latency keys must be
  // OMITTED from the typed `grokVoice.turnMetrics` scope (sparse), while
  // keys explicitly set to null by a future client must be PRESERVED as
  // null (so we can distinguish "client did not measure this" from
  // "client measured this and it was null"). Pinning all three branches
  // keeps the schema contract stable as more PRs add fields.
  it("omits optional latency fields from turnMetrics when an old client does not send them (sparse schema)", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "turn.completed",
          sessionId: "gv_sess_test",
          // Mimic an old client that only sends the original turn fields,
          // i.e. NONE of the PR A latency observability keys.
          details: {
            turnIndex: 7,
            inputMode: "voice",
            userTextLen: 5,
            agentTextLen: 12,
            firstAudioMs: 4200,
            doneMs: 6800,
            audioBytes: 320640,
            promptVersion: "compile-scenario@2026-05-07.v3.10.x",
            promptHash: "750d10ade35a",
            guardrailVersion: "gv-think-fast-v5.0-2026-05-10",
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
    // Each new PR A field must be ABSENT (not emitted as null) when the
    // client did not send the property.
    for (const key of [
      "routePath",
      "firstAudibleAudioMs",
      "firstRealtimeAudioDeltaMs",
      "sttFinalMs",
      "lockDecisionMs",
      "localLockedAudioHit",
      "lockedResponseKey",
      "cacheStatus",
      "cacheLookupMs",
      "ttsVendorMsAtCreation",
      "networkTtsMs",
      "audioDecodeMs",
      "sanitizerDelayMs",
      "sanitizedTtsMs",
      "reseedMs",
      "outcome",
      "sessionTainted",
      "parentSessionId",
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(metricsLine, key),
        `expected ${key} to be omitted, but it was emitted`
      ).toBe(false);
    }
    // The legacy fields the client DID send must still be present.
    expect(metricsLine!["firstAudioMs"]).toBe(4200);
    expect(metricsLine!["doneMs"]).toBe(6800);
    expect(metricsLine!["audioBytes"]).toBe(320640);
  });

  it("preserves an explicit null for a latency field rather than coercing to omitted", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "turn.completed",
          sessionId: "gv_sess_test",
          details: {
            turnIndex: 1,
            inputMode: "voice",
            userTextLen: 5,
            agentTextLen: 12,
            firstAudioMs: 100,
            doneMs: 200,
            audioBytes: 1024,
            // Future-client signal: "I tracked this field but it has no
            // value for this turn." Distinct from "I never set the field".
            firstAudibleAudioMs: null,
            cacheLookupMs: null,
            outcome: null,
            parentSessionId: null,
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
    // Each explicit null must be preserved as null (key present, value null).
    for (const key of [
      "firstAudibleAudioMs",
      "cacheLookupMs",
      "outcome",
      "parentSessionId",
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(metricsLine, key),
        `expected ${key} to be present (as null)`
      ).toBe(true);
      expect(metricsLine![key]).toBeNull();
    }
  });

  it("rejects an invalid routePath value rather than passing garbage through", async () => {
    const { POST } = await import("../../app/api/v3/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "turn.completed",
          sessionId: "gv_sess_test",
          details: {
            turnIndex: 1,
            inputMode: "voice",
            firstAudioMs: 100,
            doneMs: 200,
            audioBytes: 1024,
            routePath: "definitely_not_a_real_route",
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
    expect(metricsLine!["routePath"]).toBeUndefined();
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
