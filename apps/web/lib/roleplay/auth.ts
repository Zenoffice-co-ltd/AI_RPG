import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const DEMO_ACCESS_COOKIE = "roleplay_access";
export const DEMO_API_ACCESS_COOKIE = "roleplay_api_access";
const COOKIE_SECRET_FALLBACK = "roleplay-demo-access-v1";

export function isDemoAccessConfigured() {
  return Boolean(process.env["DEMO_ACCESS_TOKEN"]);
}

export function shouldRequireDemoAccess() {
  return process.env["NODE_ENV"] === "production" || isDemoAccessConfigured();
}

export function signAccessToken(token: string) {
  return createHmac("sha256", process.env["DEMO_ACCESS_TOKEN"] ?? COOKIE_SECRET_FALLBACK)
    .update(token)
    .digest("hex");
}

export function verifyAccessToken(input: string) {
  const expected = process.env["DEMO_ACCESS_TOKEN"];
  if (!expected) {
    return process.env["NODE_ENV"] !== "production";
  }
  return safeEqual(input, expected);
}

export function verifyAccessSignature(signature: string | undefined) {
  if (!shouldRequireDemoAccess()) {
    return true;
  }
  if (!signature) {
    return false;
  }
  const token = process.env["DEMO_ACCESS_TOKEN"];
  if (!token) {
    return false;
  }
  return safeEqual(signature, signAccessToken(token));
}

export function hasDemoAccess(request: NextRequest) {
  return verifyAccessSignature(request.cookies.get(DEMO_ACCESS_COOKIE)?.value);
}

export function hasDemoApiAccess(request: NextRequest) {
  return verifyAccessSignature(
    request.cookies.get(DEMO_API_ACCESS_COOKIE)?.value ??
      request.cookies.get(DEMO_ACCESS_COOKIE)?.value
  );
}

export function validateSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const requestOrigin = resolveRequestOrigin(request);

  if (origin && !sameOriginOrLoopbackAlias(origin, requestOrigin)) {
    return false;
  }

  if (!origin && referer) {
    try {
      return sameOriginOrLoopbackAlias(new URL(referer).origin, requestOrigin);
    } catch {
      return false;
    }
  }

  return Boolean(origin || referer);
}

function sameOriginOrLoopbackAlias(left: string, right: string) {
  if (left === right) {
    return true;
  }

  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    const isLoopbackPair =
      isLoopbackHost(leftUrl.hostname) && isLoopbackHost(rightUrl.hostname);
    return (
      isLoopbackPair &&
      leftUrl.protocol === rightUrl.protocol &&
      leftUrl.port === rightUrl.port
    );
  } catch {
    return false;
  }
}

function resolveRequestOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) {
    return request.nextUrl.origin;
  }
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${forwardedProto}://${forwardedHost}`;
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}
