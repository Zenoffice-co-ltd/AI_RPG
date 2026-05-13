import { describe, expect, it } from "vitest";

import {
  REQUIRED_GROK_VOICE_REALTIME_MODEL,
  assertGrokRealtimeWsUrl,
  buildGrokRealtimeRelayWsUrl,
  buildGrokRealtimeWsUrl,
  buildMendanCloudRunRelayWsUrl,
} from "../../lib/roleplay/grok-voice-ws-url";

// review-v2 P0: omitting the `model=` query parameter on the xAI
// Realtime WebSocket connect falls back to the legacy
// grok-voice-fast-1.0 voice agent. The builder enforces an explicit
// model on every connect; these tests pin the contract so a future
// refactor of the URL construction cannot silently break it.

describe("buildGrokRealtimeWsUrl", () => {
  it("appends the required model query param to a bare base URL", () => {
    const wsUrl = buildGrokRealtimeWsUrl({ base: "wss://api.x.ai/v1/realtime" });
    const parsed = new URL(wsUrl);
    expect(parsed.searchParams.get("model")).toBe(
      REQUIRED_GROK_VOICE_REALTIME_MODEL
    );
  });

  it("preserves an existing matching model param without duplicating it", () => {
    const wsUrl = buildGrokRealtimeWsUrl({
      base: `wss://api.x.ai/v1/realtime?model=${REQUIRED_GROK_VOICE_REALTIME_MODEL}`,
    });
    expect(
      wsUrl.match(new RegExp(`model=`, "g"))?.length ?? 0
    ).toBe(1);
  });

  it("rejects a base that pins a different model", () => {
    expect(() =>
      buildGrokRealtimeWsUrl({
        base: "wss://api.x.ai/v1/realtime?model=grok-voice-fast-1.0",
      })
    ).toThrow(/already has a different model query/);
  });

  it("rejects non-ws(s) protocols", () => {
    expect(() =>
      buildGrokRealtimeWsUrl({ base: "https://api.x.ai/v1/realtime" })
    ).toThrow(/must use ws\/wss protocol/);
  });

  it("rejects empty model", () => {
    expect(() =>
      buildGrokRealtimeWsUrl({ base: "wss://api.x.ai/v1/realtime", model: "" })
    ).toThrow(/model query param is required/);
  });
});

describe("assertGrokRealtimeWsUrl", () => {
  it("passes on a builder output", () => {
    const wsUrl = buildGrokRealtimeWsUrl({ base: "wss://api.x.ai/v1/realtime" });
    expect(() => assertGrokRealtimeWsUrl(wsUrl)).not.toThrow();
  });
  it("fails when the model query is missing", () => {
    expect(() =>
      assertGrokRealtimeWsUrl("wss://api.x.ai/v1/realtime")
    ).toThrow(/model query must be/);
  });
  it("fails when the model query is wrong", () => {
    expect(() =>
      assertGrokRealtimeWsUrl(
        "wss://api.x.ai/v1/realtime?model=grok-voice-fast-1.0"
      )
    ).toThrow(/model query must be/);
  });
});

describe("buildGrokRealtimeRelayWsUrl", () => {
  it("builds a same-origin wss relay URL with model and sessionId", () => {
    const wsUrl = buildGrokRealtimeRelayWsUrl({
      origin: "https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app",
      sessionId: "gv_sess_test",
    });
    const parsed = new URL(wsUrl);
    expect(parsed.protocol).toBe("wss:");
    expect(parsed.host).toBe(
      "adecco-roleplay--adecco-mendan.asia-east1.hosted.app"
    );
    expect(parsed.pathname).toBe("/api/v3/realtime-relay");
    expect(parsed.searchParams.get("model")).toBe(
      REQUIRED_GROK_VOICE_REALTIME_MODEL
    );
    expect(parsed.searchParams.get("sessionId")).toBe("gv_sess_test");
  });

  it("uses ws for local http origins", () => {
    const wsUrl = buildGrokRealtimeRelayWsUrl({
      origin: "http://127.0.0.1:3000",
      sessionId: "gv_sess_test",
    });
    expect(new URL(wsUrl).protocol).toBe("ws:");
  });
});

describe("buildMendanCloudRunRelayWsUrl", () => {
  it("builds the v25 Cloud Run relay URL without query parameters", () => {
    expect(buildMendanCloudRunRelayWsUrl()).toBe(
      "wss://voice.mendan.biz/api/v3/realtime-relay"
    );
  });

  it("rejects query-bearing or wrong-path relay URLs by normalizing path-only output", () => {
    expect(
      buildMendanCloudRunRelayWsUrl({
        base: "wss://voice.mendan.biz/api/v3/realtime-relay?ticket=bad",
      })
    ).toBe("wss://voice.mendan.biz/api/v3/realtime-relay");
    expect(() =>
      buildMendanCloudRunRelayWsUrl({
        base: "wss://voice.mendan.biz/api/v3/other",
      })
    ).toThrow(/path must be/);
  });
});
