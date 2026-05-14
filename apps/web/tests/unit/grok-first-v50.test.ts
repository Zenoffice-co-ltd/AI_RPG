// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";
import { useGrokFirstRoleplayConversation } from "../../lib/grok-first-roleplay/useGrokFirstRoleplayConversation";
import {
  TAIL_GUARD_MAX_HOLD_MS,
  TailOnlyAudioGuard,
  selectTailHoldMs,
} from "../../lib/grok-first-roleplay/audio-tail-guard";
import {
  applyNegativeGuardDeletionOnly,
  evaluateNegativeGuard,
} from "../../lib/grok-first-roleplay/negative-guard";
import {
  assertPromptDenylist,
  buildGrokFirstV50Prompt,
} from "../../lib/grok-first-roleplay/prompt";
import { buildRelayWsUrl } from "../../lib/grok-first-roleplay/session";
import {
  logGrokFirstV50ServerEvent,
  sanitizeGrokFirstV50Details,
} from "../../lib/grok-first-roleplay/metrics";
import { buildProtocols } from "../../lib/grok-first-roleplay/realtime";
import { shouldAllowGrokFirstV50PageInProduction } from "../../components/roleplay/GrokFirstV50RoleplayPage";
import type {
  GrokFirstV50ServerEvent,
  GrokFirstV50Session,
} from "../../lib/grok-first-roleplay/types";

function validRequest() {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "http://127.0.0.1:3000",
    referer: "http://127.0.0.1:3000/demo/adecco-roleplay-v50",
    cookie: `roleplay_api_access=${signAccessToken("demo-secret")}`,
  });
  return new NextRequest("http://127.0.0.1:3000/api/grok-first-v50/session", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
}

function validV501Request() {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "http://127.0.0.1:3000",
    referer: "http://127.0.0.1:3000/demo/adecco-roleplay-v50-1",
    cookie: `roleplay_api_access=${signAccessToken("demo-secret")}`,
  });
  return new NextRequest("http://127.0.0.1:3000/api/grok-first-v50-1/session", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
}

describe("grok-first v50 runtime", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("XAI_RELAY_TICKET_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv(
      "GROK_VOICE_RELAY_WS_URL",
      "wss://voice.mendan.biz/api/v3/realtime-relay"
    );
    vi.stubEnv("GROK_VOICE_RELAY_EXPECTED_AUD", "voice.mendan.biz");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("serves an isolated v50 session payload without fixed-answer artifacts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { POST } = await import("../../app/api/grok-first-v50/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body["demoSlug"]).toBe("adecco-roleplay-v50");
    expect(body["backend"]).toBe("grok-first-v50");
    expect(body["model"]).toBe("grok-voice-think-fast-1.0");
    expect(body["realtimeTransport"]).toBe("mendan_cloud_run_relay_wss");
    expect(body["wsUrl"]).toBe("wss://voice.mendan.biz/api/v3/realtime-relay");
    expect(body["tools"]).toEqual([]);
    expect(body["registeredSpeechPayloadIncluded"]).toBe(false);
    expect(body["lockedResponseAudioBundleIncluded"]).toBe(false);
    expect(body["runtimeTtsEnabled"]).toBe(false);
    expect(body["replacementTtsEnabled"]).toBe(false);
    expect(body["fullTurnBufferEnabled"]).toBe(false);
    expect(body["debugTranscriptPreviewEnabled"]).toBe(false);
    expect(body["registeredSpeech"]).toBeUndefined();
    expect(body["lockedResponseAudioBundle"]).toBeUndefined();
    expect(body["ephemeralToken"]).toBeUndefined();
    expect(body["ephemeralExpiresAt"]).toBeUndefined();

    const realtimeAuth = body["realtimeAuth"] as Record<string, unknown>;
    expect(realtimeAuth["mode"]).toBe("mendan_relay_subprotocol");
    expect(realtimeAuth["protocol"]).toBe("mendan-relay-v1");
    expect(String(realtimeAuth["ticket"])).toMatch(/^mra1\./);
    expect(realtimeAuth["token"]).toBeUndefined();

    const turnDetection = body["turnDetection"] as Record<string, unknown>;
    expect(turnDetection).toEqual({
      type: "server_vad",
      threshold: 0.65,
      silence_duration_ms: 650,
      prefix_padding_ms: 333,
    });
    const audio = body["audio"] as Record<string, unknown>;
    expect(audio).toEqual({
      inputFormat: "audio/pcm",
      outputFormat: "audio/pcm",
      sampleRate: 24_000,
    });
    expect(JSON.stringify(body)).not.toContain("0123456789abcdef0123456789abcdef");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves v50.1 with the updated system prompt and route identity", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { POST } = await import("../../app/api/grok-first-v50-1/session/route");
    const response = await POST(validV501Request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body["demoSlug"]).toBe("adecco-roleplay-v50-1");
    expect(body["backend"]).toBe("grok-first-v50-1");
    expect(body["realtimeTransport"]).toBe("mendan_cloud_run_relay_wss");
    expect(body["wsUrl"]).toBe("wss://voice.mendan.biz/api/v3/realtime-relay");
    expect(body["ephemeralToken"]).toBeUndefined();
    expect(body["ephemeralExpiresAt"]).toBeUndefined();
    expect((body["realtimeAuth"] as Record<string, unknown>)["mode"]).toBe(
      "mendan_relay_subprotocol"
    );
    expect(body["scenarioId"]).toBe(
      "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v50_1"
    );
    expect(body["promptVersion"]).toBe("grok-first-v50.1-2026-05-14");
    expect(body["firstMessage"]).toBe(
      "本日はありがとうございます。営業事務で一名、派遣の方を検討していまして、まずは御社でどんな方をご紹介いただけそうか相談したいです。"
    );
    expect(String(body["instructions"])).toContain(
      "# 派遣営業向けAIロープレ System Prompt"
    );
    expect(String(body["instructions"])).toContain(
      "浅い質問には、浅く答えます。"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends relay tickets through websocket subprotocols", () => {
    expect(
      buildProtocols({
        mode: "mendan_relay_subprotocol",
        protocol: "mendan-relay-v1",
        ticket: "mra1.redacted.ticket",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
    ).toEqual(["mendan-relay-v1", "mendan-relay-ticket.mra1.redacted.ticket"]);
  });

  it("preserves the explicit browser DOD E2E production bypass only", () => {
    expect(
      shouldAllowGrokFirstV50PageInProduction({
        NODE_ENV: "production",
        GROK_FIRST_V50_BROWSER_DOD_E2E: "1",
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      shouldAllowGrokFirstV50PageInProduction({
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      shouldAllowGrokFirstV50PageInProduction({
        NODE_ENV: "production",
        XAI_RELAY_TICKET_SECRET: "0123456789abcdef0123456789abcdef",
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  it("fails fast on invalid relay websocket URLs", () => {
    expect(buildRelayWsUrl("wss://voice.mendan.biz/api/v3/realtime-relay")).toBe(
      "wss://voice.mendan.biz/api/v3/realtime-relay"
    );
    expect(() => buildRelayWsUrl("https://voice.mendan.biz/api/v3/realtime-relay")).toThrow(
      "must use ws/wss"
    );
    expect(() => buildRelayWsUrl("wss://voice.mendan.biz/wrong")).toThrow(
      "path must be /api/v3/realtime-relay"
    );
    expect(() =>
      buildRelayWsUrl("wss://voice.mendan.biz/api/v3/realtime-relay?model=x")
    ).toThrow("must not include query or hash");
    expect(() =>
      buildRelayWsUrl("wss://voice.mendan.biz/api/v3/realtime-relay#frag")
    ).toThrow("must not include query or hash");
  });

  it("gates v50 transcript previews out of production event logs by default", () => {
    const sanitized = sanitizeGrokFirstV50Details({
      userTextPreview: "業務内容を教えてください",
      agentTextPreview: "受発注入力が中心です",
      sttTextPreview: "業務内容",
      userTextLen: 12,
      agentTextLen: 10,
      promptHash: "abc123",
      instructions: "internal role prompt",
      xaiClientSecretToken: "secret-token",
      audioBase64: "raw-audio",
    });

    expect(sanitized).toEqual({
      userTextLen: 12,
      agentTextLen: 10,
      promptHash: "abc123",
    });
  });

  it("allows short v50 transcript previews only behind the debug flag", () => {
    const longPreview = "あ".repeat(230);
    const sanitized = sanitizeGrokFirstV50Details(
      {
        userTextPreview: longPreview,
        agentTextPreview: "受発注入力です",
        sttTextPreview: "業務内容",
        userTextLen: 230,
        instructions: "internal role prompt",
      },
      { debugTranscriptPreviewEnabled: true }
    );

    expect(String(sanitized["userTextPreview"])).toHaveLength(203);
    expect(String(sanitized["userTextPreview"])).toMatch(/\.\.\.$/);
    expect(sanitized["agentTextPreview"]).toBe("受発注入力です");
    expect(sanitized["sttTextPreview"]).toBe("業務内容");
    expect(sanitized["instructions"]).toBeUndefined();
  });

  it("applies transcript preview gating at the v50 event logger boundary", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logGrokFirstV50ServerEvent({
      kind: "turn.completed",
      sessionId: "gfv50_test",
      details: {
        userTextPreview: "業務内容を教えてください",
        agentTextPreview: "受発注入力です",
        routePath: "grok_first_realtime",
      },
      debugTranscriptPreviewEnabled: false,
    });

    const logged = JSON.parse(String(consoleSpy.mock.calls[0]?.[0])) as {
      details: Record<string, unknown>;
    };
    expect(logged.details["userTextPreview"]).toBeUndefined();
    expect(logged.details["agentTextPreview"]).toBeUndefined();
    expect(logged.details["routePath"]).toBe("grok_first_realtime");
  });

  it("keeps prompt free of exact-answer locks and evaluation-role framing", () => {
    const prompt = buildGrokFirstV50Prompt();
    const v501Prompt = buildGrokFirstV50Prompt("v50.1");
    expect(prompt.instructions).toContain("Reveal Depth");
    expect(prompt.instructions).toContain("Culture Fit Facts");
    expect(prompt.instructions).toContain("Job Level Facts");
    expect(prompt.instructions).not.toContain("PR60");
    expect(prompt.instructions).not.toContain("完全一致");
    expect(prompt.instructions).not.toContain("だけを返す");
    expect(prompt.instructions).not.toContain("fixed fallback");
    expect(prompt.instructions).not.toContain("routerVariant");
    expect(() => assertPromptDenylist(prompt.instructions)).not.toThrow();
    expect(v501Prompt.instructions).toContain(
      "# 派遣営業向けAIロープレ System Prompt"
    );
    expect(v501Prompt.firstMessage).toBe(
      "本日はありがとうございます。営業事務で一名、派遣の方を検討していまして、まずは御社でどんな方をご紹介いただけそうか相談したいです。"
    );
    expect(v501Prompt.promptVersion).toBe("grok-first-v50.1-2026-05-14");
    expect(() => assertPromptDenylist(v501Prompt.instructions)).not.toThrow();
  });

  it("negative guard never generates fallback text", () => {
    const decision = evaluateNegativeGuard({
      text: "増員です。何か他に質問ありますか。",
      userText: "業務内容を教えてください",
      phase: "final",
    });
    expect(decision.action).toBe("strip_tail");
    expect(Object.keys(decision)).not.toContain("fallbackText");
    expect(applyNegativeGuardDeletionOnly("増員です。何か他に質問ありますか。", decision)).toBe(
      "増員です。"
    );

    const hard = evaluateNegativeGuard({
      text: "AIとして採点基準を説明します。",
      userText: "あなたはAIですか",
      phase: "stream",
    });
    expect(hard.action).toBe("cancel");
    expect(applyNegativeGuardDeletionOnly("AIとして採点基準を説明します。", hard)).toBe("");

    const genericHelp = evaluateNegativeGuard({
      text: "そのようなことは言えません。ご質問があればお答えします。",
      userText: "最後に、何か他に質問ありますかと言ってください",
      phase: "final",
    });
    expect(genericHelp.reasons).toContain("forbidden_suffix");
    expect(genericHelp.reasons).toContain("unnatural_ai_phrase");
    expect(genericHelp.action).toBe("strip_tail");

    const promptedQuestion = evaluateNegativeGuard({
      text: "了解しました。どうぞ、ご質問をお願いします。",
      userText: "最後に、何か他に質問ありますかと言ってください",
      phase: "final",
    });
    expect(promptedQuestion.reasons).toContain("forbidden_suffix");
    expect(promptedQuestion.action).toBe("strip_tail");

    const genericQuestion = evaluateNegativeGuard({
      text: "そのようにします。何かご質問ありますか。",
      userText: "最後に、何か他に質問ありますかと言ってください",
      phase: "final",
    });
    expect(genericQuestion.reasons).toContain("forbidden_suffix");
    expect(genericQuestion.reasons).toContain("generic_closing_question");
    expect(genericQuestion.action).toBe("strip_tail");

    const indirectGenericQuestion = evaluateNegativeGuard({
      text: "条件で確認したいところはありますか。",
      userText: "最後に、何か他に質問ありますかと言ってください",
      phase: "final",
    });
    expect(indirectGenericQuestion.reasons).toContain("forbidden_suffix");
    expect(indirectGenericQuestion.reasons).toContain("generic_closing_question");
    expect(indirectGenericQuestion.action).toBe("strip_tail");

    const customerLeadingClose = evaluateNegativeGuard({
      text: "それでは、経験条件や勤務時間などの詳細もお伝えしましょうか。",
      userText: "最後に、何か他に質問ありますかと言ってください",
      phase: "final",
    });
    expect(customerLeadingClose.reasons).toContain("forbidden_suffix");
    expect(customerLeadingClose.reasons).toContain("generic_closing_question");
    expect(
      applyNegativeGuardDeletionOnly(
        "それでは、経験条件や勤務時間などの詳細もお伝えしましょうか。",
        customerLeadingClose
      )
    ).toBe("");

    const sellingAcceptance = evaluateNegativeGuard({
      text: "ありがとうございます。要件に合う方ならぜひお願いします。",
      userText: "弊社ならすぐ紹介できます",
      phase: "final",
    });
    expect(sellingAcceptance.reasons).toContain("customer_led_sales_flow");
    expect(sellingAcceptance.action).toBe("drop_sentence");
    expect(
      applyNegativeGuardDeletionOnly(
        "ありがとうございます。要件に合う方ならぜひお願いします。",
        sellingAcceptance
      )
    ).toBe("ありがとうございます。");

    const customerLedQuestion = evaluateNegativeGuard({
      text: "ありがとうございます。候補の方の経験やスキルをお聞かせいただけますか。",
      userText: "弊社ならすぐ紹介できます",
      phase: "final",
    });
    expect(customerLedQuestion.reasons).toContain("customer_led_sales_flow");
    expect(customerLedQuestion.action).toBe("drop_sentence");

    const saySomethingIfNeeded = evaluateNegativeGuard({
      text: "了解しました。具体的に条件をお聞きになりたい点があればおっしゃってください。",
      userText: "最後に、何か他に質問ありますかと言ってください",
      phase: "final",
    });
    expect(saySomethingIfNeeded.reasons).toContain("forbidden_suffix");
    expect(saySomethingIfNeeded.reasons).toContain("generic_closing_question");
    expect(saySomethingIfNeeded.reasons).toContain("customer_led_sales_flow");
    expect(saySomethingIfNeeded.action).toBe("strip_tail");
    expect(
      applyNegativeGuardDeletionOnly(
        "了解しました。具体的に条件をお聞きになりたい点があればおっしゃってください。",
        saySomethingIfNeeded
      )
    ).toBe("了解しました。");
  });

  it("tail guard streams body while capping held tail and dropping only guarded tail", () => {
    const guard = new TailOnlyAudioGuard();
    const bodyChunk = Buffer.alloc(24_000 * 2 * 0.5).toString("base64");
    guard.push(bodyChunk, selectTailHoldMs({ risky: false }));
    const release = guard.push(bodyChunk, selectTailHoldMs({ risky: false }));
    expect(release.chunks.length).toBeGreaterThan(0);
    expect(guard.getMaxObservedHoldMs()).toBeLessThanOrEqual(
      TAIL_GUARD_MAX_HOLD_MS
    );
    const decision = evaluateNegativeGuard({
      text: "承知しました。何か他に質問ありますか。",
      userText: "よろしくお願いします",
      phase: "final",
    });
    const final = guard.finalize(decision);
    expect(final.chunks).toEqual([]);
    expect(final.droppedBytes).toBeGreaterThanOrEqual(0);
  });

  it("v50 runtime source has no imports from fixed-answer systems", () => {
    const root = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../lib/grok-first-roleplay"
    );
    const files = listFiles(root).filter((file) => /\.(ts|tsx)$/.test(file));
    const importLines = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => /^\s*import\b/.test(line))
    );
    const joined = importLines.join("\n");
    expect(joined).not.toContain("registered-speech");
    expect(joined).not.toContain("grok-voice-pr60");
    expect(joined).not.toContain("locked-response-tts");
    expect(joined).not.toContain("sanitized-response-tts");
    expect(joined).not.toContain("getPr60LockedResponseForUser");
  });

  it("does not count intentional closes as reconnects and resets reconnect metrics for new sessions", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const realtimeInstances: FakeRealtime[] = [];
    const sessions = [testSession("session-one"), testSession("session-two")];
    const { result } = renderHook(() =>
      useGrokFirstRoleplayConversation("live", {
        micEnabled: false,
        fetchSession: vi.fn(async () => sessions.shift() ?? testSession("extra")),
        createRealtime: (opts) => {
          const realtime = new FakeRealtime(opts);
          realtimeInstances.push(realtime);
          return realtime as never;
        },
        createAudioQueue: () => fakeAudioQueue() as never,
      })
    );

    await act(async () => {
      await result.current.startConversation();
    });
    expect(realtimeInstances).toHaveLength(1);

    await act(async () => {
      await result.current.endConversation();
      await result.current.startConversation();
    });
    expect(realtimeInstances).toHaveLength(2);

    await act(async () => {
      await result.current.sendTextMessage("業務内容を教えてください");
      realtimeInstances[1]?.emit({ type: "response.created" });
      realtimeInstances[1]?.emit({
        type: "response.audio_transcript.delta",
        delta: "受注入力や納期調整が中心です。",
      });
      realtimeInstances[1]?.emit({ type: "response.done" });
    });

    await waitFor(() => expect(result.current.metricsLog).toHaveLength(1));
    expect(result.current.metricsLog[0]?.websocketReconnectCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/grok-first-v50/event",
      expect.objectContaining({ method: "POST" })
    );
  });
});

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function testSession(sessionId: string): GrokFirstV50Session {
  return {
    sessionId,
    demoSlug: "adecco-roleplay-v50",
    backend: "grok-first-v50",
    scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v50",
    promptVersion: "test",
    promptHash: "test",
    guardrailVersion: "test",
    model: "grok-voice-think-fast-1.0",
    voiceId: "99c95cc8a177",
    realtimeTransport: "mendan_cloud_run_relay_wss",
    wsUrl: "wss://voice.mendan.biz/api/v3/realtime-relay",
    realtimeAuth: {
      mode: "mendan_relay_subprotocol",
      protocol: "mendan-relay-v1",
      ticket: "mra1.test.ticket",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    audio: {
      inputFormat: "audio/pcm",
      outputFormat: "audio/pcm",
      sampleRate: 24_000,
    },
    turnDetection: {
      type: "server_vad",
      threshold: 0.65,
      silence_duration_ms: 650,
      prefix_padding_ms: 333,
    },
    tools: [],
    instructions: "test instructions",
    firstMessage: "お電話ありがとうございます。",
    registeredSpeechPayloadIncluded: false,
    lockedResponseAudioBundleIncluded: false,
    runtimeTtsEnabled: false,
    replacementTtsEnabled: false,
    fullTurnBufferEnabled: false,
    debugTranscriptPreviewEnabled: false,
  };
}

class FakeRealtime {
  private ready = false;
  private closedByUs = false;

  constructor(
    private readonly opts: {
      onMessage: (event: GrokFirstV50ServerEvent) => void;
      onOpen?: () => void;
      onReady?: () => void;
      onClose?: (event: { code: number; reason: string }) => void;
    }
  ) {}

  open() {
    this.opts.onOpen?.();
  }

  isReady() {
    return this.ready;
  }

  sendSessionUpdate() {}

  sendAssistantHistory() {
    this.ready = true;
    this.opts.onReady?.();
  }

  sendUserText() {}

  appendAudio() {}

  cancelResponse() {}

  close() {
    this.closedByUs = true;
    this.ready = false;
    this.opts.onClose?.({ code: 1000, reason: "client_close" });
  }

  wasClosedByUs() {
    return this.closedByUs;
  }

  emit(event: GrokFirstV50ServerEvent) {
    this.opts.onMessage(event);
  }
}

function fakeAudioQueue() {
  return {
    enqueueBase64: vi.fn(),
    setVolume: vi.fn(),
    stop: vi.fn(async () => undefined),
    getOutputVolume: vi.fn(() => 0),
  };
}
