import { describe, expect, it } from "vitest";
import { estimatePcmDurationMs, nowMs, wrapPcmS16LeAsWav } from "./audio";

describe("audio utilities", () => {
  describe("wrapPcmS16LeAsWav", () => {
    it("emits a valid 44-byte WAV header for s16le mono 24kHz", () => {
      const pcm = Buffer.alloc(48000); // 1s of 24kHz mono s16le
      const wav = wrapPcmS16LeAsWav({ pcm, sampleRateHz: 24000 });

      expect(wav.length).toBe(44 + pcm.length);
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
      expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
      expect(wav.readUInt32LE(16)).toBe(16); // fmt chunk size
      expect(wav.readUInt16LE(20)).toBe(1); // PCM
      expect(wav.readUInt16LE(22)).toBe(1); // channels
      expect(wav.readUInt32LE(24)).toBe(24000); // sampleRate
      expect(wav.readUInt32LE(28)).toBe(24000 * 2); // byte rate
      expect(wav.readUInt16LE(32)).toBe(2); // block align
      expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
      expect(wav.toString("ascii", 36, 40)).toBe("data");
      expect(wav.readUInt32LE(40)).toBe(pcm.length);
    });

    it("supports stereo with adjusted byteRate and blockAlign", () => {
      const pcm = Buffer.alloc(100);
      const wav = wrapPcmS16LeAsWav({ pcm, sampleRateHz: 48000, channels: 2 });

      expect(wav.readUInt16LE(22)).toBe(2);
      expect(wav.readUInt32LE(28)).toBe(48000 * 2 * 2);
      expect(wav.readUInt16LE(32)).toBe(4);
    });

    it("handles empty PCM without throwing", () => {
      const wav = wrapPcmS16LeAsWav({ pcm: Buffer.alloc(0), sampleRateHz: 24000 });
      expect(wav.length).toBe(44);
      expect(wav.readUInt32LE(40)).toBe(0);
    });
  });

  describe("estimatePcmDurationMs", () => {
    it("computes duration from bytes/sampleRate/channels", () => {
      // 24000 samples/s × 1ch × 2 bytes = 48000 B/s → 1000ms for 48000 bytes
      expect(
        estimatePcmDurationMs({ bytes: 48000, sampleRateHz: 24000 })
      ).toBe(1000);
    });

    it("scales with channels and bytesPerSample", () => {
      // 16000 × 2ch × 2bps = 64000 B/s; 32000 bytes = 500 ms
      expect(
        estimatePcmDurationMs({
          bytes: 32000,
          sampleRateHz: 16000,
          channels: 2,
        })
      ).toBe(500);
    });

    it("returns 0 for empty or zero-rate inputs without throwing", () => {
      expect(estimatePcmDurationMs({ bytes: 0, sampleRateHz: 24000 })).toBe(0);
      expect(estimatePcmDurationMs({ bytes: 100, sampleRateHz: 0 })).toBe(0);
    });
  });

  describe("nowMs", () => {
    it("returns a monotonic-ish epoch number", () => {
      const t = nowMs();
      expect(typeof t).toBe("number");
      expect(t).toBeGreaterThan(0);
    });
  });
});
