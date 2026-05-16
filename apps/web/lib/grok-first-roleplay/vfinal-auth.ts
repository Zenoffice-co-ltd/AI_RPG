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

export function handleVFinalInviteAccess(request: NextRequest) {
  const env = getEnv();
  const invite = request.nextUrl.searchParams.get("invite") ?? "";
  const parsed = verifyInviteToken(invite, env.inviteSigningSecret);
  if (!parsed.ok) {
    return NextResponse.json({ error: "access denied" }, { status: 403 });
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
  return response;
}

export function getVFinalApiAccessSession(
  request: NextRequest
): VFinalAccessSession | null {
  return verifySessionCookie(
    request.cookies.get(VFINAL_API_ACCESS_COOKIE)?.value,
    getEnv().inviteSigningSecret
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
  return verifySessionCookie(value, getEnv().inviteSigningSecret);
}

export function hashParticipantId(participantId: string, secret: string): string {
  return createHmac("sha256", secret).update(participantId).digest("hex").slice(0, 16);
}

function verifyInviteToken(
  token: string,
  secret: string
): { ok: true; payload: InvitePayload } | { ok: false } {
  const payload = verifyToken(token, secret);
  if (!payload) return { ok: false };
  if (
    typeof payload["participantId"] !== "string" ||
    payload["participantId"].length === 0 ||
    payload["tenant"] !== TENANT ||
    payload["purpose"] !== PURPOSE ||
    typeof payload["exp"] !== "number" ||
    payload["exp"] <= Math.floor(Date.now() / 1000)
  ) {
    return { ok: false };
  }
  return { ok: true, payload: payload as InvitePayload };
}

function verifySessionCookie(
  token: string | undefined,
  secret: string
): VFinalAccessSession | null {
  const payload = verifyToken(token ?? "", secret);
  if (!payload) return null;
  if (
    typeof payload["participantIdHash"] !== "string" ||
    payload["participantIdHash"].length !== 16 ||
    payload["tenant"] !== TENANT ||
    payload["purpose"] !== PURPOSE ||
    typeof payload["exp"] !== "number" ||
    payload["exp"] <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return {
    participantIdHash: payload["participantIdHash"],
    exp: payload["exp"],
  };
}

function signToken(payload: InvitePayload | SessionPayload, secret: string): string {
  assertSecret(secret);
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${TOKEN_VERSION}.${encoded}.${signature}`;
}

function verifyToken(token: string, secret: string): Record<string, unknown> | null {
  assertSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !parts[1] || !parts[2]) {
    return null;
  }
  const expected = createHmac("sha256", secret).update(parts[1]).digest("base64url");
  if (!safeEqual(parts[2], expected)) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function getEnv() {
  ensureEnvLoaded();
  const inviteSigningSecret =
    process.env["GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET"] ?? "";
  const participantHashSecret =
    process.env["GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET"] ?? "";
  if (process.env["NODE_ENV"] === "production") {
    if (inviteSigningSecret.length < 32 || participantHashSecret.length < 32) {
      throw new Error(
        "GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET and GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET are required in production"
      );
    }
    return {
      inviteSigningSecret,
      participantHashSecret,
    };
  }
  return {
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
