import { describe, expect, it, vi } from "vitest";

import { GrokVoiceAudioQueue } from "../../lib/roleplay/grok-voice-audio-queue";

// review-v2 P0: deterministic-mode lock turns call
// `clearAllScheduledAudioForLock()` to stop every scheduled chunk
// without tearing down the AudioContext. The old `stop()` closed the
// context and made subsequent artifact playback impossible. This test
// pins the new method's contract.

type FakeSource = {
  buffer: AudioBuffer | null;
  connected: boolean;
  started: boolean;
  stopped: boolean;
  onended: (() => void) | null;
  connect: (node: unknown) => void;
  start: (when: number) => void;
  stop: (when: number) => void;
};

function makeFakeContext() {
  const sources: FakeSource[] = [];
  const fake = {
    currentTime: 0,
    state: "running" as AudioContextState,
    destination: { node: "destination" } as unknown as AudioDestinationNode,
    createGain: () =>
      ({
        gain: { value: 1 },
        connect: () => undefined,
      }) as unknown as GainNode,
    createBuffer: (channels: number, length: number) => {
      const data = new Float32Array(length);
      return {
        duration: length / 24000,
        getChannelData: () => data,
      } as unknown as AudioBuffer;
    },
    createBufferSource: () => {
      const source: FakeSource = {
        buffer: null,
        connected: false,
        started: false,
        stopped: false,
        onended: null,
        connect: () => {
          source.connected = true;
        },
        start: () => {
          source.started = true;
        },
        stop: () => {
          source.stopped = true;
        },
      };
      sources.push(source);
      return source as unknown as AudioBufferSourceNode;
    },
    resume: async () => undefined,
    close: vi.fn(async () => undefined),
  };
  return { fake, sources };
}

function encode(samples: Int16Array): string {
  const buf = Buffer.from(samples.buffer);
  return buf.toString("base64");
}

describe("clearAllScheduledAudioForLock", () => {
  it("stops every scheduled source without closing the context", () => {
    const { fake, sources } = makeFakeContext();
    const queue = new GrokVoiceAudioQueue({
      createAudioContext: () => fake as never,
    });
    queue.enqueueBase64(encode(new Int16Array(2400)));
    queue.enqueueBase64(encode(new Int16Array(2400)));
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.started)).toBe(true);

    queue.clearAllScheduledAudioForLock();
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(fake.close).not.toHaveBeenCalled();
    expect(queue.isPlaying()).toBe(false);
  });

  it("allows subsequent enqueue after clearing (context survives)", () => {
    const { fake, sources } = makeFakeContext();
    const queue = new GrokVoiceAudioQueue({
      createAudioContext: () => fake as never,
    });
    queue.enqueueBase64(encode(new Int16Array(2400)));
    queue.clearAllScheduledAudioForLock();
    queue.enqueueBase64(encode(new Int16Array(2400)));
    expect(sources).toHaveLength(2);
    // Second source should have been scheduled after clear, with the
    // currentTime baseline (no leftover nextStartAt from the cleared
    // first source's duration).
    expect(sources[1]?.started).toBe(true);
    expect(fake.close).not.toHaveBeenCalled();
  });
});
