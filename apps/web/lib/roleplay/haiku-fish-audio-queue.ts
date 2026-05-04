"use client";

type AudioContextLike = {
  createBufferSource: () => AudioBufferSourceNode;
  createGain: () => GainNode;
  decodeAudioData: (data: ArrayBuffer) => Promise<AudioBuffer>;
  destination: AudioDestinationNode;
  currentTime: number;
  state: AudioContextState;
  resume: () => Promise<void>;
  close: () => Promise<void>;
};

type CreateAudioContext = () => AudioContextLike;

const defaultCreate: CreateAudioContext = () => {
  const Ctor =
    typeof window !== "undefined"
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;
  if (!Ctor) {
    throw new Error("AudioContext not supported in this environment.");
  }
  return new Ctor() as unknown as AudioContextLike;
};

export type HaikuFishAudioQueueOptions = {
  createAudioContext?: CreateAudioContext;
  onPlaybackError?: (error: unknown) => void;
};

export class HaikuFishAudioQueue {
  private context: AudioContextLike | null = null;
  private gain: GainNode | null = null;
  private nextStartAt = 0;
  private playing = 0;
  private readonly create: CreateAudioContext;
  private readonly onError: (error: unknown) => void;
  private outputVolume = 1;

  constructor(options: HaikuFishAudioQueueOptions = {}) {
    this.create = options.createAudioContext ?? defaultCreate;
    this.onError = options.onPlaybackError ?? (() => undefined);
  }

  private ensureContext() {
    if (!this.context) {
      this.context = this.create();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.outputVolume;
      this.gain.connect(this.context.destination);
    }
    return { context: this.context, gain: this.gain! };
  }

  setVolume(volume: number) {
    this.outputVolume = Math.max(0, Math.min(1, volume));
    if (this.gain) {
      this.gain.gain.value = this.outputVolume;
    }
  }

  getOutputVolume() {
    return this.playing > 0 ? this.outputVolume : 0;
  }

  isPlaying() {
    return this.playing > 0;
  }

  async resume() {
    const { context } = this.ensureContext();
    if (context.state === "suspended") {
      await context.resume();
    }
  }

  async enqueueBase64(base64: string) {
    try {
      const buffer = decodeBase64ToBuffer(base64);
      await this.enqueue(buffer);
    } catch (error) {
      this.onError(error);
    }
  }

  async enqueue(audioData: ArrayBuffer) {
    const { context, gain } = this.ensureContext();
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(audioData.slice(0));
    } catch (error) {
      this.onError(error);
      return;
    }

    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(gain);

    const startAt = Math.max(this.nextStartAt, context.currentTime);
    source.start(startAt);
    this.nextStartAt = startAt + decoded.duration;
    this.playing += 1;
    source.onended = () => {
      this.playing = Math.max(0, this.playing - 1);
    };
  }

  async stop() {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // ignore
      }
      this.context = null;
      this.gain = null;
    }
    this.nextStartAt = 0;
    this.playing = 0;
  }
}

function decodeBase64ToBuffer(base64: string): ArrayBuffer {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  // Node fallback (used by tests).
  const buffer = Buffer.from(base64, "base64");
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
}
