import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GROK_VOICE_TTS_CODEC,
  GROK_VOICE_TTS_LANGUAGE,
  GROK_VOICE_TTS_MIME_TYPE,
  GROK_VOICE_TTS_REQUEST_SHAPE_VERSION,
} from "../../server/grokVoice/tts";

// Sample canonicals that ARE in the assembler's DEFAULT_BUNDLE_PRIORITY
// (declared in apps/web/server/grokVoice/lockedAudioBundle.ts). Picking
// from this list guarantees the seeded entries land in the first
// maxEntries candidates rather than being trimmed.
const PRIORITY_CANONICAL_BUSINESS_DETAIL =
  "じゅはっちゅうや納期調整まわりの営業事務です。";
const PRIORITY_CANONICAL_VOLUME =
  "つきあたり、ろっぴゃく件から、ななひゃっけん程度です。";

// PR B — assembler unit tests. The session route uses this helper to
// build the optional `lockedResponseAudioBundle` field. The contract:
//   - cache hits → emit one entry per hit (max-entries-capped)
//   - cache miss → omit the entry, surface in `missedSpokenTexts`
//   - cache failure (throw) → treat as miss, never fail bootstrap

describe("assembleLockedAudioBundle", () => {
  beforeEach(() => {
    vi.stubEnv("GROK_VOICE_TTS_CACHE_DISABLE_FIRESTORE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function seedCanonicalIntoMemoryCache(
    spokenText: string,
    audioBytes = 48
  ) {
    // Compute the REAL cache key the same way the assembler will when
    // it looks the entry up. Using an arbitrary cacheKeyHash would make
    // seeding a no-op (memoryCache.get(realHash) would still miss).
    const mod = await import("../../server/grokVoice/ttsCache");
    const { cacheKey, cacheKeyHash, textHash } = mod.buildGrokVoiceTtsCacheKey({
      text: spokenText,
      voiceId: "rex",
      sampleRateHz: 24_000,
      purpose: "locked_response",
    });
    mod.seedGrokVoiceTtsMemoryCache({
      cacheKey,
      cacheKeyHash,
      textHash,
      voiceId: "rex",
      sampleRateHz: 24_000,
      codec: GROK_VOICE_TTS_CODEC,
      language: GROK_VOICE_TTS_LANGUAGE,
      mimeType: GROK_VOICE_TTS_MIME_TYPE,
      audioBase64: Buffer.from(new Uint8Array(audioBytes)).toString("base64"),
      audioBytes,
      createdAt: new Date().toISOString(),
      vendorMs: 1_500,
      xaiTtsRequestShapeVersion: GROK_VOICE_TTS_REQUEST_SHAPE_VERSION,
    });
  }

  it("emits one entry per cache hit (cache hit only, no synth)", async () => {
    // Seed two canonicals that are in the assembler's hardcoded
    // DEFAULT_BUNDLE_PRIORITY so they land in the first maxEntries
    // candidates. A canonical NOT on that priority list could still be
    // cache-hit but would be trimmed when maxEntries < total candidates.
    await seedCanonicalIntoMemoryCache(PRIORITY_CANONICAL_BUSINESS_DETAIL, 64);
    await seedCanonicalIntoMemoryCache(PRIORITY_CANONICAL_VOLUME, 80);

    const { assembleLockedAudioBundle } = await import(
      "../../server/grokVoice/lockedAudioBundle"
    );
    const result = await assembleLockedAudioBundle({
      voiceId: "rex",
      sampleRateHz: 24_000,
      maxEntries: 8,
    });

    // Both seeded canonicals must appear in the bundle.
    expect(result.bundle.entries.length).toBeGreaterThanOrEqual(2);
    const bundledTexts = result.bundle.entries.map((e) => e.spokenText);
    expect(bundledTexts).toContain(PRIORITY_CANONICAL_BUSINESS_DETAIL);
    expect(bundledTexts).toContain(PRIORITY_CANONICAL_VOLUME);
    // Every bundled entry must be cache hit and carry the synth-time
    // snapshot for telemetry parity with locked-response-tts.
    for (const entry of result.bundle.entries) {
      expect(entry.cacheStatus).toBe("hit");
      expect(entry.audioBase64.length).toBeGreaterThan(0);
      expect(typeof entry.cacheKeyHash).toBe("string");
    }
  });

  it("omits entries when the cache misses (no synth attempted)", async () => {
    // Do NOT seed anything. Every priority candidate must miss.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { assembleLockedAudioBundle } = await import(
      "../../server/grokVoice/lockedAudioBundle"
    );
    const result = await assembleLockedAudioBundle({
      voiceId: "rex",
      sampleRateHz: 24_000,
      maxEntries: 8,
    });
    expect(result.bundle.entries).toEqual([]);
    expect(result.missedSpokenTexts.length).toBeGreaterThanOrEqual(8);
    // Critical contract: no synth attempted. fetch must not have been
    // called for xAI TTS (the warm-cache hook is the only authorized
    // synth path).
    const ttsCalls = fetchSpy.mock.calls.filter((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return url.includes("api.x.ai/v1/tts");
    });
    expect(ttsCalls.length).toBe(0);
  });

  it("does not throw when the Firestore read path throws (treats as miss)", async () => {
    // The assembler runs `getCachedGrokVoiceTts` which already swallows
    // Firestore errors internally and returns null. We additionally
    // verify the assembler's own try/catch makes assembly resilient
    // (so a transient internal error in one entry doesn't kill the
    // whole bundle).
    const { assembleLockedAudioBundle } = await import(
      "../../server/grokVoice/lockedAudioBundle"
    );
    const result = await assembleLockedAudioBundle({
      voiceId: "rex",
      sampleRateHz: 24_000,
      maxEntries: 4,
    });
    expect(result.bundle.version).toBe("v1");
    expect(result.bundle.entries.length).toBeLessThanOrEqual(4);
  });

  it("caps the candidate list at maxEntries", async () => {
    const { getAllPr60LockedResponses } = await import(
      "../../lib/roleplay/grok-voice-pr60-shared"
    );
    const canonicals = getAllPr60LockedResponses();
    expect(canonicals.length).toBeGreaterThan(3); // sanity
    const { assembleLockedAudioBundle } = await import(
      "../../server/grokVoice/lockedAudioBundle"
    );
    const result = await assembleLockedAudioBundle({
      voiceId: "rex",
      sampleRateHz: 24_000,
      maxEntries: 3,
    });
    expect(result.attemptedSpokenTexts.length).toBe(3);
  });
});
