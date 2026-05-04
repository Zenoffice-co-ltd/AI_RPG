import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDemoAccess } from "../../lib/roleplay/access-route";

function buildFormRequest(token: string) {
  const body = new URLSearchParams({ token }).toString();
  return new NextRequest("http://127.0.0.1:3000/demo/adecco-roleplay-v3/access", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://127.0.0.1:3000",
    },
    body,
  });
}

function listSetCookies(response: Response) {
  const headerEntries = response.headers.getSetCookie?.() ?? [];
  if (headerEntries.length > 0) return headerEntries;
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

describe("grok-voice access route", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("scopes UI cookie to /demo/adecco-roleplay-v3 and API cookie to /api/v3", async () => {
    const response = await handleDemoAccess(buildFormRequest("demo-secret"), {
      successPath: "/demo/adecco-roleplay-v3",
      cookiePaths: {
        ui: "/demo/adecco-roleplay-v3",
        api: "/api/v3",
      },
    });

    expect(response.status).toBe(307);
    const setCookieHeaders = listSetCookies(response);
    const accessCookie = setCookieHeaders.find((value) =>
      value.startsWith("roleplay_access=")
    );
    const apiCookie = setCookieHeaders.find((value) =>
      value.startsWith("roleplay_api_access=")
    );
    expect(accessCookie).toMatch(/Path=\/demo\/adecco-roleplay-v3/);
    expect(apiCookie).toMatch(/Path=\/api\/v3/);
  });

  it("redirects to ?access=denied when the token does not match", async () => {
    const response = await handleDemoAccess(buildFormRequest("nope"), {
      successPath: "/demo/adecco-roleplay-v3",
      cookiePaths: {
        ui: "/demo/adecco-roleplay-v3",
        api: "/api/v3",
      },
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/access=denied/);
  });
});
