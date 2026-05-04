import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";

describe("haiku-fish event route", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("ENABLE_HAIKU_FISH_ROLEPLAY", "true");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logSpy.mockRestore();
  });

  it("logs structured client events with kind, sessionId, and details", async () => {
    const { POST } = await import("../../app/api/haiku-fish/event/route");
    const response = await POST(
      validRequest({
        body: {
          kind: "mic.state",
          sessionId: "hf_sess_test",
          details: { from: "listening", to: "speaking" },
        },
      })
    );
    expect(response.status).toBe(200);
    const logged = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(logged["scope"]).toBe("haikuFish.clientEvent");
    expect(logged["kind"]).toBe("mic.state");
    expect(logged["sessionId"]).toBe("hf_sess_test");
    expect(logged["details"]).toEqual({ from: "listening", to: "speaking" });
  });

  it("trims long string values in details to bound log volume", async () => {
    const { POST } = await import("../../app/api/haiku-fish/event/route");
    const huge = "x".repeat(500);
    const response = await POST(
      validRequest({
        body: { kind: "mic.error", details: { message: huge } },
      })
    );
    expect(response.status).toBe(200);
    const logged = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      details: { message: string };
    };
    expect(logged.details.message.length).toBeLessThan(500);
    expect(logged.details.message.endsWith("…")).toBe(true);
  });

  it("rejects unknown event kinds with 400", async () => {
    const { POST } = await import("../../app/api/haiku-fish/event/route");
    const response = await POST(
      validRequest({ body: { kind: "totally.fake.kind" } })
    );
    expect(response.status).toBe(400);
  });

  it("returns 401 without access cookie", async () => {
    const { POST } = await import("../../app/api/haiku-fish/event/route");
    const response = await POST(
      validRequest({ body: { kind: "mic.state" }, cookie: "" })
    );
    expect(response.status).toBe(401);
  });

  it("returns 503 when ENABLE_HAIKU_FISH_ROLEPLAY=false", async () => {
    vi.stubEnv("ENABLE_HAIKU_FISH_ROLEPLAY", "false");
    const { POST } = await import("../../app/api/haiku-fish/event/route");
    const response = await POST(
      validRequest({ body: { kind: "mic.state" } })
    );
    expect(response.status).toBe(503);
  });
});

function validRequest({
  body,
  origin = "http://127.0.0.1:3000",
  referer = "http://127.0.0.1:3000/demo/adecco-roleplay-haiku-fish",
  cookie = `roleplay_api_access=${signAccessToken("demo-secret")}`,
}: {
  body: unknown;
  origin?: string | null;
  referer?: string | null;
  cookie?: string;
}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  if (referer) headers.set("referer", referer);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest("http://127.0.0.1:3000/api/haiku-fish/event", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
