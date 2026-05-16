import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  DEFAULT_RELAY_TICKET_PATH,
  hashRelaySessionId,
  verifyRelayTicket,
} from "@top-performer/grok-realtime-relay-auth";
import { getGrokFirstVFinalConfig } from "@top-performer/grok-first-roleplay-config";
import { logRelay } from "./logging";
import { createUpstream } from "./upstream";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://mendan.biz",
  "https://www.mendan.biz",
  "https://roleplay.mendan.biz",
  "https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app",
];
const DEFAULT_EXPECTED_HOSTS = ["voice.mendan.biz"];

export type RelayServerOptions = {
  port?: number;
  env?: NodeJS.ProcessEnv;
  upstreamFactory?: typeof createUpstream;
};

export function createRelayServer(options: RelayServerOptions = {}) {
  const env = options.env ?? process.env;
  const allowedOrigins = parseCsv(
    env["RELAY_ALLOWED_ORIGINS"],
    DEFAULT_ALLOWED_ORIGINS
  );
  const expectedHosts = parseCsv(
    env["RELAY_EXPECTED_HOSTS"],
    DEFAULT_EXPECTED_HOSTS
  );
  const expectedAud = env["RELAY_EXPECTED_AUD"] ?? "voice.mendan.biz";
  const ticketSecret = env["XAI_RELAY_TICKET_SECRET"] ?? "";
  const apiKey = env["XAI_API_KEY"] ?? "";
  const upstreamBase = env["XAI_REALTIME_BASE"] ?? "wss://api.x.ai/v1/realtime";
  const model = env["XAI_REALTIME_MODEL"] ?? "grok-voice-think-fast-1.0";
  const upstreamFactory = options.upstreamFactory ?? createUpstream;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === DEFAULT_RELAY_TICKET_PATH) {
      res.writeHead(426, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "websocket upgrade required" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8 * 1024 * 1024,
    handleProtocols: (protocols) =>
      protocols.has("mendan-relay-v1") ? "mendan-relay-v1" : false,
  });

  server.on("upgrade", (req, socket, head) => {
    const context = validateUpgrade({
      req,
      allowedOrigins,
      expectedHosts,
      expectedAud,
      ticketSecret,
    });
    if (!context.ok) {
      socket.write(`HTTP/1.1 ${context.status} ${context.statusText}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      logRelay("ticket.rejected", {
        reason: context.reason,
        origin: req.headers.origin ?? null,
        host: req.headers.host ?? null,
      });
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req, context);
    });
  });

  wss.on("connection", (client: WebSocket, req: IncomingMessage, context: UpgradeContext) => {
    const sessionIdHash = hashRelaySessionId(context.sessionId);
    const baseLog = {
      sessionIdHash,
      participantIdHash: context.participantIdHash ?? null,
      demoSlug: context.demoSlug,
      routerVariant: context.routerVariant ?? null,
      backend: context.backend ?? null,
      transport: context.transport,
      origin: req.headers.origin,
      host: req.headers.host,
    };
    logRelay("client.connected", baseLog);
    logRelay("ticket.accepted", baseLog);
    logRelay("upstream.connecting", baseLog);

    const upstream = upstreamFactory({ base: upstreamBase, model, apiKey });
    let closed = false;
    let upstreamReadyForClientFrames = false;
    const pending: Array<{ data: RawData | string; isBinary: boolean }> = [];
    const heartbeat = setInterval(() => {
      if (client.readyState === WebSocket.OPEN) client.ping();
      if (upstream.readyState === WebSocket.OPEN) upstream.ping();
    }, 30_000);

    client.on("message", (data: RawData, isBinary: boolean) => {
      const proxyFrame = sanitizeClientFrameForUpstream(data, isBinary, context, baseLog);
      if (!proxyFrame) return;
      if (upstream.readyState === WebSocket.OPEN && upstreamReadyForClientFrames) {
        sendWithBackpressure(upstream, proxyFrame.data, proxyFrame.isBinary);
      } else if (pending.length < 200) {
        pending.push(proxyFrame);
      }
    });
    upstream.on("open", () => {
      logRelay("upstream.connected", baseLog);
      if (context.backend === "grok-first-vFinal") {
        sendVFinalServerSideSetup(upstream);
      }
      upstreamReadyForClientFrames = true;
      while (pending.length > 0 && upstream.readyState === WebSocket.OPEN) {
        const item = pending.shift();
        if (item) sendWithBackpressure(upstream, item.data, item.isBinary);
      }
    });
    upstream.on("message", (data: RawData, isBinary: boolean) => {
      maybeLogFirstAudioDelta(data, isBinary, baseLog);
      if (client.readyState === WebSocket.OPEN) {
        sendWithBackpressure(client, data, isBinary);
      }
    });
    client.on("close", (code: number, reason: Buffer) => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      logRelay("client.closed", { ...baseLog, closeCode: code });
      closeSocket(upstream, code, reason.toString());
    });
    upstream.on("close", (code: number, reason: Buffer) => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      logRelay("upstream.closed", { ...baseLog, closeCode: code });
      closeSocket(client, code, reason.toString());
    });
    client.on("error", (error: Error) => {
      void error;
      logRelay("relay.error", { ...baseLog, side: "client", errorType: "websocket_error" });
      closeSocket(upstream, 1011, "client websocket error");
    });
    upstream.on("error", (error: Error) => {
      void error;
      logRelay("relay.error", { ...baseLog, side: "upstream", errorType: "websocket_error" });
      closeSocket(client, 1011, "upstream websocket error");
    });
  });

  return server;
}

type UpgradeContext = {
  ok: true;
  sessionId: string;
  demoSlug:
    | "adecco-roleplay-v25"
    | "adecco-roleplay-v50"
    | "adecco-roleplay-v50-1"
    | "adecco-roleplay-v50-2"
    | "adecco-roleplay-v50-3"
    | "adecco-roleplay-v50-5"
    | "adecco-roleplay-v50-6"
    | "adecco-roleplay-v50-7"
    | "adecco-roleplay-v50-8"
    | "adecco-roleplay-vFinal";
  routerVariant?: "B_NARROW_FALLBACK_SEMANTIC" | undefined;
  backend?:
    | "grok-first-v50"
    | "grok-first-v50-1"
    | "grok-first-v50-2"
    | "grok-first-v50-3"
    | "grok-first-v50-5"
    | "grok-first-v50-6"
    | "grok-first-v50-7"
    | "grok-first-v50-8"
    | "grok-first-vFinal"
    | undefined;
  transport: "mendan_cloud_run_relay_wss";
  participantIdHash?: string | undefined;
  nonce: string;
};

function validateUpgrade(input: {
  req: IncomingMessage;
  allowedOrigins: string[];
  expectedHosts: string[];
  expectedAud: string;
  ticketSecret: string;
}):
  | UpgradeContext
  | { ok: false; status: number; statusText: string; reason: string } {
  const url = new URL(
    input.req.url ?? "/",
    `http://${input.req.headers.host ?? "localhost"}`
  );
  if (url.pathname !== DEFAULT_RELAY_TICKET_PATH) {
    return { ok: false, status: 404, statusText: "Not Found", reason: "path" };
  }
  const origin = input.req.headers.origin;
  if (!origin || !input.allowedOrigins.includes(origin)) {
    return { ok: false, status: 403, statusText: "Forbidden", reason: "origin" };
  }
  const host = (input.req.headers.host ?? "").split(":")[0] ?? "";
  if (!input.expectedHosts.includes(host)) {
    return { ok: false, status: 403, statusText: "Forbidden", reason: "host" };
  }
  const protocols = parseProtocols(input.req.headers["sec-websocket-protocol"]);
  if (!protocols.includes("mendan-relay-v1")) {
    return { ok: false, status: 401, statusText: "Unauthorized", reason: "protocol" };
  }
  const ticket = protocols
    .find((protocol) => protocol.startsWith("mendan-relay-ticket."))
    ?.slice("mendan-relay-ticket.".length);
  if (!ticket) {
    return { ok: false, status: 401, statusText: "Unauthorized", reason: "ticket" };
  }
  const result = verifyRelayTicket({
    ticket,
    secret: input.ticketSecret,
    expectedAud: input.expectedAud,
    expectedPath: DEFAULT_RELAY_TICKET_PATH,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      reason: result.reason,
    };
  }
  if (isReplay(result.payload.nonce)) {
    return {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      reason: "replay",
    };
  }
  return {
    ok: true,
    sessionId: result.payload.sessionId,
    demoSlug: result.payload.demoSlug,
    routerVariant: result.payload.routerVariant,
    backend: result.payload.backend,
    transport: result.payload.transport,
    participantIdHash: result.payload.participantIdHash,
    nonce: result.payload.nonce,
  };
}

function parseCsv(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseProtocols(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const firstAudioDeltaSessions = new Set<string>();
const seenTicketNonces = new Map<string, number>();
const REPLAY_CACHE_TTL_MS = 70_000;

function isReplay(nonce: string) {
  const now = Date.now();
  for (const [key, expiresAt] of seenTicketNonces) {
    if (expiresAt <= now) seenTicketNonces.delete(key);
  }
  if (seenTicketNonces.has(nonce)) return true;
  seenTicketNonces.set(nonce, now + REPLAY_CACHE_TTL_MS);
  return false;
}

function maybeLogFirstAudioDelta(
  data: RawData,
  isBinary: boolean,
  baseLog: Record<string, unknown>
) {
  const sessionIdHash = String(baseLog["sessionIdHash"] ?? "");
  if (firstAudioDeltaSessions.has(sessionIdHash) || isBinary) {
    return;
  }
  const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    if (parsed.type === "response.output_audio.delta") {
      firstAudioDeltaSessions.add(sessionIdHash);
      logRelay("first.upstream.audio.delta", baseLog);
    }
  } catch {
    // ignore non-JSON frames
  }
}

function sendWithBackpressure(
  socket: WebSocket,
  data: RawData | string,
  isBinary: boolean
) {
  if (socket.bufferedAmount > 16 * 1024 * 1024) return;
  socket.send(data, { binary: isBinary });
}

function sendVFinalServerSideSetup(upstream: WebSocket) {
  const config = getGrokFirstVFinalConfig();
  sendWithBackpressure(
    upstream,
    JSON.stringify({
      type: "session.update",
      session: {
        voice: config.voiceId,
        instructions: config.instructions,
        tools: [],
        audio: {
          input: {
            format: {
              type: config.audio.inputFormat,
              rate: config.audio.sampleRate,
            },
          },
          output: {
            format: {
              type: config.audio.outputFormat,
              rate: config.audio.sampleRate,
            },
          },
        },
        turn_detection: config.turnDetection,
      },
    }),
    false
  );
  sendWithBackpressure(
    upstream,
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: config.hiddenAssistantHistory }],
      },
    }),
    false
  );
}

function sanitizeClientFrameForUpstream(
  data: RawData,
  isBinary: boolean,
  context: UpgradeContext,
  baseLog: Record<string, unknown>
): { data: RawData | string; isBinary: boolean } | null {
  if (context.backend !== "grok-first-vFinal") {
    return { data, isBinary };
  }
  if (isBinary) {
    logRelay("client.frame.dropped", { ...baseLog, reason: "binary_frame" });
    return null;
  }
  const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logRelay("client.frame.dropped", { ...baseLog, reason: "malformed_json" });
    return null;
  }
  if (!isAllowedVFinalClientMessage(parsed)) {
    logRelay("client.frame.dropped", {
      ...baseLog,
      reason: "disallowed_client_message",
    });
    return null;
  }
  return { data: raw, isBinary: false };
}

function isAllowedVFinalClientMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const record = message as Record<string, unknown>;
  if (record["type"] === "input_audio_buffer.append") {
    return (
      hasExactKeys(record, ["type", "audio"]) &&
      typeof record["audio"] === "string"
    );
  }
  if (record["type"] === "response.cancel") {
    return Object.keys(record).length === 1;
  }
  if (record["type"] === "response.create") {
    return Object.keys(record).length === 1;
  }
  if (record["type"] !== "conversation.item.create") return false;
  if (!hasExactKeys(record, ["type", "item"])) return false;
  const item = record["item"];
  if (!item || typeof item !== "object") return false;
  const itemRecord = item as Record<string, unknown>;
  if (!hasExactKeys(itemRecord, ["type", "role", "content"])) return false;
  if (itemRecord["type"] !== "message") return false;
  if (itemRecord["role"] !== "user") return false;
  const content = itemRecord["content"];
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((part) => {
    if (!part || typeof part !== "object") return false;
    const partRecord = part as Record<string, unknown>;
    return (
      hasExactKeys(partRecord, ["type", "text"]) &&
      partRecord["type"] === "input_text" &&
      typeof partRecord["text"] === "string"
    );
  });
}

function hasExactKeys(record: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function closeSocket(socket: WebSocket, code: number, reason: string) {
  if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
    return;
  }
  const closeCode =
    Number.isInteger(code) && code >= 1000 && code < 5000 && ![1005, 1006, 1015].includes(code)
      ? code
      : 1011;
  try {
    socket.close(closeCode, reason);
  } catch {
    socket.terminate();
  }
}

if (process.env["NODE_ENV"] !== "test") {
  const port = Number(process.env["PORT"] ?? "8080");
  createRelayServer({ port }).listen(port, "0.0.0.0", () => {
    logRelay("server.listening", { port });
  });
}
