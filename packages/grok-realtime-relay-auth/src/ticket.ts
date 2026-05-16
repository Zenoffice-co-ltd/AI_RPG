import {
  createHmac,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const RELAY_TICKET_VERSION = "mra1";
export const DEFAULT_RELAY_TICKET_PATH = "/api/v3/realtime-relay";
export const DEFAULT_RELAY_TICKET_TTL_SECONDS = 60;

export type RelayTicketDemoSlug =
  | "adecco-roleplay-v25"
  | "adecco-roleplay-v50"
  | "adecco-roleplay-v50-1"
  | "adecco-roleplay-v50-4"
  | "adecco-roleplay-v50-5"
  | "adecco-roleplay-v50-6"
  | "adecco-roleplay-v50-7"
  | "adecco-roleplay-v50-8"
  | "adecco-roleplay-v51"
  | "adecco-roleplay-vFinal";

export type RelayTicketRouterVariant = "B_NARROW_FALLBACK_SEMANTIC";

export type RelayTicketBackend =
  | "grok-first-v50"
  | "grok-first-v50-1"
  | "grok-first-v50-4"
  | "grok-first-v50-5"
  | "grok-first-v50-6"
  | "grok-first-v50-7"
  | "grok-first-v50-8"
  | "grok-first-v51"
  | "grok-first-vFinal";

export type RelayTicketPayload = {
  aud: string;
  path: string;
  transport: "mendan_cloud_run_relay_wss";
  demoSlug: RelayTicketDemoSlug;
  routerVariant?: RelayTicketRouterVariant | undefined;
  backend?: RelayTicketBackend | undefined;
  sessionId: string;
  participantIdHash?: string | undefined;
  iat: number;
  exp: number;
  nonce: string;
};

export type CreateRelayTicketInput = {
  secret: string;
  payload: Omit<RelayTicketPayload, "iat" | "exp" | "nonce"> &
    Partial<Pick<RelayTicketPayload, "iat" | "exp" | "nonce">>;
  now?: Date | undefined;
  ttlSeconds?: number | undefined;
};

export type VerifyRelayTicketInput = {
  ticket: string;
  secret: string;
  expectedAud: string;
  expectedPath: string;
  expectedTransport?: "mendan_cloud_run_relay_wss" | undefined;
  now?: Date | undefined;
  clockSkewSeconds?: number | undefined;
};

export type RelayTicketVerificationResult =
  | { ok: true; payload: RelayTicketPayload }
  | {
      ok: false;
      reason:
        | "malformed"
        | "bad_signature"
        | "expired"
        | "future_iat"
        | "wrong_aud"
        | "wrong_path"
        | "wrong_transport";
    };

export function createRelayTicket(input: CreateRelayTicketInput): {
  value: string;
  expiresAt: string;
  payload: RelayTicketPayload;
} {
  assertUsableSecret(input.secret);
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_RELAY_TICKET_TTL_SECONDS;
  const nowSeconds = toSeconds(input.now ?? new Date());
  const payload: RelayTicketPayload = {
    ...input.payload,
    iat: input.payload.iat ?? nowSeconds,
    exp: input.payload.exp ?? nowSeconds + ttlSeconds,
    nonce: input.payload.nonce ?? randomUUID(),
  };
  const payloadBase64Url = encodeJsonBase64Url(payload);
  const signatureBase64Url = signPayload(input.secret, payloadBase64Url);
  return {
    value: `${RELAY_TICKET_VERSION}.${payloadBase64Url}.${signatureBase64Url}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    payload,
  };
}

export function verifyRelayTicket(
  input: VerifyRelayTicketInput
): RelayTicketVerificationResult {
  if (!input.secret || !input.ticket) return { ok: false, reason: "malformed" };
  const parts = input.ticket.split(".");
  if (parts.length !== 3 || parts[0] !== RELAY_TICKET_VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const payloadBase64Url = parts[1];
  const signatureBase64Url = parts[2];
  if (!payloadBase64Url || !signatureBase64Url) {
    return { ok: false, reason: "malformed" };
  }
  const expectedSignature = signPayload(input.secret, payloadBase64Url);
  if (!safeEqualBase64Url(signatureBase64Url, expectedSignature)) {
    return { ok: false, reason: "bad_signature" };
  }
  const payload = decodePayload(payloadBase64Url);
  if (!payload) return { ok: false, reason: "malformed" };
  const nowSeconds = toSeconds(input.now ?? new Date());
  const skew = input.clockSkewSeconds ?? 10;
  if (payload.exp < nowSeconds - skew) return { ok: false, reason: "expired" };
  if (payload.iat > nowSeconds + skew) return { ok: false, reason: "future_iat" };
  if (payload.aud !== input.expectedAud) {
    return { ok: false, reason: "wrong_aud" };
  }
  if (payload.path !== input.expectedPath) {
    return { ok: false, reason: "wrong_path" };
  }
  if (
    payload.transport !==
    (input.expectedTransport ?? "mendan_cloud_run_relay_wss")
  ) {
    return { ok: false, reason: "wrong_transport" };
  }
  return { ok: true, payload };
}

export function hashRelaySessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
}

function assertUsableSecret(secret: string) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("XAI_RELAY_TICKET_SECRET must be at least 32 characters");
  }
}

function signPayload(secret: string, payloadBase64Url: string): string {
  return createHmac("sha256", secret)
    .update(payloadBase64Url)
    .digest("base64url");
}

function encodeJsonBase64Url(payload: RelayTicketPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string): RelayTicketPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<RelayTicketPayload>;
    if (
      typeof parsed.aud !== "string" ||
      typeof parsed.path !== "string" ||
      parsed.transport !== "mendan_cloud_run_relay_wss" ||
      !isValidRelayRouteIdentity(parsed) ||
      typeof parsed.sessionId !== "string" ||
      (parsed.participantIdHash !== undefined &&
        typeof parsed.participantIdHash !== "string") ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number" ||
      typeof parsed.nonce !== "string"
    ) {
      return null;
    }
    return parsed as RelayTicketPayload;
  } catch {
    return null;
  }
}

function isValidRelayRouteIdentity(parsed: Partial<RelayTicketPayload>): boolean {
  if (parsed.demoSlug === "adecco-roleplay-v25") {
    return (
      parsed.routerVariant === "B_NARROW_FALLBACK_SEMANTIC" &&
      parsed.backend === undefined
    );
  }
  if (parsed.demoSlug === "adecco-roleplay-v50") {
    return parsed.backend === "grok-first-v50";
  }
  if (parsed.demoSlug === "adecco-roleplay-v50-1") {
    return parsed.backend === "grok-first-v50-1";
  }
  if (parsed.demoSlug === "adecco-roleplay-v50-4") {
    return parsed.backend === "grok-first-v50-4";
  }
  if (parsed.demoSlug === "adecco-roleplay-v50-5") {
    return parsed.backend === "grok-first-v50-5";
  }
  if (parsed.demoSlug === "adecco-roleplay-v50-6") {
    return parsed.backend === "grok-first-v50-6";
  }
  if (parsed.demoSlug === "adecco-roleplay-v50-7") {
    return parsed.backend === "grok-first-v50-7";
  }
  if (parsed.demoSlug === "adecco-roleplay-v50-8") {
    return parsed.backend === "grok-first-v50-8";
  }
  if (parsed.demoSlug === "adecco-roleplay-v51") {
    return parsed.backend === "grok-first-v51";
  }
  if (parsed.demoSlug === "adecco-roleplay-vFinal") {
    return (
      parsed.backend === "grok-first-vFinal" &&
      typeof parsed.participantIdHash === "string" &&
      parsed.participantIdHash.length === 16
    );
  }
  return false;
}

function safeEqualBase64Url(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    const max = Math.max(left.length, right.length, 1);
    timingSafeEqual(Buffer.alloc(max), Buffer.alloc(max));
    return false;
  }
  return timingSafeEqual(left, right);
}

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
