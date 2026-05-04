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
  onClose?: (event: { code: number; reason: string }) => void;
  onError?: (error: { message: string }) => void;
  WebSocketCtor?: typeof WebSocket;
};

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

  constructor(opts: GrokVoiceRealtimeOptions) {
    this.opts = opts;
  }

  open(): void {
    const Ctor = this.opts.WebSocketCtor ?? WebSocket;
    this.socket = new Ctor(this.opts.url, [
      `xai-client-secret.${this.opts.ephemeralToken}`,
    ]);
    this.socket.onopen = () => {
      this.opts.onOpen?.();
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
      this.opts.onError?.({ message: "websocket error" });
    };
    this.socket.onclose = (event) => {
      this.opts.onClose?.({ code: event.code, reason: event.reason });
    };
  }

  isOpen(): boolean {
    return this.socket?.readyState === 1;
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
    });
    this.send({ type: "response.create" });
  }

  appendAudio(base64Pcm16: string): void {
    this.send({ type: "input_audio_buffer.append", audio: base64Pcm16 });
  }

  commitAudio(): void {
    this.send({ type: "input_audio_buffer.commit" });
  }

  cancelResponse(): void {
    this.send({ type: "response.cancel" });
  }

  close(): void {
    this.closedByUs = true;
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.socket = null;
  }

  wasClosedByUs(): boolean {
    return this.closedByUs;
  }

  private send(payload: unknown) {
    if (!this.socket || this.socket.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      // ignore — onerror/onclose will fire
    }
  }
}
