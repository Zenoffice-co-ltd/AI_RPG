import { describe, expect, it } from "vitest";
import {
  getGrokVoiceRealtimeTransportForDemoSlug,
  getGrokVoiceRouterVariantForDemoSlug,
} from "../../lib/roleplay/grok-voice-router-variant";

describe("Grok Voice router variant and transport mapping", () => {
  it("keeps v25 on stable B conversation behavior while moving transport to Cloud Run relay", () => {
    expect(getGrokVoiceRouterVariantForDemoSlug("adecco-roleplay-v25")).toBe(
      "B_NARROW_FALLBACK_SEMANTIC"
    );
    expect(getGrokVoiceRealtimeTransportForDemoSlug("adecco-roleplay-v25")).toBe(
      "mendan_cloud_run_relay_wss"
    );
  });

  it("keeps v4 and v5 on direct xAI WebSocket transport", () => {
    expect(getGrokVoiceRealtimeTransportForDemoSlug("adecco-roleplay-v4")).toBe(
      "xai_direct_wss"
    );
    expect(getGrokVoiceRealtimeTransportForDemoSlug("adecco-roleplay-v5")).toBe(
      "xai_direct_wss"
    );
  });
});
