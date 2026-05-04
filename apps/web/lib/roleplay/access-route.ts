import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_ACCESS_COOKIE,
  DEMO_API_ACCESS_COOKIE,
  signAccessToken,
  verifyAccessToken,
} from "@/lib/roleplay/auth";

export type DemoAccessCookiePaths = {
  ui: string;
  api: string;
};

const DEFAULT_COOKIE_PATHS: DemoAccessCookiePaths = {
  ui: "/demo",
  api: "/api/voice",
};

export type HandleDemoAccessOptions = {
  successPath: string;
  cookiePaths?: DemoAccessCookiePaths;
};

export async function handleDemoAccess(
  request: NextRequest,
  successPathOrOptions: string | HandleDemoAccessOptions
) {
  const options =
    typeof successPathOrOptions === "string"
      ? { successPath: successPathOrOptions, cookiePaths: DEFAULT_COOKIE_PATHS }
      : {
          successPath: successPathOrOptions.successPath,
          cookiePaths: successPathOrOptions.cookiePaths ?? DEFAULT_COOKIE_PATHS,
        };

  const form = await request.formData();
  const rawToken = form.get("token");
  const token = typeof rawToken === "string" ? rawToken : "";

  if (!verifyAccessToken(token)) {
    return NextResponse.redirect(
      resolvePublicUrl(request, `${options.successPath}?access=denied`)
    );
  }

  const signature = signAccessToken(token);
  const response = NextResponse.redirect(
    resolvePublicUrl(request, options.successPath)
  );
  const secure = process.env["NODE_ENV"] === "production";
  response.cookies.set(DEMO_ACCESS_COOKIE, signature, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: options.cookiePaths.ui,
    maxAge: 60 * 60 * 8,
  });
  response.cookies.set(DEMO_API_ACCESS_COOKIE, signature, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: options.cookiePaths.api,
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
