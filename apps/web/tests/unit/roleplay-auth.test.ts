import { describe, expect, it, vi } from "vitest";
import {
  signAccessToken,
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
});
