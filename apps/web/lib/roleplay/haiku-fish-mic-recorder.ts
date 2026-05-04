"use client";

// Captures continuous microphone audio and emits a Blob each time the speaker
// finishes an utterance, detected via simple RMS-based silence threshold (VAD).
// While `paused`, audio still flows through the analyser (so the orb input
// volume animates) but no MediaRecorder data is collected and the VAD state
// machine is suspended.

export type HaikuFishMicRecorderOptions = {
  onUtterance: (audio: { blob: Blob; mimeType: string }) => void;
  onError?: (error: Error) => void;
  onStateChange?: (state: HaikuFishMicState) => void;
  rmsThreshold?: number; // 0..1, default 0.018
  silenceMs?: number; // ms of trailing silence to finalise an utterance
  minSpeechMs?: number; // require at least this many ms of voice before emitting
  maxUtteranceMs?: number; // hard cap to avoid runaway buffers
};

export type HaikuFishMicState = "idle" | "listening" | "speaking" | "paused";

const DEFAULT_RMS_THRESHOLD = 0.018;
const DEFAULT_SILENCE_MS = 700;
const DEFAULT_MIN_SPEECH_MS = 250;
const DEFAULT_MAX_UTTERANCE_MS = 15_000;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

export class HaikuFishMicRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private mimeType = "";
  private rafId: number | null = null;
  private state: HaikuFishMicState = "idle";
  private speakingStartedAt = 0;
  private lastVoiceAt = 0;
  private utteranceTimeoutId: number | null = null;
  private currentRms = 0;
  private paused = true;

  constructor(private readonly opts: HaikuFishMicRecorderOptions) {}

  getState(): HaikuFishMicState {
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
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
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
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    this.mimeType = pickMimeType();
    this.paused = true;
    this.state = "idle";
    this.opts.onStateChange?.(this.getState());
    this.tickLoop();
  }

  setEnabled(enabled: boolean) {
    if (!this.stream) return;
    if (enabled) {
      this.paused = false;
      this.state = "listening";
      this.opts.onStateChange?.(this.getState());
    } else {
      this.paused = true;
      this.cancelInFlight();
      this.opts.onStateChange?.(this.getState());
    }
  }

  async stop(): Promise<void> {
    this.paused = true;
    this.cancelInFlight();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
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
    this.context = null;
    this.analyser = null;
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

  private cancelInFlight() {
    if (this.utteranceTimeoutId !== null) {
      window.clearTimeout(this.utteranceTimeoutId);
      this.utteranceTimeoutId = null;
    }
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // ignore
      }
    }
    this.recorder = null;
    this.chunks = [];
    this.speakingStartedAt = 0;
    this.lastVoiceAt = 0;
    if (!this.paused) {
      this.state = "listening";
    }
  }

  private tickLoop = () => {
    if (!this.analyser) return;
    const buffer = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buffer);
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const v = buffer[i] ?? 0;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    this.currentRms = rms;

    if (!this.paused) {
      const threshold = this.opts.rmsThreshold ?? DEFAULT_RMS_THRESHOLD;
      const silenceMs = this.opts.silenceMs ?? DEFAULT_SILENCE_MS;
      const minSpeechMs = this.opts.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
      const maxUtteranceMs = this.opts.maxUtteranceMs ?? DEFAULT_MAX_UTTERANCE_MS;
      const now = performance.now();

      if (rms >= threshold) {
        this.lastVoiceAt = now;
        if (!this.recorder || this.recorder.state === "inactive") {
          this.startRecorder(now, maxUtteranceMs);
        } else if (this.state !== "speaking") {
          this.state = "speaking";
          this.opts.onStateChange?.(this.getState());
        }
      } else if (this.recorder && this.recorder.state === "recording") {
        const speakingFor = now - this.speakingStartedAt;
        const silentFor = now - this.lastVoiceAt;
        if (silentFor >= silenceMs && speakingFor >= minSpeechMs) {
          this.finaliseRecorder();
        }
      }
    }

    this.rafId = requestAnimationFrame(this.tickLoop);
  };

  private startRecorder(now: number, maxUtteranceMs: number) {
    if (!this.stream) return;
    try {
      this.recorder = this.mimeType
        ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
        : new MediaRecorder(this.stream);
    } catch (error) {
      this.opts.onError?.(toError(error));
      return;
    }
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.recorder.onerror = (event) => {
      const err =
        (event as unknown as { error?: unknown }).error ??
        new Error("MediaRecorder error");
      this.opts.onError?.(toError(err));
    };
    this.recorder.onstop = () => {
      const recordedMime = this.recorder?.mimeType || this.mimeType || "audio/webm";
      const blob = new Blob(this.chunks, { type: recordedMime });
      this.chunks = [];
      const minSpeechMs = this.opts.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
      const speakingFor = this.lastVoiceAt - this.speakingStartedAt;
      this.recorder = null;
      this.state = this.paused ? "paused" : "listening";
      this.opts.onStateChange?.(this.getState());
      if (blob.size > 0 && speakingFor >= minSpeechMs) {
        this.opts.onUtterance({ blob, mimeType: recordedMime });
      }
    };
    this.recorder.start();
    this.speakingStartedAt = now;
    this.lastVoiceAt = now;
    this.state = "speaking";
    this.opts.onStateChange?.(this.getState());

    this.utteranceTimeoutId = window.setTimeout(() => {
      if (this.recorder && this.recorder.state === "recording") {
        this.finaliseRecorder();
      }
    }, maxUtteranceMs);
  }

  private finaliseRecorder() {
    if (this.utteranceTimeoutId !== null) {
      window.clearTimeout(this.utteranceTimeoutId);
      this.utteranceTimeoutId = null;
    }
    if (this.recorder && this.recorder.state === "recording") {
      try {
        this.recorder.stop();
      } catch (error) {
        this.opts.onError?.(toError(error));
      }
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}
