"use client";

import type {
  GrokFirstV50RealtimeAuth,
  GrokFirstV50ServerEvent,
  GrokFirstV50Session,
} from "./types";

type QueuedMessage = {
  payload: unknown;
  gate: "none" | "session_update_sent" | "ready";
  audioAppend: boolean;
};

export class GrokFirstRealtime {
  private socket: WebSocket | null = null;
  private queue: QueuedMessage[] = [];
  private state: "idle" | "connecting" | "open" | "session_update_sent" | "ready" | "closed" =
    "idle";
  private closedByUs = false;

  constructor(
    private readonly opts: {
      url: string;
      auth: GrokFirstV50RealtimeAuth;
      onMessage: (event: GrokFirstV50ServerEvent) => void;
      onOpen?: () => void;
      onReady?: () => void;
      onClose?: (event: { code: number; reason: string }) => void;
      onError?: (error: { message: string }) => void;
      maxQueuedMessages?: number;
      WebSocketCtor?: typeof WebSocket;
    }
  ) {}

  open(): void {
    this.state = "connecting";
    const Ctor = this.opts.WebSocketCtor ?? WebSocket;
    this.socket = new Ctor(this.opts.url, buildProtocols(this.opts.auth));
    this.socket.onopen = () => {
      this.state = "open";
      this.opts.onOpen?.();
      this.flush();
    };
    this.socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as GrokFirstV50ServerEvent;
        if (parsed && typeof parsed.type === "string") {
          this.opts.onMessage(parsed);
        }
      } catch {
        // ignore malformed vendor events
      }
    };
    this.socket.onerror = () => {
      this.opts.onError?.({ message: "websocket error" });
    };
    this.socket.onclose = (event) => {
      this.state = "closed";
      this.opts.onClose?.({ code: event.code, reason: event.reason });
    };
  }

  isReady(): boolean {
    return this.state === "ready";
  }

  sendSessionUpdate(session: GrokFirstV50Session): void {
    if (session.backend === "grok-first-vFinal") {
      return;
    }
    this.send(
      {
        type: "session.update",
        session: {
          voice: session.voiceId,
          instructions: session.instructions,
          tools: [],
          audio: {
            input: {
              format: {
                type: session.audio.inputFormat,
                rate: session.audio.sampleRate,
              },
            },
            output: {
              format: {
                type: session.audio.outputFormat,
                rate: session.audio.sampleRate,
              },
            },
          },
          turn_detection: session.turnDetection,
        },
      },
      { gate: "none" }
    );
    this.state = "session_update_sent";
    this.flush();
  }

  sendAssistantHistory(text: string): void {
    this.send(
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        },
      },
      { gate: "session_update_sent" }
    );
    this.state = "ready";
    this.opts.onReady?.();
    this.flush();
  }

  markReadyAfterRelaySetup(): void {
    this.state = "ready";
    this.opts.onReady?.();
    this.flush();
  }

  markServerSideSetupReady(): void {
    this.markReadyAfterRelaySetup();
  }

  sendUserText(text: string): void {
    this.send(
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      },
      { gate: "ready" }
    );
    this.send({ type: "response.create" }, { gate: "ready" });
  }

  createResponse(): void {
    this.send({ type: "response.create" }, { gate: "ready" });
  }

  appendAudio(base64Pcm16: string): void {
    this.send(
      { type: "input_audio_buffer.append", audio: base64Pcm16 },
      { gate: "ready", audioAppend: true }
    );
  }

  cancelResponse(): void {
    this.send({ type: "response.cancel" }, { gate: "none" });
  }

  close(): void {
    this.closedByUs = true;
    this.queue = [];
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.socket = null;
    this.state = "closed";
  }

  wasClosedByUs(): boolean {
    return this.closedByUs;
  }

  private send(
    payload: unknown,
    opts: { gate?: QueuedMessage["gate"]; audioAppend?: boolean } = {}
  ) {
    const entry = {
      payload,
      gate: opts.gate ?? "none",
      audioAppend: opts.audioAppend ?? false,
    };
    if (!this.socket || this.socket.readyState !== 1 || !this.canSend(entry.gate)) {
      this.enqueue(entry);
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private enqueue(entry: QueuedMessage) {
    const max = this.opts.maxQueuedMessages ?? 100;
    if (this.queue.length >= max) {
      const audioIndex = this.queue.findIndex((item) => item.audioAppend);
      this.queue.splice(audioIndex >= 0 ? audioIndex : 0, 1);
    }
    this.queue.push(entry);
  }

  private flush() {
    if (!this.socket || this.socket.readyState !== 1) return;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < this.queue.length; i += 1) {
        const entry = this.queue[i];
        if (!entry || !this.canSend(entry.gate)) continue;
        this.queue.splice(i, 1);
        this.socket.send(JSON.stringify(entry.payload));
        progressed = true;
        break;
      }
    }
  }

  private canSend(gate: QueuedMessage["gate"]) {
    if (gate === "none") return this.state !== "closed";
    if (gate === "session_update_sent") {
      return this.state === "session_update_sent" || this.state === "ready";
    }
    return this.state === "ready";
  }
}

export function buildProtocols(auth: GrokFirstV50RealtimeAuth): string[] {
  if (auth.mode === "xai_ephemeral_subprotocol") {
    return [`xai-client-secret.${auth.token}`];
  }
  return [auth.protocol, `mendan-relay-ticket.${auth.ticket}`];
}
