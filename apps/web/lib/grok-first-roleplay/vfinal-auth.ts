import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ensureEnvLoaded } from "@/server/loadEnv";

export const VFINAL_ACCESS_COOKIE = "roleplay_vfinal_access";
export const VFINAL_API_ACCESS_COOKIE = "roleplay_vfinal_api_access";
export const VFINAL_UI_COOKIE_PATH = "/demo/adecco-roleplay-vFinal";
export const VFINAL_API_COOKIE_PATH = "/api/grok-first-vFinal";

const TOKEN_VERSION = "mvi1";
const TENANT = "adecco";
const PURPOSE = "ai_roleplay";

export type VFinalAccessSession = {
  participantIdHash: string;
  exp: number;
};

export type VFinalInviteFailureReason =
  | "invite.missing"
  | "invite.malformed"
  | "invite.invalid_signature"
  | "invite.invalid_payload"
  | "invite.expired"
  | "invite.wrong_tenant"
  | "invite.wrong_purpose"
  | "invite.secret_missing";

export type VFinalSessionFailureReason =
  | "session.cookie_missing"
  | "session.malformed"
  | "session.invalid_signature"
  | "session.invalid_payload"
  | "session.expired"
  | "session.wrong_tenant"
  | "session.wrong_purpose"
  | "session.secret_missing";

export type VFinalInviteAccessResult =
  | {
      ok: true;
      response: NextResponse;
      participantIdHash: string;
    }
  | {
      ok: false;
      response: NextResponse;
      reason: VFinalInviteFailureReason;
    };

export type VFinalSessionAccessResult =
  | {
      ok: true;
      session: VFinalAccessSession;
    }
  | {
      ok: false;
      reason: VFinalSessionFailureReason;
    };

type InvitePayload = {
  participantId: string;
  tenant: typeof TENANT;
  purpose: typeof PURPOSE;
  exp: number;
};

type SessionPayload = {
  participantIdHash: string;
  tenant: typeof TENANT;
  purpose: typeof PURPOSE;
  exp: number;
};

export function createVFinalInviteToken(input: {
  participantId: string;
  exp: number;
  signingSecret: string;
}): string {
  return signToken(
    {
      participantId: input.participantId,
      tenant: TENANT,
      purpose: PURPOSE,
      exp: input.exp,
    },
    input.signingSecret
  );
}

export function createVFinalSessionToken(input: {
  participantIdHash: string;
  exp: number;
  signingSecret: string;
}): string {
  return signToken(
    {
      participantIdHash: input.participantIdHash,
      tenant: TENANT,
      purpose: PURPOSE,
      exp: input.exp,
    },
    input.signingSecret
  );
}

export function createVFinalInviteAccessResponse(
  request: NextRequest,
  invite: string
): VFinalInviteAccessResult {
  const env = getEnvResult();
  if (!env.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "access denied" }, { status: 403 }),
      reason: "invite.secret_missing",
    };
  }
  const parsed = verifyInviteToken(invite, env.inviteSigningSecret);
  if (!parsed.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "access denied" }, { status: 403 }),
      reason: parsed.reason,
    };
  }
  const participantIdHash = hashParticipantId(
    parsed.payload.participantId,
    env.participantHashSecret
  );
  const sessionToken = signToken(
    {
      participantIdHash,
      tenant: TENANT,
      purpose: PURPOSE,
      exp: parsed.payload.exp,
    },
    env.inviteSigningSecret
  );
  const response = NextResponse.redirect(resolvePublicUrl(request, VFINAL_UI_COOKIE_PATH));
  const maxAge = Math.max(1, parsed.payload.exp - Math.floor(Date.now() / 1000));
  const secure = process.env["NODE_ENV"] === "production";
  response.cookies.set(VFINAL_ACCESS_COOKIE, sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: VFINAL_UI_COOKIE_PATH,
    maxAge,
  });
  response.cookies.set(VFINAL_API_ACCESS_COOKIE, sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: VFINAL_API_COOKIE_PATH,
    maxAge,
  });
  return { ok: true, response, participantIdHash };
}

export function getVFinalApiAccessSession(
  request: NextRequest
): VFinalAccessSession | null {
  const result = getVFinalApiAccessSessionResult(request);
  return result.ok ? result.session : null;
}

export function getVFinalApiAccessSessionResult(
  request: NextRequest
): VFinalSessionAccessResult {
  return verifySessionCookie(
    request.cookies.get(VFINAL_API_ACCESS_COOKIE)?.value,
    "api"
  );
}

export function getVFinalUiAccessSession(
  request: NextRequest
): VFinalAccessSession | null {
  return verifyVFinalAccessCookieValue(request.cookies.get(VFINAL_ACCESS_COOKIE)?.value);
}

export function verifyVFinalAccessCookieValue(
  value: string | undefined
): VFinalAccessSession | null {
  const result = verifySessionCookie(value, "ui");
  return result.ok ? result.session : null;
}

export function hashParticipantId(participantId: string, secret: string): string {
  return createHmac("sha256", normalizeSecret(secret))
    .update(participantId)
    .digest("hex")
    .slice(0, 16);
}

function verifyInviteToken(
  token: string,
  secret: string
): { ok: true; payload: InvitePayload } | { ok: false; reason: VFinalInviteFailureReason } {
  const verified = verifyToken(token, secret);
  if (!verified.ok) return { ok: false, reason: `invite.${verified.reason}` };
  const payload = verified.payload;
  if (
    typeof payload["participantId"] !== "string" ||
    payload["participantId"].length === 0 ||
    typeof payload["exp"] !== "number"
  ) {
    return { ok: false, reason: "invite.invalid_payload" };
  }
  if (payload["tenant"] !== TENANT) return { ok: false, reason: "invite.wrong_tenant" };
  if (payload["purpose"] !== PURPOSE) return { ok: false, reason: "invite.wrong_purpose" };
  if (payload["exp"] <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "invite.expired" };
  }
  return { ok: true, payload: payload as InvitePayload };
}

function verifySessionCookie(
  token: string | undefined,
  _scope: "api" | "ui"
): VFinalSessionAccessResult {
  if (!token) return { ok: false, reason: "session.cookie_missing" };
  const env = getEnvResult();
  if (!env.ok) return { ok: false, reason: "session.secret_missing" };
  const verified = verifyToken(token, env.inviteSigningSecret);
  if (!verified.ok) {
    return {
      ok: false,
      reason:
        verified.reason === "missing"
          ? "session.cookie_missing"
          : `session.${verified.reason}`,
    };
  }
  const payload = verified.payload;
  if (
    typeof payload["participantIdHash"] !== "string" ||
    payload["participantIdHash"].length !== 16 ||
    typeof payload["exp"] !== "number"
  ) {
    return { ok: false, reason: "session.invalid_payload" };
  }
  if (payload["tenant"] !== TENANT) return { ok: false, reason: "session.wrong_tenant" };
  if (payload["purpose"] !== PURPOSE) return { ok: false, reason: "session.wrong_purpose" };
  if (payload["exp"] <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "session.expired" };
  }
  return {
    ok: true,
    session: {
      participantIdHash: payload["participantIdHash"],
      exp: payload["exp"],
    },
  };
}

function signToken(payload: InvitePayload | SessionPayload, secret: string): string {
  const normalizedSecret = normalizeSecret(secret);
  assertSecret(normalizedSecret);
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", normalizedSecret).update(encoded).digest("base64url");
  return `${TOKEN_VERSION}.${encoded}.${signature}`;
}

function verifyToken(
  token: string,
  secret: string
):
  | { ok: true; payload: Record<string, unknown> }
  | {
      ok: false;
      reason: "missing" | "malformed" | "invalid_signature" | "invalid_payload";
    } {
  const normalizedSecret = normalizeSecret(secret);
  assertSecret(normalizedSecret);
  if (!token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !parts[1] || !parts[2]) {
    return { ok: false, reason: "malformed" };
  }
  const expected = createHmac("sha256", normalizedSecret).update(parts[1]).digest("base64url");
  if (!safeEqual(parts[2], expected)) return { ok: false, reason: "invalid_signature" };
  try {
    return {
      ok: true,
      payload: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
        string,
        unknown
      >,
    };
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
}

function getEnv() {
  const result = getEnvResult();
  if (!result.ok) {
    throw new Error(
      "GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET and GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET are required in production"
    );
  }
  return result;
}

function getEnvResult():
  | {
      ok: true;
      inviteSigningSecret: string;
      participantHashSecret: string;
    }
  | { ok: false } {
  ensureEnvLoaded();
  const inviteSigningSecret =
    process.env["GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET"]?.trim() ?? "";
  const participantHashSecret =
    process.env["GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET"]?.trim() ?? "";
  if (process.env["NODE_ENV"] === "production") {
    if (inviteSigningSecret.length < 32 || participantHashSecret.length < 32) {
      return { ok: false };
    }
    return {
      ok: true,
      inviteSigningSecret,
      participantHashSecret,
    };
  }
  return {
    ok: true,
    inviteSigningSecret:
      inviteSigningSecret || process.env["XAI_RELAY_TICKET_SECRET"] || "",
    participantHashSecret:
      participantHashSecret || process.env["XAI_RELAY_TICKET_SECRET"] || "",
  };
}

function assertSecret(secret: string) {
  if (secret.length < 32) {
    throw new Error("vFinal invite/hash secrets must be at least 32 characters");
  }
}

function normalizeSecret(secret: string) {
  return secret.trim();
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function resolvePublicUrl(request: NextRequest, path: string) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? request.headers.get("host") ?? request.nextUrl.host;
  const protocol = forwardedProto ?? request.nextUrl.protocol.replace(":", "");
  return new URL(path, `${protocol}://${host}`);
}
