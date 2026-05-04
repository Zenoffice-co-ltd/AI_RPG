import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDemoAccess } from "../../lib/roleplay/access-route";

function buildFormRequest(token: string) {
  const body = new URLSearchParams({ token }).toString();
  return new NextRequest("http://127.0.0.1:3000/demo/adecco-roleplay-haiku-fish/access", {
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

describe("haiku-fish access route", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("scopes UI cookie to /demo/adecco-roleplay-haiku-fish and API cookie to /api/haiku-fish", async () => {
    const response = await handleDemoAccess(buildFormRequest("demo-secret"), {
      successPath: "/demo/adecco-roleplay-haiku-fish",
      cookiePaths: {
        ui: "/demo/adecco-roleplay-haiku-fish",
        api: "/api/haiku-fish",
      },
    });

    expect(response.status).toBe(307); // redirect
    const setCookieHeaders = listSetCookies(response);
    const accessCookie = setCookieHeaders.find((value) =>
      value.startsWith("roleplay_access=")
    );
    const apiCookie = setCookieHeaders.find((value) =>
      value.startsWith("roleplay_api_access=")
    );
    expect(accessCookie).toMatch(/Path=\/demo\/adecco-roleplay-haiku-fish/);
    expect(apiCookie).toMatch(/Path=\/api\/haiku-fish/);
  });

  it("preserves the existing /demo + /api/voice cookie paths when called with the legacy string signature", async () => {
    const response = await handleDemoAccess(
      buildFormRequest("demo-secret"),
      "/demo/adecco-roleplay"
    );
    const setCookieHeaders = listSetCookies(response);
    const accessCookie = setCookieHeaders.find((value) =>
      value.startsWith("roleplay_access=")
    );
    const apiCookie = setCookieHeaders.find((value) =>
      value.startsWith("roleplay_api_access=")
    );
    expect(accessCookie).toMatch(/Path=\/demo(;|$)/);
    expect(apiCookie).toMatch(/Path=\/api\/voice(;|$)/);
  });

  it("redirects to ?access=denied when the token does not match", async () => {
    const response = await handleDemoAccess(buildFormRequest("nope"), {
      successPath: "/demo/adecco-roleplay-haiku-fish",
      cookiePaths: {
        ui: "/demo/adecco-roleplay-haiku-fish",
        api: "/api/haiku-fish",
      },
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/access=denied/);
    // No auth cookies issued on denial.
    const setCookieHeaders = listSetCookies(response);
    expect(setCookieHeaders.find((c) => c.startsWith("roleplay_access="))).toBeUndefined();
  });
});
