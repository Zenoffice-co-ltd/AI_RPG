import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_ACCESS_COOKIE,
  DEMO_API_ACCESS_COOKIE,
  signAccessToken,
  verifyAccessToken,
} from "@/lib/roleplay/auth";

export async function handleDemoAccess(request: NextRequest, successPath: string) {
  const form = await request.formData();
  const rawToken = form.get("token");
  const token = typeof rawToken === "string" ? rawToken : "";

  if (!verifyAccessToken(token)) {
    return NextResponse.redirect(
      resolvePublicUrl(request, `${successPath}?access=denied`)
    );
  }

  const signature = signAccessToken(token);
  const response = NextResponse.redirect(resolvePublicUrl(request, successPath));
  const secure = process.env["NODE_ENV"] === "production";
  response.cookies.set(DEMO_ACCESS_COOKIE, signature, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/demo",
    maxAge: 60 * 60 * 8,
  });
  response.cookies.set(DEMO_API_ACCESS_COOKIE, signature, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/voice",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

function resolvePublicUrl(request: NextRequest, path: string) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? request.headers.get("host") ?? request.nextUrl.host;
  const protocol = forwardedProto ?? request.nextUrl.protocol.replace(":", "");
  return new URL(path, `${protocol}://${host}`);
}
