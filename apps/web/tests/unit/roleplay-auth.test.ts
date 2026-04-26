import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  signAccessToken,
  validateSameOrigin,
  verifyAccessSignature,
  verifyAccessToken,
} from "../../lib/roleplay/auth";

describe("roleplay access helpers", () => {
  it("validates configured token and cookie signature", () => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "secret-demo-token");
    expect(verifyAccessToken("secret-demo-token")).toBe(true);
    expect(verifyAccessToken("wrong")).toBe(false);
    expect(verifyAccessSignature(signAccessToken("secret-demo-token"))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("allows localhost and 127.0.0.1 loopback aliases with the same port", () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/voice/session-token", {
      headers: { origin: "http://127.0.0.1:3000" },
    });
    expect(validateSameOrigin(request)).toBe(true);

    const rejected = new NextRequest("http://127.0.0.1:3000/api/voice/session-token", {
      headers: { origin: "http://127.0.0.1:3001" },
    });
    expect(validateSameOrigin(rejected)).toBe(false);
  });

  it("uses forwarded host and proto for production origins", () => {
    const request = new NextRequest("http://0.0.0.0:8080/api/voice/session-token", {
      headers: {
        origin: "https://roleplay-ui.example.run.app",
        "x-forwarded-host": "roleplay-ui.example.run.app",
        "x-forwarded-proto": "https",
      },
    });
    expect(validateSameOrigin(request)).toBe(true);
  });
});
