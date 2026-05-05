import { describe, expect, it, vi } from "vitest";
import {
  GrokVoiceAudioQueue,
  decodeBase64Pcm16,
  encodeFloat32ToPcm16Base64,
} from "../../lib/roleplay/grok-voice-audio-queue";

type FakeAudioBuffer = {
  duration: number;
  sampleRate: number;
  length: number;
  getChannelData: (i: number) => Float32Array;
};

function buildFakeContext(opts?: { failCreateBuffer?: boolean }) {
  const startCalls: number[] = [];
  const buffers: FakeAudioBuffer[] = [];
  const sources: Array<{
    buffer: FakeAudioBuffer | null;
    connect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }> = [];
  const gain = {
    gain: { value: 1 },
    connect: vi.fn(),
  };

  const context = {
    state: "running" as AudioContextState,
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => {
      if (opts?.failCreateBuffer) {
        throw new Error("createBuffer fails");
      }
      const data = new Float32Array(length);
      const buf: FakeAudioBuffer = {
        duration: length / sampleRate,
        sampleRate,
        length,
        getChannelData: () => data,
      };
      buffers.push(buf);
      return buf;
    }),
    createBufferSource: vi.fn(() => {
      const s = {
        buffer: null as FakeAudioBuffer | null,
        connect: vi.fn(),
        start: vi.fn((at: number) => {
          startCalls.push(at);
        }),
        onended: null as (() => void) | null,
      };
      sources.push(s);
      return s;
    }),
    createGain: vi.fn(() => gain),
    decodeAudioData: vi.fn(),
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };

  return { context, gain, sources, buffers, startCalls };
}

describe("GrokVoiceAudioQueue", () => {
  it("schedules sequential PCM16 chunks back-to-back at the configured sample rate", () => {
    const fake = buildFakeContext();
    const queue = new GrokVoiceAudioQueue({
      sampleRate: 24_000,
      // @ts-expect-error — test double
      createAudioContext: () => fake.context,
    });

    // 100ms of PCM16 mono at 24 kHz = 2400 samples = 4800 bytes
    const samples = new Float32Array(2400);
    const base64 = encodeFloat32ToPcm16Base64(samples);

    queue.enqueueBase64(base64);
    queue.enqueueBase64(base64);

    expect(fake.startCalls).toHaveLength(2);
    expect(fake.startCalls[0]).toBe(0);
    // Second chunk starts after the first one's duration (~0.1s).
    expect(fake.startCalls[1]).toBeCloseTo(0.1, 5);
  });

  it("calls onPlaybackError and skips the chunk when AudioContext throws", () => {
    const fake = buildFakeContext({ failCreateBuffer: true });
    const onError = vi.fn();
    const queue = new GrokVoiceAudioQueue({
      sampleRate: 24_000,
      // @ts-expect-error — test double
      createAudioContext: () => fake.context,
      onPlaybackError: onError,
    });

    const samples = new Float32Array(240);
    queue.enqueueBase64(encodeFloat32ToPcm16Base64(samples));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(fake.sources).toHaveLength(0);
  });

  it("setMuted gates output via the gain node", () => {
    const fake = buildFakeContext();
    const queue = new GrokVoiceAudioQueue({
      sampleRate: 24_000,
      // @ts-expect-error — test double
      createAudioContext: () => fake.context,
    });
    // First call ensures the context is created.
    queue.enqueueBase64(encodeFloat32ToPcm16Base64(new Float32Array(240)));
    queue.setMuted(true);
    expect(fake.gain.gain.value).toBe(0);
    queue.setMuted(false);
    expect(fake.gain.gain.value).toBeGreaterThan(0);
  });

  it("ignores empty payloads", () => {
    const fake = buildFakeContext();
    const queue = new GrokVoiceAudioQueue({
      sampleRate: 24_000,
      // @ts-expect-error — test double
      createAudioContext: () => fake.context,
    });
    queue.enqueueBase64("");
    expect(fake.sources).toHaveLength(0);
  });

  it("decodeBase64Pcm16 round-trips through encodeFloat32ToPcm16Base64", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
    const base64 = encodeFloat32ToPcm16Base64(samples);
    const decoded = decodeBase64Pcm16(base64);
    expect(decoded.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      expect(decoded[i]).toBeCloseTo(samples[i] ?? 0, 3);
    }
  });

  it("flush closes the current context and clears playback state", async () => {
    const fake = buildFakeContext();
    const queue = new GrokVoiceAudioQueue({
      sampleRate: 24_000,
      // @ts-expect-error — test double
      createAudioContext: () => fake.context,
    });
    queue.enqueueBase64(encodeFloat32ToPcm16Base64(new Float32Array(240)));
    expect(queue.isPlaying()).toBe(true);
    await queue.flush();
    expect(fake.context.close).toHaveBeenCalledTimes(1);
    expect(queue.isPlaying()).toBe(false);
  });
});
