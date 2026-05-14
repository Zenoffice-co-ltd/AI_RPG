import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  DEFAULT_RELAY_TICKET_PATH,
  hashRelaySessionId,
  verifyRelayTicket,
} from "@top-performer/grok-realtime-relay-auth";
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
      demoSlug: context.demoSlug,
      routerVariant: context.routerVariant,
      transport: context.transport,
      origin: req.headers.origin,
      host: req.headers.host,
    };
    logRelay("client.connected", baseLog);
    logRelay("ticket.accepted", baseLog);
    logRelay("upstream.connecting", baseLog);

    const upstream = upstreamFactory({ base: upstreamBase, model, apiKey });
    let closed = false;
    let firstAudioDeltaLogged = false;
    const pending: Array<{ data: RawData; isBinary: boolean }> = [];
    const heartbeat = setInterval(() => {
      if (client.readyState === WebSocket.OPEN) client.ping();
      if (upstream.readyState === WebSocket.OPEN) upstream.ping();
    }, 30_000);

    client.on("message", (data: RawData, isBinary: boolean) => {
      if (upstream.readyState === WebSocket.OPEN) {
        sendWithBackpressure(upstream, data, isBinary);
      } else if (pending.length < 200) {
        pending.push({ data, isBinary });
      }
    });
    upstream.on("open", () => {
      logRelay("upstream.connected", baseLog);
      while (pending.length > 0 && upstream.readyState === WebSocket.OPEN) {
        const item = pending.shift();
        if (item) sendWithBackpressure(upstream, item.data, item.isBinary);
      }
    });
    upstream.on("message", (data: RawData, isBinary: boolean) => {
      if (!firstAudioDeltaLogged && isFirstAudioDelta(data, isBinary)) {
        firstAudioDeltaLogged = true;
        logRelay("first.upstream.audio.delta", baseLog);
      }
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
      logRelay("relay.error", { ...baseLog, side: "client", message: error.message });
      closeSocket(upstream, 1011, "client websocket error");
    });
    upstream.on("error", (error: Error) => {
      logRelay("relay.error", { ...baseLog, side: "upstream", message: error.message });
      closeSocket(client, 1011, "upstream websocket error");
    });
  });

  return server;
}

type UpgradeContext = {
  ok: true;
  sessionId: string;
  demoSlug: "adecco-roleplay-v25";
  routerVariant: "B_NARROW_FALLBACK_SEMANTIC";
  transport: "mendan_cloud_run_relay_wss";
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
  return {
    ok: true,
    sessionId: result.payload.sessionId,
    demoSlug: result.payload.demoSlug,
    routerVariant: result.payload.routerVariant,
    transport: result.payload.transport,
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

function isFirstAudioDelta(data: RawData, isBinary: boolean): boolean {
  if (isBinary) return false;
  const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    return parsed.type === "response.output_audio.delta";
  } catch {
    return false;
  }
}

function sendWithBackpressure(
  socket: WebSocket,
  data: RawData,
  isBinary: boolean
) {
  if (socket.bufferedAmount > 16 * 1024 * 1024) return;
  socket.send(data, { binary: isBinary });
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
