import { NextResponse } from "next/server";
import { getAppContext } from "./appContext";

function decodeBasicAuth(authorizationHeader: string) {
  const [scheme, value] = authorizationHeader.split(" ");
  if (scheme !== "Basic" || !value) {
    return null;
  }

  const [username, password] = Buffer.from(value, "base64")
    .toString("utf8")
    .split(":");

  return { username, password };
}

export function isAdminAuthorized(authorizationHeader?: string | null) {
  if (!authorizationHeader) {
    return false;
  }

  const decoded = decodeBasicAuth(authorizationHeader);
  if (!decoded) {
    return false;
  }

  const {
    env: { ADMIN_BASIC_AUTH_PASS, ADMIN_BASIC_AUTH_USER },
  } = getAppContext();
  return (
    decoded.username === ADMIN_BASIC_AUTH_USER &&
    decoded.password === ADMIN_BASIC_AUTH_PASS
  );
}

export function unauthorizedResponse() {
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
