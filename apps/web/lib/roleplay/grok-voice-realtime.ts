"use client";

// Thin wrapper around the xAI Voice Agent realtime WebSocket. The browser
// authenticates via the `xai-client-secret.<token>` subprotocol — there is no
// way to set Authorization headers on a browser WebSocket, so the ephemeral
// token MUST go in the subprotocol list.
//
// Reference: https://docs.x.ai/developers/model-capabilities/audio/voice-agent

import type {
  GrokVoiceAudioConfig,
  GrokVoiceServerEvent,
  GrokVoiceTurnDetectionConfig,
} from "./grok-voice-types";

export type GrokVoiceRealtimeOptions = {
  url: string;
  ephemeralToken: string;
  onMessage: (event: GrokVoiceServerEvent) => void;
  onOpen?: () => void;
  onReady?: () => void;
  onClose?: (event: { code: number; reason: string }) => void;
  onError?: (error: { message: string }) => void;
  onTelemetry?: (event: { kind: string; details?: Record<string, unknown> }) => void;
  maxQueuedMessages?: number;
  WebSocketCtor?: typeof WebSocket;
};

export type RealtimeReadyState =
  | "idle"
  | "connecting"
  | "socket_open"
  | "session_update_sent"
  | "primed"
  | "ready"
  | "closed"
  | "error";

export type GrokVoiceSessionUpdatePayload = {
  voice: string;
  instructions: string;
  audio: GrokVoiceAudioConfig;
  turn_detection: GrokVoiceTurnDetectionConfig;
};

export class GrokVoiceRealtime {
  private socket: WebSocket | null = null;
  private opts: GrokVoiceRealtimeOptions;
  private closedByUs = false;
  private readyState: RealtimeReadyState = "idle";
  private queue: Array<{
    payload: unknown;
    gate: "none" | "session_update_sent" | "ready";
    audioAppend: boolean;
    onSent?: () => void;
  }> = [];
  private readonly maxQueuedMessages: number;

  constructor(opts: GrokVoiceRealtimeOptions) {
    this.opts = opts;
    this.maxQueuedMessages = opts.maxQueuedMessages ?? 100;
  }

  open(): void {
    this.readyState = "connecting";
    const Ctor = this.opts.WebSocketCtor ?? WebSocket;
    this.socket = new Ctor(this.opts.url, [
      `xai-client-secret.${this.opts.ephemeralToken}`,
    ]);
    this.socket.onopen = () => {
      this.readyState = "socket_open";
      this.opts.onOpen?.();
      this.flushQueue();
    };
    this.socket.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        "type" in parsed &&
        typeof (parsed as { type: unknown }).type === "string"
      ) {
        this.opts.onMessage(parsed as GrokVoiceServerEvent);
      }
    };
    this.socket.onerror = () => {
      this.readyState = "error";
      this.opts.onError?.({ message: "websocket error" });
    };
    this.socket.onclose = (event) => {
      this.readyState = "closed";
      this.opts.onClose?.({ code: event.code, reason: event.reason });
    };
  }

  isOpen(): boolean {
    return this.socket?.readyState === 1;
  }

  isReady(): boolean {
    return this.readyState === "ready";
  }

  getReadyState(): RealtimeReadyState {
    return this.readyState;
  }

  sendSessionUpdate(payload: GrokVoiceSessionUpdatePayload): void {
    this.send({
      type: "session.update",
      session: {
        voice: payload.voice,
        instructions: payload.instructions,
        audio: {
          input: { format: { type: payload.audio.inputFormat, rate: payload.audio.sampleRate } },
          output: { format: { type: payload.audio.outputFormat, rate: payload.audio.sampleRate } },
        },
        turn_detection: payload.turn_detection,
      },
    }, {
      gate: "none",
      onSent: () => {
        this.readyState = "session_update_sent";
        this.flushQueue();
      },
    });
  }

  sendAssistantHistory(text: string): void {
    // Inject the agent greeting as a prior assistant turn so Grok continues
    // the conversation in character. xAI Voice Agent does not expose a
    // dedicated "first message" config; this is the documented pattern for
    // priming an assistant turn.
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    }, {
      gate: "session_update_sent",
      onSent: () => {
        this.readyState = "primed";
        this.readyState = "ready";
        this.opts.onReady?.();
        this.emitTelemetry("session.ready");
        this.flushQueue();
      },
    });
  }

  sendUserText(text: string): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }, { gate: "ready" });
    this.send({ type: "response.create" }, { gate: "ready" });
  }

  appendAudio(base64Pcm16: string): void {
    this.send(
      { type: "input_audio_buffer.append", audio: base64Pcm16 },
      { gate: "ready", audioAppend: true }
    );
  }

  commitAudio(): void {
    this.send({ type: "input_audio_buffer.commit" }, { gate: "ready" });
  }

  cancelResponse(): void {
    this.send({ type: "response.cancel" }, { gate: "none" });
  }

  close(): void {
    this.closedByUs = true;
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.socket = null;
    this.queue = [];
    this.readyState = "closed";
  }

  wasClosedByUs(): boolean {
    return this.closedByUs;
  }

  private send(
    payload: unknown,
    opts: {
      gate?: "none" | "session_update_sent" | "ready";
      audioAppend?: boolean;
      onSent?: () => void;
    } = {}
  ) {
    const entry = {
      payload,
      gate: opts.gate ?? "none",
      audioAppend: opts.audioAppend ?? false,
      ...(opts.onSent ? { onSent: opts.onSent } : {}),
    };
    if (!this.socket || this.socket.readyState !== 1 || !this.canSendNow(entry.gate)) {
      this.enqueue(entry);
      return;
    }
    this.sendNow(entry);
  }

  private enqueue(entry: {
    payload: unknown;
    gate: "none" | "session_update_sent" | "ready";
    audioAppend: boolean;
    onSent?: () => void;
  }) {
    if (this.queue.length >= this.maxQueuedMessages) {
      const audioIdx = this.queue.findIndex((item) => item.audioAppend);
      const dropIdx = audioIdx >= 0 ? audioIdx : 0;
      this.queue.splice(dropIdx, 1);
      this.emitTelemetry("ws.send.failed", {
        reason: "queue_overflow",
        droppedAudioAppend: audioIdx >= 0,
      });
    }
    this.queue.push(entry);
    this.emitTelemetry("ws.send.queued", {
      type: payloadType(entry.payload),
      queued: this.queue.length,
      gate: entry.gate,
    });
  }

  private flushQueue() {
    if (!this.socket || this.socket.readyState !== 1 || this.queue.length === 0) {
      return;
    }
    let flushed = 0;
    let progressed = true;
    while (progressed) {
      progressed = false;
      const idx = this.queue.findIndex((entry) => this.canSendNow(entry.gate));
      if (idx < 0) break;
      const [entry] = this.queue.splice(idx, 1);
      if (!entry) break;
      if (this.sendNow(entry)) {
        flushed += 1;
      }
      progressed = true;
    }
    if (flushed > 0) {
      this.emitTelemetry("ws.send.flushed", {
        count: flushed,
        remaining: this.queue.length,
      });
    }
  }

  private canSendNow(gate: "none" | "session_update_sent" | "ready") {
    if (gate === "none") return true;
    if (gate === "session_update_sent") {
      return (
        this.readyState === "session_update_sent" ||
        this.readyState === "primed" ||
        this.readyState === "ready"
      );
    }
    return this.readyState === "ready";
  }

  private sendNow(entry: {
    payload: unknown;
    onSent?: () => void;
  }) {
    try {
      this.socket?.send(JSON.stringify(entry.payload));
      entry.onSent?.();
      return true;
    } catch (error) {
      this.readyState = "error";
      const message = error instanceof Error ? error.message : String(error);
      this.emitTelemetry("ws.send.failed", {
        type: payloadType(entry.payload),
        message,
      });
      this.opts.onError?.({ message });
      return false;
    }
  }

  private emitTelemetry(kind: string, details?: Record<string, unknown>) {
    this.opts.onTelemetry?.({
      kind,
      ...(details ? { details } : {}),
    });
  }
}

function payloadType(payload: unknown) {
  return payload &&
    typeof payload === "object" &&
    "type" in payload &&
    typeof (payload as { type?: unknown }).type === "string"
    ? (payload as { type: string }).type
    : "unknown";
}
