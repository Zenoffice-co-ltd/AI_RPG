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
  const requestOrigin = request.nextUrl.origin;

  if (origin && origin !== requestOrigin) {
    return false;
  }

  if (!origin && referer) {
    try {
      return new URL(referer).origin === requestOrigin;
    } catch {
      return false;
    }
  }

  return Boolean(origin || referer);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}
