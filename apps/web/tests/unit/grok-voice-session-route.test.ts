import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";
import { resetSessionTokenRateLimit } from "../../lib/roleplay/rate-limit";

function validRequest({
  origin = "http://127.0.0.1:3000",
  referer = "http://127.0.0.1:3000/demo/adecco-roleplay-v3",
  cookie = `roleplay_api_access=${signAccessToken("demo-secret")}`,
  body = {},
}: {
  origin?: string | null;
  referer?: string | null;
  cookie?: string;
  body?: unknown;
} = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  if (referer) headers.set("referer", referer);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest("http://127.0.0.1:3000/api/v3/session", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("grok-voice session route", () => {
  beforeEach(() => {
    resetSessionTokenRateLimit();
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("ENABLE_GROK_VOICE_ROLEPLAY", "true");
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("GROK_VOICE_MODEL", "grok-voice-think-fast-1.0");
    vi.stubEnv("GROK_VOICE_VOICE_ID", "rex");
    vi.stubEnv("GROK_VOICE_INPUT_FORMAT", "audio/pcm");
    vi.stubEnv("GROK_VOICE_OUTPUT_FORMAT", "audio/pcm");
    vi.stubEnv("GROK_VOICE_SAMPLE_RATE", "24000");
    vi.stubEnv("GROK_VOICE_REALTIME_BASE", "wss://api.x.ai/v1/realtime");
    vi.stubEnv(
      "GROK_VOICE_EPHEMERAL_BASE",
      "https://api.x.ai/v1/realtime/client_secrets"
    );
    vi.stubEnv("GROK_VOICE_TURN_DETECTION_THRESHOLD", "0.5");
    vi.stubEnv("GROK_VOICE_TURN_DETECTION_SILENCE_MS", "500");
    vi.stubEnv("GROK_VOICE_TURN_DETECTION_PREFIX_PADDING_MS", "333");
    vi.stubEnv("GROK_VOICE_TTS_CACHE_DISABLE_FIRESTORE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns 503 when ENABLE_GROK_VOICE_ROLEPLAY is false", async () => {
    vi.stubEnv("ENABLE_GROK_VOICE_ROLEPLAY", "false");
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(503);
  });

  it("returns 503 when XAI_API_KEY is missing", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(503);
  });

  it("returns 401 without an access cookie", async () => {
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest({ cookie: "" }));
    expect(response.status).toBe(401);
  });

  it("returns 403 when origin doesn't match", async () => {
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(
      validRequest({
        origin: "http://evil.example.com",
        referer: null,
      })
    );
    expect(response.status).toBe(403);
  });

  it("issues an ephemeral token and returns wsUrl + firstMessage WITHOUT exposing XAI_API_KEY", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            value: "xai-realtime-client-secret-test-value",
            expires_at: 1747_000_000,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(typeof body["sessionId"]).toBe("string");
    expect(body["backend"]).toBe("grok-voice-think-fast");
    expect(body["wsUrl"]).toMatch(
      /^wss:\/\/api\.x\.ai\/v1\/realtime\?model=grok-voice-think-fast-1\.0$/
    );
    expect(body["ephemeralToken"]).toBe(
      "xai-realtime-client-secret-test-value"
    );
    expect(body["realtimeTransport"]).toBe("xai_direct_wss");
    expect(body["realtimeAuth"]).toEqual({
      mode: "xai_ephemeral_subprotocol",
      token: "xai-realtime-client-secret-test-value",
      expiresAt: expect.any(String),
    });
    expect(body["grokVoiceModel"]).toBe("grok-voice-think-fast-1.0");
    expect(body["grokVoiceVoiceId"]).toBe("rex");
    expect(typeof body["firstMessage"]).toBe("string");
    expect(typeof body["instructions"]).toBe("string");
    expect((body["instructions"] as string).length).toBeGreaterThan(2_000);
    expect(typeof body["promptVersion"]).toBe("string");
    expect(typeof body["promptHash"]).toBe("string");
    expect(typeof body["guardrailVersion"]).toBe("string");
    expect(body["scenarioId"]).toBe(
      "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21"
    );
    const turnDetection = body["turnDetection"] as Record<string, unknown>;
    expect(turnDetection["type"]).toBe("server_vad");
    expect(turnDetection["prefix_padding_ms"]).toBe(333);
    // -------------------------------------------------------------
    // Gate 3 — session route content: every v2.1 priority block + the
    // earned-reveal phrases the live cases hinge on must be present in the
    // exact instructions Grok will see.
    // -------------------------------------------------------------
    const instructions = body["instructions"] as string;
    expect(instructions).toContain("住宅設備メーカー");
    expect(instructions).toContain("よくご存じですね");
    expect(instructions).toContain("その理解で近いです");
    expect(instructions).toContain("v2.1 Customer Attitude");
    expect(instructions).toContain("v2.1 Answer Budget");
    expect(instructions).toContain("v2.1 Housing Equipment Manufacturer Domain");
    expect(instructions).toContain("v2.1 Earned Reveal Policy");
    expect(instructions).toContain("Pronunciation Guide");
    // -------------------------------------------------------------
    // Gate 3 — section ordering: Pronunciation Guide must sit BETWEEN the
    // Knowledge Base and the Runtime Guardrail (so Grok reads the lexicon
    // overrides as part of its scenario context, not as an afterthought).
    // -------------------------------------------------------------
    const kbIdx = instructions.indexOf("# Knowledge Base");
    const guideIdx = instructions.indexOf("# Pronunciation Guide");
    const guardrailIdx = instructions.indexOf("Runtime Guardrails");
    expect(kbIdx).toBeGreaterThan(0);
    expect(guideIdx).toBeGreaterThan(kbIdx);
    expect(guardrailIdx).toBeGreaterThan(guideIdx);
    // -------------------------------------------------------------
    // Gate 4 — pronunciation guide vocabulary: every Adecco-flagged term
    // that ALSO appears in the bundled scenario texts must be reflected in
    // the guide. (Terms only used by sales-side jargon, e.g. KAM, won't
    // appear in the customer-AI prompt and so won't appear in the guide;
    // those are covered by the lexicon-file gate below.)
    // -------------------------------------------------------------
    const requiredVocabInPrompt = [
      "受発注",
      "納期調整",
      "在庫確認",
      "品番",
      "型番",
      "施工日",
      "職場見学",
      "CP",
      "SK",
    ];
    for (const term of requiredVocabInPrompt) {
      expect(instructions).toContain(`「${term}」`);
    }
    // CRITICAL: The xAI API key must NEVER be returned to the client.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("xai-test-key");
    // We also confirm the upstream request used the API key header.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.x.ai/v1/realtime/client_secrets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer xai-test-key",
        }),
      })
    );
    // Body must NOT include session config (the xAI ephemeral endpoint
    // explicitly rejects `session` and `expires_after.anchor`); only
    // `expires_after.seconds`.
    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body as string
    ) as Record<string, unknown>;
    expect(sentBody).toEqual({ expires_after: { seconds: 300 } });
    expect(body["greetingAudio"]).toBeUndefined();
    // Strict sanitized playback flag defaults to true and is surfaced in the
    // session payload so the client doesn't need a separate config fetch.
    expect(body["strictSanitizedPlayback"]).toBe(true);
  });

  it("surfaces strictSanitizedPlayback=false when env flag is disabled", async () => {
    vi.stubEnv("GROK_VOICE_STRICT_SANITIZED_PLAYBACK", "false");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          value: "xai-realtime-client-secret-test-value",
          expires_at: 1747_000_000,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["strictSanitizedPlayback"]).toBe(false);
  });

  it("serves v23 with compact instructions, faster VAD silence, and 24k Haruto-safe sample rate", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          value: "xai-realtime-client-secret-test-value",
          expires_at: 1747_000_000,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(
      validRequest({
        referer: "http://127.0.0.1:3000/demo/adecco-roleplay-v23",
        body: { demoSlug: "adecco-roleplay-v23" },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["demoSlug"]).toBe("adecco-roleplay-v23");
    expect(body["routerVariant"]).toBe("T_V21_ACK_STREAM_COMPACT_PROMPT");
    expect(body["strictPlaybackMode"]).toBe("risk_based");
    expect(body["registeredSpeechBuildId"]).toBe(
      "2026-05-12T05-31-48-094Z"
    );
    const turnDetection = body["turnDetection"] as Record<string, unknown>;
    expect(turnDetection["silence_duration_ms"]).toBe(350);
    const audio = body["audio"] as Record<string, unknown>;
    expect(audio["sampleRate"]).toBe(24_000);
    const instructions = body["instructions"] as string;
    expect(instructions.length).toBeLessThan(2_500);
    expect(instructions).toContain("相槌から始まる質問でも");
    expect(instructions).not.toContain("v2.1 Customer Attitude");
  });

  it("serves v24 as v23 behavior over the same-origin realtime relay", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          value: "xai-realtime-client-secret-test-value",
          expires_at: 1747_000_000,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(
      validRequest({
        referer: "http://127.0.0.1:3000/demo/adecco-roleplay-v24",
        body: { demoSlug: "adecco-roleplay-v24" },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["demoSlug"]).toBe("adecco-roleplay-v24");
    expect(body["routerVariant"]).toBe("U_V23_SERVER_RELAYED_WSS");
    expect(body["strictPlaybackMode"]).toBe("risk_based");
    expect(body["registeredSpeechBuildId"]).toBe(
      "2026-05-12T05-31-48-094Z"
    );
    const wsUrl = new URL(body["wsUrl"] as string);
    expect(wsUrl.protocol).toBe("ws:");
    expect(wsUrl.host).toBe("127.0.0.1:3000");
    expect(wsUrl.pathname).toBe("/api/v3/realtime-relay");
    expect(wsUrl.searchParams.get("model")).toBe(
      "grok-voice-think-fast-1.0"
    );
    expect(wsUrl.searchParams.get("sessionId")).toBe(
      body["sessionId"] as string
    );
    expect(body["wsUrl"]).not.toContain("api.x.ai");
    expect(body["ephemeralToken"]).toBe(
      "xai-realtime-client-secret-test-value"
    );
    const turnDetection = body["turnDetection"] as Record<string, unknown>;
    expect(turnDetection["silence_duration_ms"]).toBe(350);
    const audio = body["audio"] as Record<string, unknown>;
    expect(audio["sampleRate"]).toBe(24_000);
  });

  it("serves v25 over the MENDAN Cloud Run relay without issuing an xAI ephemeral token", async () => {
    vi.stubEnv(
      "XAI_RELAY_TICKET_SECRET",
      "0123456789abcdef0123456789abcdef"
    );
    vi.stubEnv(
      "GROK_VOICE_RELAY_WS_URL",
      "wss://voice.mendan.biz/api/v3/realtime-relay"
    );
    vi.stubEnv("GROK_VOICE_RELAY_EXPECTED_AUD", "voice.mendan.biz");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(
      validRequest({
        referer: "http://127.0.0.1:3000/demo/adecco-roleplay-v25",
        body: { demoSlug: "adecco-roleplay-v25" },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body["demoSlug"]).toBe("adecco-roleplay-v25");
    expect(body["routerVariant"]).toBe("B_NARROW_FALLBACK_SEMANTIC");
    expect(body["realtimeTransport"]).toBe("mendan_cloud_run_relay_wss");
    expect(body["wsUrl"]).toBe(
      "wss://voice.mendan.biz/api/v3/realtime-relay"
    );
    expect(body["ephemeralToken"]).toBeUndefined();
    expect(body["ephemeralExpiresAt"]).toBeUndefined();
    const auth = body["realtimeAuth"] as Record<string, unknown>;
    expect(auth["mode"]).toBe("mendan_relay_subprotocol");
    expect(auth["protocol"]).toBe("mendan-relay-v1");
    expect(typeof auth["ticket"]).toBe("string");
    expect(auth["ticket"]).toMatch(/^mra1\./);
    expect(typeof auth["expiresAt"]).toBe("string");
  });

  it("fails v25 closed when the relay ticket secret is unavailable", async () => {
    vi.stubEnv(
      "GROK_VOICE_RELAY_WS_URL",
      "wss://voice.mendan.biz/api/v3/realtime-relay"
    );
    vi.stubEnv("GROK_VOICE_RELAY_EXPECTED_AUD", "voice.mendan.biz");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(
      validRequest({
        referer: "http://127.0.0.1:3000/demo/adecco-roleplay-v25",
        body: { demoSlug: "adecco-roleplay-v25" },
      })
    );

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // PR #86 Codex P1 follow-up on PR #85. The new client decides
  // buffering from `strictPlaybackMode`. Without this fix, setting the
  // legacy global kill-switch (`GROK_VOICE_STRICT_SANITIZED_PLAYBACK=
  // false`) would leave the new client in `risk_based` and continue
  // buffering ack/closing/identity turns — silently violating the
  // contract the legacy flag has historically carried. These four
  // cases pin the precedence: legacy disable always forces
  // `strictPlaybackMode="monitor_only"`, otherwise `STRICT_PLAYBACK_MODE`
  // wins (default `risk_based`).
  describe("strict playback session payload (PR #86 P1)", () => {
    function mockEphemeralToken() {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            value: "xai-realtime-client-secret-test-value",
            expires_at: 1747_000_000,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    }

    it("default (both envs unset) → strictPlaybackMode=risk_based, strictSanitizedPlayback=true", async () => {
      mockEphemeralToken();
      const { POST } = await import("../../app/api/v3/session/route");
      const response = await POST(validRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body["strictPlaybackMode"]).toBe("risk_based");
      expect(body["strictSanitizedPlayback"]).toBe(true);
    });

    it("explicit all_turns mode (strict flag still on) → strictPlaybackMode=all_turns, strictSanitizedPlayback=true", async () => {
      vi.stubEnv("GROK_VOICE_STRICT_PLAYBACK_MODE", "all_turns");
      mockEphemeralToken();
      const { POST } = await import("../../app/api/v3/session/route");
      const response = await POST(validRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body["strictPlaybackMode"]).toBe("all_turns");
      expect(body["strictSanitizedPlayback"]).toBe(true);
    });

    it("legacy strict disable wins over default mode → strictPlaybackMode=monitor_only, strictSanitizedPlayback=false", async () => {
      // Existing deploys use STRICT_SANITIZED_PLAYBACK=false as the
      // global kill-switch. The new client must observe that as
      // monitor_only, never as risk_based.
      vi.stubEnv("GROK_VOICE_STRICT_SANITIZED_PLAYBACK", "false");
      mockEphemeralToken();
      const { POST } = await import("../../app/api/v3/session/route");
      const response = await POST(validRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body["strictPlaybackMode"]).toBe("monitor_only");
      expect(body["strictSanitizedPlayback"]).toBe(false);
    });

    it("legacy strict disable overrides explicit all_turns mode → strictPlaybackMode=monitor_only, strictSanitizedPlayback=false", async () => {
      vi.stubEnv("GROK_VOICE_STRICT_SANITIZED_PLAYBACK", "false");
      vi.stubEnv("GROK_VOICE_STRICT_PLAYBACK_MODE", "all_turns");
      mockEphemeralToken();
      const { POST } = await import("../../app/api/v3/session/route");
      const response = await POST(validRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body["strictPlaybackMode"]).toBe("monitor_only");
      expect(body["strictSanitizedPlayback"]).toBe(false);
    });
  });

  // PR B — locked-response audio prebundle session contract.
  //
  // The session route MAY surface `lockedResponseAudioBundle`. When it
  // does, the bundle MUST carry only cache-hit entries (no synth on
  // bootstrap). When disabled by env, the field is omitted entirely.
  describe("locked-response audio bundle (PR B)", () => {
    function mockEphemeralToken() {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            value: "xai-realtime-client-secret-test-value",
            expires_at: 1747_000_000,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    }

    it("omits the bundle field entirely when the env kill-switch is off", async () => {
      vi.stubEnv("GROK_VOICE_LOCKED_AUDIO_BUNDLE_ENABLED", "false");
      mockEphemeralToken();
      const { POST } = await import("../../app/api/v3/session/route");
      const response = await POST(validRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("lockedResponseAudioBundle");
    });

    it("omits the bundle field when zero canonicals are cache-hit", async () => {
      // No memory cache seed → assembler sees all misses → bundle has
      // no entries → session route omits the field per the
      // "omit when empty" contract.
      mockEphemeralToken();
      const { POST } = await import("../../app/api/v3/session/route");
      const response = await POST(validRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("lockedResponseAudioBundle");
    });

    it("surfaces a populated bundle when canonicals are cache-hit, with cache-hit entries only", async () => {
      // Seed two canonicals before invoking the route.
      const { seedGrokVoiceTtsMemoryCache } = await import(
        "../../server/grokVoice/ttsCache"
      );
      const {
        GROK_VOICE_TTS_CODEC,
        GROK_VOICE_TTS_LANGUAGE,
        GROK_VOICE_TTS_MIME_TYPE,
        GROK_VOICE_TTS_REQUEST_SHAPE_VERSION,
      } = await import("../../server/grokVoice/tts");
      const { buildGrokVoiceTtsCacheKey } = await import(
        "../../server/grokVoice/ttsCache"
      );
      // Seed canonicals that are in the assembler's
      // DEFAULT_BUNDLE_PRIORITY (lockedAudioBundle.ts). Any canonical
      // NOT on that list is trimmed by `slice(0, maxEntries)`.
      const seedTexts = [
        "じゅはっちゅうや納期調整まわりの営業事務です。",
        "つきあたり、ろっぴゃく件から、ななひゃっけん程度です。",
      ];
      for (const text of seedTexts) {
        const { cacheKey, cacheKeyHash, textHash } = buildGrokVoiceTtsCacheKey({
          text,
          voiceId: "rex",
          sampleRateHz: 24_000,
          purpose: "locked_response",
        });
        seedGrokVoiceTtsMemoryCache({
          cacheKey,
          cacheKeyHash,
          textHash,
          voiceId: "rex",
          sampleRateHz: 24_000,
          codec: GROK_VOICE_TTS_CODEC,
          language: GROK_VOICE_TTS_LANGUAGE,
          mimeType: GROK_VOICE_TTS_MIME_TYPE,
          audioBase64: Buffer.from(new Uint8Array(96)).toString("base64"),
          audioBytes: 96,
          createdAt: new Date().toISOString(),
          vendorMs: 1_500,
          xaiTtsRequestShapeVersion: GROK_VOICE_TTS_REQUEST_SHAPE_VERSION,
        });
      }
      mockEphemeralToken();
      const { POST } = await import("../../app/api/v3/session/route");
      const response = await POST(validRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      const bundle = body["lockedResponseAudioBundle"] as
        | {
            version: string;
            voiceId: string;
            sampleRateHz: number;
            codec: string;
            entries: Array<Record<string, unknown>>;
          }
        | undefined;
      expect(bundle).toBeDefined();
      expect(bundle!.version).toBe("v1");
      expect(bundle!.voiceId).toBe("rex");
      expect(bundle!.sampleRateHz).toBe(24_000);
      expect(bundle!.codec).toBe("pcm");
      expect(bundle!.entries.length).toBeGreaterThanOrEqual(2);
      for (const entry of bundle!.entries) {
        expect(entry["cacheStatus"]).toBe("hit");
        expect(typeof entry["audioBase64"]).toBe("string");
        expect(typeof entry["audioBytes"]).toBe("number");
        expect(typeof entry["spokenText"]).toBe("string");
      }
    });
  });

  it("returns cached greeting audio on memory cache hit without calling xAI TTS", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            value: "xai-realtime-client-secret-test-value",
            expires_at: 1747_000_000,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    const { loadGrokVoiceScenarioBundle } = await import(
      "../../server/grokVoice/scenarioLoader"
    );
    const {
      buildGrokVoiceTtsCacheKey,
      seedGrokVoiceTtsMemoryCache,
    } = await import("../../server/grokVoice/ttsCache");
    const bundle = await loadGrokVoiceScenarioBundle();
    const audioBase64 = Buffer.from([0, 1, 2, 3]).toString("base64");
    const key = buildGrokVoiceTtsCacheKey({
      text: bundle.firstMessage,
      voiceId: "rex",
      sampleRateHz: 24_000,
      purpose: "greeting",
    });
    seedGrokVoiceTtsMemoryCache({
      cacheKey: key.cacheKey,
      cacheKeyHash: key.cacheKeyHash,
      textHash: key.textHash,
      voiceId: "rex",
      sampleRateHz: 24_000,
      codec: "pcm",
      language: "ja",
      mimeType: "audio/pcm",
      audioBase64,
      audioBytes: 4,
      createdAt: new Date().toISOString(),
      vendorMs: 123,
      xaiTtsRequestShapeVersion: "xai-tts-rest-v2026-05-06-pcm24k-optlat1",
    });

    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const greetingAudio = body["greetingAudio"] as Record<string, unknown>;
    expect(greetingAudio["audioBase64"]).toBe(audioBase64);
    expect(greetingAudio["cacheStatus"]).toBe("hit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(String(requestInit?.body)).toContain("expires_after");
  });

  // Gate 4 — verify the staffing PLS lexicon registers every vocabulary the
  // v2.1 spec lists, including sales-side-only terms (KAM, Career Planner)
  // that don't appear in the customer-AI prompt but must be normalised if
  // the user ever brings them up.
  it("registers all v2.1 vocabulary in the staffing PLS lexicon (incl. sales-only acronyms)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const plsPath = path.resolve(
      __dirname,
      "../../../../data/pronunciation/adecco-ja-business-v1.pls"
    );
    const lexicon = await fs.readFile(plsPath, "utf8");
    for (const term of [
      "受発注",
      "納期調整",
      "在庫確認",
      "代理店",
      "工務店",
      "施工日",
      "引渡し",
      "品番",
      "型番",
      "仕様違い",
      "販売管理",
      "EDI",
      "CP",
      "Career Planner",
      "SK",
      "職場見学",
      "KAM",
      "Key Account Manager",
    ]) {
      expect(lexicon).toContain(`<grapheme>${term}</grapheme>`);
    }
  });

  it("returns 502 when the ephemeral token endpoint fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream blew up", { status: 502 })
    );
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(validRequest());
    expect(response.status).toBe(502);
  });

  it("returns 429 with Retry-After once rate-limited", async () => {
    // Each fetch call needs a fresh Response — Response bodies are streams
    // and become "unusable" after the first read.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ value: "xai-test-token", expires_at: 1 }),
          { status: 200 }
        )
      )
    );
    const { POST } = await import("../../app/api/v3/session/route");
    for (let i = 0; i < 3; i += 1) {
      const ok = await POST(validRequest());
      expect(ok.status).toBe(200);
    }
    const limited = await POST(validRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("reseed bucket: reseedFromSessionId requests use a separate, more permissive quota", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ value: "xai-test-token", expires_at: 1 }),
          { status: 200 }
        )
      )
    );
    const { POST } = await import("../../app/api/v3/session/route");
    // Burn the fresh-session quota first (3 calls per minute).
    for (let i = 0; i < 3; i += 1) {
      const ok = await POST(validRequest());
      expect(ok.status).toBe(200);
    }
    expect((await POST(validRequest())).status).toBe(429);
    // A reseed call from the same caller still succeeds because it pulls
    // from the relaxed bucket.
    const reseed = await POST(
      validRequest({
        body: { reseedFromSessionId: "gv_sess_parent" },
      })
    );
    expect(reseed.status).toBe(200);
    const reseedBody = (await reseed.json()) as Record<string, unknown>;
    expect(reseedBody["parentSessionId"]).toBe("gv_sess_parent");
  });

  it("rejects reseedFromSessionId that doesn't match the gv_sess_ format", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ value: "xai-test-token", expires_at: 1 }),
        { status: 200 }
      )
    );
    const { POST } = await import("../../app/api/v3/session/route");
    const response = await POST(
      validRequest({ body: { reseedFromSessionId: "not-a-session-id" } })
    );
    expect(response.status).toBe(400);
  });
});
