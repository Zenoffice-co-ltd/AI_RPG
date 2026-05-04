import { describe, expect, it, vi } from "vitest";
import { HaikuFishAudioQueue } from "../../lib/roleplay/haiku-fish-audio-queue";

type FakeBuffer = { duration: number };

function buildFakeContext(opts?: { decodeFails?: boolean }) {
  const startCalls: number[] = [];
  const fakeBuffer: FakeBuffer = { duration: 0.5 };
  const sourceFactory = () => ({
    buffer: null as FakeBuffer | null,
    connect: vi.fn(),
    start: vi.fn((at: number) => {
      startCalls.push(at);
    }),
    onended: null as (() => void) | null,
  });

  const sources: ReturnType<typeof sourceFactory>[] = [];
  const gain = {
    gain: { value: 1 },
    connect: vi.fn(),
  };

  const context = {
    state: "running" as AudioContextState,
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    createBufferSource: vi.fn(() => {
      const s = sourceFactory();
      sources.push(s);
      return s;
    }),
    createGain: vi.fn(() => gain),
    decodeAudioData: vi.fn(async () => {
      if (opts?.decodeFails) throw new Error("decode failed");
      return fakeBuffer;
    }),
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };

  return { context, gain, sources, startCalls };
}

describe("HaikuFishAudioQueue", () => {
  it("schedules sequential audio chunks back-to-back", async () => {
    const fake = buildFakeContext();
    const queue = new HaikuFishAudioQueue({
      // @ts-expect-error — constructing a structurally compatible test double
      createAudioContext: () => fake.context,
    });

    const data = new ArrayBuffer(8);
    await queue.enqueue(data);
    await queue.enqueue(data);
    await queue.enqueue(data);

    expect(fake.startCalls).toEqual([0, 0.5, 1]);
    expect(fake.sources).toHaveLength(3);
    for (const s of fake.sources) {
      expect(s.connect).toHaveBeenCalled();
    }
  });

  it("calls onPlaybackError and skips the chunk when decodeAudioData fails", async () => {
    const fake = buildFakeContext({ decodeFails: true });
    const onError = vi.fn();
    const queue = new HaikuFishAudioQueue({
      // @ts-expect-error — test double
      createAudioContext: () => fake.context,
      onPlaybackError: onError,
    });

    await queue.enqueue(new ArrayBuffer(8));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(fake.sources).toHaveLength(0); // no source was ever scheduled
  });

  it("enqueueBase64 decodes base64 then enqueues", async () => {
    const fake = buildFakeContext();
    const queue = new HaikuFishAudioQueue({
      // @ts-expect-error — test double
      createAudioContext: () => fake.context,
    });

    await queue.enqueueBase64(Buffer.from("hello").toString("base64"));
    expect(fake.startCalls).toEqual([0]);
  });
});
