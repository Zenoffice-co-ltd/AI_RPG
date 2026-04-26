import { describe, expect, it } from "vitest";
import {
  canStartSession,
  transitionRoleplayState,
} from "../../lib/roleplay/state-machine";

describe("roleplay state machine", () => {
  it("prevents duplicate starts while connecting", () => {
    expect(transitionRoleplayState("idle", "START")).toBe("connecting");
    expect(transitionRoleplayState("connecting", "START")).toBe("connecting");
    expect(canStartSession("connecting")).toBe(false);
  });

  it("allows retry after error", () => {
    expect(transitionRoleplayState("connecting", "ERROR")).toBe("error");
    expect(canStartSession("error")).toBe(true);
  });

  it("keeps cleanup transitions idempotent", () => {
    expect(transitionRoleplayState("ending", "ENDED")).toBe("ended");
    expect(transitionRoleplayState("ended", "ENDED")).toBe("ended");
  });
});
