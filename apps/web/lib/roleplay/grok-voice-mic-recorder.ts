"use client";

// Captures microphone audio, downsamples it to the configured sample rate
// (24 kHz by default to match the xAI Voice Agent), and emits base64-encoded
// PCM16 chunks roughly every 100 ms via the supplied callback. Also runs a
// lightweight RMS-based VAD so we can publish mic state transitions
// (idle / listening / speaking) without doing turn detection — that's done
// server-side by the xAI realtime API in `server_vad` mode.

import {
  encodeFloat32ToPcm16Base64,
} from "./grok-voice-audio-queue";
import type { GrokVoiceMicState } from "./grok-voice-types";

export type GrokVoiceMicRecorderOptions = {
  onChunk: (base64: string) => void;
  onError?: (error: Error) => void;
  onStateChange?: (state: GrokVoiceMicState) => void;
  targetSampleRate?: number; // default 24000
  chunkMs?: number; // default 100ms
  rmsThreshold?: number; // default 0.018
};

const DEFAULT_TARGET_SAMPLE_RATE = 24_000;
const DEFAULT_CHUNK_MS = 100;
const DEFAULT_RMS_THRESHOLD = 0.018;

export class GrokVoiceMicRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private buffer: Float32Array = new Float32Array(0);
  private state: GrokVoiceMicState = "idle";
  private paused = true;
  private currentRms = 0;

  constructor(private readonly opts: GrokVoiceMicRecorderOptions) {}

  getState(): GrokVoiceMicState {
    return this.paused ? "paused" : this.state;
  }

  getInputVolume(): number {
    if (this.paused) return 0;
    return Math.min(1, this.currentRms * 6);
  }

  async start(): Promise<void> {
    if (this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      this.opts.onError?.(toError(error));
      throw error;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      throw new Error("AudioContext not supported in this browser.");
    }
    this.context = new Ctor();
    this.source = this.context.createMediaStreamSource(this.stream);
    // ScriptProcessorNode is deprecated but still the most universally
    // available primitive in browsers without AudioWorklet bundling. The
    // chunk size is a compromise between latency and RAF jitter.
    const bufferSize = 2048;
    this.processor = this.context.createScriptProcessor(bufferSize, 1, 1);
    this.processor.onaudioprocess = (event) => this.handleAudioProcess(event);
    this.source.connect(this.processor);
    // Connect to destination via a zero-gain GainNode so the processor still
    // runs but no audio actually plays back to the speakers.
    const sink = this.context.createGain();
    sink.gain.value = 0;
    this.processor.connect(sink);
    sink.connect(this.context.destination);
    this.paused = true;
    this.state = "idle";
    this.opts.onStateChange?.(this.getState());
  }

  setEnabled(enabled: boolean) {
    if (!this.stream) return;
    if (enabled) {
      this.paused = false;
      this.state = "listening";
      this.opts.onStateChange?.(this.getState());
    } else {
      this.paused = true;
      this.buffer = new Float32Array(0);
      this.opts.onStateChange?.(this.getState());
    }
  }

  async stop(): Promise<void> {
    this.paused = true;
    try {
      this.processor?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.source?.disconnect();
    } catch {
      // ignore
    }
    try {
      await this.context?.close();
    } catch {
      // ignore
    }
    this.processor = null;
    this.context = null;
    this.source = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.state = "idle";
    this.opts.onStateChange?.(this.getState());
  }

  private handleAudioProcess(event: AudioProcessingEvent) {
    const input = event.inputBuffer.getChannelData(0);
    let sumSquares = 0;
    for (let i = 0; i < input.length; i += 1) {
      const v = input[i] ?? 0;
      sumSquares += v * v;
    }
    this.currentRms = Math.sqrt(sumSquares / input.length);

    if (this.paused) return;

    const threshold = this.opts.rmsThreshold ?? DEFAULT_RMS_THRESHOLD;
    const nextState: GrokVoiceMicState =
      this.currentRms >= threshold ? "speaking" : "listening";
    if (nextState !== this.state) {
      this.state = nextState;
      this.opts.onStateChange?.(this.getState());
    }

    const ctx = this.context;
    if (!ctx) return;
    const targetRate = this.opts.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE;
    const downsampled = downsampleBuffer(input, ctx.sampleRate, targetRate);

    // Append into a rolling buffer, flushing every `chunkMs`.
    const merged = new Float32Array(this.buffer.length + downsampled.length);
    merged.set(this.buffer, 0);
    merged.set(downsampled, this.buffer.length);
    this.buffer = merged;

    const chunkMs = this.opts.chunkMs ?? DEFAULT_CHUNK_MS;
    const samplesPerChunk = Math.round((targetRate * chunkMs) / 1000);
    while (this.buffer.length >= samplesPerChunk) {
      const chunk = this.buffer.slice(0, samplesPerChunk);
      this.buffer = this.buffer.slice(samplesPerChunk);
      try {
        this.opts.onChunk(encodeFloat32ToPcm16Base64(chunk));
      } catch (error) {
        this.opts.onError?.(toError(error));
      }
    }
  }
}

export function downsampleBuffer(
  input: Float32Array,
  sourceRate: number,
  targetRate: number
): Float32Array {
  if (sourceRate === targetRate) return input;
  if (targetRate > sourceRate) return input;
  const ratio = sourceRate / targetRate;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetInput = 0;
  while (offsetResult < newLength) {
    const nextOffset = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetInput; i < nextOffset && i < input.length; i += 1) {
      accum += input[i] ?? 0;
      count += 1;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetInput = nextOffset;
  }
  return result;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
