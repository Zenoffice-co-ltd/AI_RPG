import { NextResponse, type NextRequest } from "next/server";

function isAuthorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  const value = authorization.slice("Basic ".length);
  const [username, password] = Buffer.from(value, "base64")
    .toString("utf8")
    .split(":");

  return (
    username === process.env["ADMIN_BASIC_AUTH_USER"] &&
    password === process.env["ADMIN_BASIC_AUTH_PASS"]
  );
}

export function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api/admin")
  ) {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Basic realm="admin"',
          },
        }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
