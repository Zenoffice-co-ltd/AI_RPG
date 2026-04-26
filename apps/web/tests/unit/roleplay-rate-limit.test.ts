import { beforeEach, describe, expect, it } from "vitest";
import {
  checkSessionTokenRateLimit,
  resetSessionTokenRateLimit,
} from "../../lib/roleplay/rate-limit";

describe("roleplay rate limit", () => {
  beforeEach(() => resetSessionTokenRateLimit());

  it("limits session token issuance per minute", () => {
    expect(checkSessionTokenRateLimit("ip:cookie", 0).allowed).toBe(true);
    expect(checkSessionTokenRateLimit("ip:cookie", 1).allowed).toBe(true);
    expect(checkSessionTokenRateLimit("ip:cookie", 2).allowed).toBe(true);
    expect(checkSessionTokenRateLimit("ip:cookie", 3).allowed).toBe(false);
  });
});
