// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrokVoiceRealtime } from "../../lib/roleplay/grok-voice-realtime";

// A WebSocket-shaped class we can pass to the realtime wrapper. We capture
// every constructed instance in a module-level array so each test can grab
// the live socket and drive its event handlers.
const sockets: FakeWebSocket[] = [];

class FakeWebSocket {
  static OPEN = 1;
  url: string;
  protocols: string[];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: string[] = [];
  throwOnSend = false;

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = typeof url === "string" ? url : url.toString();
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
    sockets.push(this);
  }

  send(data: string) {
    if (this.throwOnSend) {
      throw new Error("send boom");
    }
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "" } as unknown as CloseEvent);
  }

  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  emit(payload: unknown) {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.onmessage?.({ data } as MessageEvent<string>);
  }
}

const FakeWebSocketCtor = FakeWebSocket as unknown as typeof WebSocket;
const SESSION_UPDATE = {
  voice: "rex",
  instructions: "You are a roleplay agent.",
  audio: { inputFormat: "audio/pcm", outputFormat: "audio/pcm", sampleRate: 24_000 },
  turn_detection: {
    type: "server_vad" as const,
    threshold: 0.72,
    silence_duration_ms: 650,
    prefix_padding_ms: 333,
  },
};

afterEach(() => {
  sockets.length = 0;
});

describe("GrokVoiceRealtime", () => {
  it("opens the WebSocket with xai-client-secret subprotocol", () => {
    const realtime = new GrokVoiceRealtime({
      url: "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0",
      ephemeralToken: "ephemeral-xyz",
      onMessage: () => undefined,
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe(
      "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0"
    );
    expect(sockets[0]!.protocols).toEqual(["xai-client-secret.ephemeral-xyz"]);
  });

  it("sends session.update with voice + instructions + audio + turn_detection (incl. prefix_padding_ms)", () => {
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: () => undefined,
      onOpen: () => {
        realtime.sendSessionUpdate(SESSION_UPDATE);
      },
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    sockets[0]!.open();
    expect(sockets[0]!.sent).toHaveLength(1);
    const sent = JSON.parse(sockets[0]!.sent[0]!) as {
      type: string;
      session: {
        voice: string;
        instructions: string;
        audio: {
          input: { format: { type: string; rate: number } };
          output: { format: { type: string; rate: number } };
        };
        turn_detection: {
          type: string;
          threshold: number;
          silence_duration_ms: number;
          prefix_padding_ms: number;
        };
      };
    };
    expect(sent.type).toBe("session.update");
    expect(sent.session.voice).toBe("rex");
    expect(sent.session.instructions).toContain("roleplay agent");
    expect(sent.session.audio.input.format.type).toBe("audio/pcm");
    expect(sent.session.audio.output.format.rate).toBe(24_000);
    expect(sent.session.turn_detection.type).toBe("server_vad");
    expect(sent.session.turn_detection.threshold).toBe(0.72);
    expect(sent.session.turn_detection.silence_duration_ms).toBe(650);
    expect(sent.session.turn_detection.prefix_padding_ms).toBe(333);
  });

  it("injects firstMessage as a prior assistant turn via conversation.item.create", () => {
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: () => undefined,
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    sockets[0]!.open();
    realtime.sendSessionUpdate(SESSION_UPDATE);
    realtime.sendAssistantHistory("お時間ありがとうございます。");
    const sent = sockets[0]!.sent.map((s) => JSON.parse(s)) as Array<{
      type: string;
      item?: { role?: string; content?: Array<{ type: string; text: string }> };
    }>;
    const created = sent.find((p) => p.type === "conversation.item.create");
    expect(created).toBeDefined();
    expect(created!.item!.role).toBe("assistant");
    expect(created!.item!.content?.[0]?.text).toContain("お時間");
  });

  it("sendUserText creates a user message and triggers response.create", () => {
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: () => undefined,
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    sockets[0]!.open();
    realtime.sendSessionUpdate(SESSION_UPDATE);
    realtime.sendAssistantHistory("お時間ありがとうございます。");
    realtime.sendUserText("募集背景を教えてください");
    const sent = sockets[0]!.sent.map((s) => JSON.parse(s)) as Array<{
      type: string;
      item?: { role?: string; content?: Array<{ type: string; text: string }> };
    }>;
    const userCreate = sent.find(
      (payload) =>
        payload.type === "conversation.item.create" &&
        payload.item?.role === "user"
    );
    expect(userCreate?.item!.content?.[0]?.text).toBe(
      "募集背景を教えてください"
    );
    expect(sent.at(-1)!.type).toBe("response.create");
  });

  it("sendUserHistory creates a user item without response.create", () => {
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: () => undefined,
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    sockets[0]!.open();
    realtime.sendSessionUpdate(SESSION_UPDATE);
    realtime.sendAssistantHistory("お時間ありがとうございます。");
    realtime.sendUserHistory("単価は？");
    const sent = sockets[0]!.sent.map((s) => JSON.parse(s)) as Array<{
      type: string;
      item?: { role?: string; content?: Array<{ type: string; text: string }> };
    }>;
    const last = sent.at(-1)!;
    expect(last.type).toBe("conversation.item.create");
    expect(last.item?.role).toBe("user");
    expect(last.item?.content?.[0]?.type).toBe("input_text");
    expect(last.item?.content?.[0]?.text).toBe("単価は？");
  });

  it("sendAssistantHistoryMessage creates an assistant item without re-firing ready", () => {
    const ready = vi.fn();
    const telemetry: string[] = [];
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: () => undefined,
      onReady: ready,
      onTelemetry: (event) => telemetry.push(event.kind),
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    sockets[0]!.open();
    realtime.sendSessionUpdate(SESSION_UPDATE);
    realtime.sendAssistantHistory("お時間ありがとうございます。");
    ready.mockClear();
    telemetry.length = 0;
    realtime.sendAssistantHistoryMessage("固定回答です。");
    const sent = sockets[0]!.sent.map((s) => JSON.parse(s)) as Array<{
      type: string;
      item?: { role?: string; content?: Array<{ type: string; text: string }> };
    }>;
    const last = sent.at(-1)!;
    expect(last.type).toBe("conversation.item.create");
    expect(last.item?.role).toBe("assistant");
    expect(last.item?.content?.[0]?.type).toBe("output_text");
    expect(last.item?.content?.[0]?.text).toBe("固定回答です。");
    expect(ready).not.toHaveBeenCalled();
    expect(telemetry).not.toContain("session.ready");
  });

  it("parses and forwards typed server events", () => {
    const messages: Array<{ type: string }> = [];
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: (m) => messages.push(m as { type: string }),
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    sockets[0]!.open();
    sockets[0]!.emit({ type: "response.output_audio.delta", delta: "AAAA" });
    sockets[0]!.emit({ type: "response.text.delta", delta: "はい" });
    sockets[0]!.emit({ type: "response.done" });
    expect(messages.map((m) => m.type)).toEqual([
      "response.output_audio.delta",
      "response.text.delta",
      "response.done",
    ]);
  });

  it("appendAudio writes input_audio_buffer.append with the base64 payload", () => {
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: () => undefined,
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    sockets[0]!.open();
    realtime.sendSessionUpdate(SESSION_UPDATE);
    realtime.sendAssistantHistory("お時間ありがとうございます。");
    realtime.appendAudio("BASE64DATA");
    const sent = sockets[0]!.sent
      .map((payload) => JSON.parse(payload) as { type: string; audio?: string })
      .find((payload) => payload.type === "input_audio_buffer.append");
    expect(sent).toBeDefined();
    expect(sent!.type).toBe("input_audio_buffer.append");
    expect(sent!.audio).toBe("BASE64DATA");
  });

  it("queues session.update before socket open and flushes it after open", () => {
    const telemetry: string[] = [];
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: () => undefined,
      onTelemetry: (event) => telemetry.push(event.kind),
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    realtime.sendSessionUpdate(SESSION_UPDATE);
    expect(sockets[0]!.sent).toHaveLength(0);
    sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.sent[0]!).type).toBe("session.update");
    expect(telemetry).toContain("ws.send.queued");
    expect(telemetry).toContain("ws.send.flushed");
  });

  it("gates audio before ready and flushes it after assistant history primes the session", () => {
    const telemetry: string[] = [];
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: () => undefined,
      onTelemetry: (event) => telemetry.push(event.kind),
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    sockets[0]!.open();
    realtime.appendAudio("EARLY_AUDIO");
    expect(sockets[0]!.sent).toHaveLength(0);
    realtime.sendSessionUpdate(SESSION_UPDATE);
    expect(sockets[0]!.sent.map((s) => JSON.parse(s).type)).toEqual([
      "session.update",
    ]);
    realtime.sendAssistantHistory("お時間ありがとうございます。");
    expect(sockets[0]!.sent.map((s) => JSON.parse(s).type)).toEqual([
      "session.update",
      "conversation.item.create",
      "input_audio_buffer.append",
    ]);
    expect(realtime.isReady()).toBe(true);
    expect(telemetry).toContain("session.ready");
  });

  it("emits send failure telemetry when socket.send throws", () => {
    const telemetry: Array<{ kind: string; details?: Record<string, unknown> }> = [];
    const errors: string[] = [];
    const realtime = new GrokVoiceRealtime({
      url: "wss://example",
      ephemeralToken: "t",
      onMessage: () => undefined,
      onTelemetry: (event) => telemetry.push(event),
      onError: (error) => errors.push(error.message),
      WebSocketCtor: FakeWebSocketCtor,
    });
    realtime.open();
    sockets[0]!.open();
    sockets[0]!.throwOnSend = true;
    realtime.sendSessionUpdate(SESSION_UPDATE);
    expect(telemetry.some((event) => event.kind === "ws.send.failed")).toBe(true);
    expect(errors).toEqual(["send boom"]);
    expect(realtime.getReadyState()).toBe("error");
  });
});
