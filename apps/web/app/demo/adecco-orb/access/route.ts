import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_ACCESS_COOKIE,
  DEMO_API_ACCESS_COOKIE,
  signAccessToken,
  verifyAccessToken,
} from "@/lib/roleplay/auth";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const rawToken = form.get("token");
  const token = typeof rawToken === "string" ? rawToken : "";

  if (!verifyAccessToken(token)) {
    return NextResponse.redirect(new URL("/demo/adecco-orb?access=denied", request.url));
  }

  const signature = signAccessToken(token);
  const response = NextResponse.redirect(new URL("/demo/adecco-orb", request.url));
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
