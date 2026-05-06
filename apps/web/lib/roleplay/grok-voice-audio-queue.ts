"use client";

// Plays back a sequential stream of base64-encoded PCM16 little-endian audio
// chunks (the format the xAI Voice Agent emits via `response.output_audio.delta`).
// We synthesise an AudioBuffer per chunk from the raw PCM samples — we cannot
// rely on `decodeAudioData`, which only accepts container-wrapped formats
// (WAV / MP3 / Opus / etc).

type AudioContextLike = {
  createBufferSource: () => AudioBufferSourceNode;
  createGain: () => GainNode;
  createBuffer: (
    channels: number,
    length: number,
    sampleRate: number
  ) => AudioBuffer;
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

export type GrokVoiceAudioQueueOptions = {
  sampleRate?: number; // Hz, default 24000
  createAudioContext?: CreateAudioContext;
  onPlaybackError?: (error: unknown) => void;
};

export class GrokVoiceAudioQueue {
  private context: AudioContextLike | null = null;
  private gain: GainNode | null = null;
  private nextStartAt = 0;
  private playing = 0;
  private readonly create: CreateAudioContext;
  private readonly onError: (error: unknown) => void;
  private readonly sampleRate: number;
  private outputVolume = 1;
  private muted = false;

  constructor(options: GrokVoiceAudioQueueOptions = {}) {
    this.create = options.createAudioContext ?? defaultCreate;
    this.onError = options.onPlaybackError ?? (() => undefined);
    this.sampleRate = options.sampleRate ?? 24_000;
  }

  private ensureContext() {
    if (!this.context) {
      this.context = this.create();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.muted ? 0 : this.outputVolume;
      this.gain.connect(this.context.destination);
    }
    return { context: this.context, gain: this.gain! };
  }

  setVolume(volume: number) {
    this.outputVolume = Math.max(0, Math.min(1, volume));
    if (this.gain && !this.muted) {
      this.gain.gain.value = this.outputVolume;
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.gain) {
      this.gain.gain.value = muted ? 0 : this.outputVolume;
    }
  }

  getOutputVolume() {
    return this.playing > 0 && !this.muted ? this.outputVolume : 0;
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

  enqueueBase64(base64: string): void {
    try {
      const samples = decodeBase64Pcm16(base64);
      if (samples.length === 0) {
        return;
      }
      this.scheduleSamples(samples);
    } catch (error) {
      this.onError(error);
    }
  }

  async enqueueBase64AndWait(base64: string): Promise<void> {
    try {
      const samples = decodeBase64Pcm16(base64);
      if (samples.length === 0) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.scheduleSamples(samples, resolve);
      });
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  private scheduleSamples(samples: Float32Array, onEnded?: () => void) {
    const { context, gain } = this.ensureContext();
    const buffer = context.createBuffer(1, samples.length, this.sampleRate);
    // copyToChannel may not exist on the test double; fall back to channelData write.
    const channel = buffer.getChannelData(0);
    channel.set(samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    const startAt = Math.max(this.nextStartAt, context.currentTime);
    source.start(startAt);
    this.nextStartAt = startAt + buffer.duration;
    this.playing += 1;
    source.onended = () => {
      this.playing = Math.max(0, this.playing - 1);
      onEnded?.();
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

  async flush() {
    await this.stop();
  }
}

export function decodeBase64Pcm16(base64: string): Float32Array {
  const bytes = base64ToBytes(base64);
  // PCM16 little-endian → Int16Array. Length must be even; trim a stray byte.
  const evenLength = bytes.byteLength - (bytes.byteLength % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, evenLength);
  const samples = new Float32Array(evenLength / 2);
  for (let i = 0; i < samples.length; i += 1) {
    const int16 = view.getInt16(i * 2, true);
    samples[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
  }
  return samples;
}

export function encodeFloat32ToPcm16Base64(samples: Float32Array): string {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(i * 2, int16, true);
  }
  return bytesToBase64(new Uint8Array(buffer));
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const buffer = Buffer.from(base64, "base64");
  return new Uint8Array(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i] ?? 0);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}
