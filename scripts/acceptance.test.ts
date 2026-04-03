import { describe, expect, it } from "vitest";
import {
  buildBasePreflightReport,
  buildRequiredInputsBlock,
  evaluateScorecardSla,
  isLocalAppBaseUrl,
} from "./lib/acceptance";
import { resolveSecretReuseAction } from "./lib/vendorFlows";

describe("acceptance helpers", () => {
  it("flags missing secrets and project in preflight", () => {
    const report = buildBasePreflightReport({
      OPENAI_API_KEY: "",
      ELEVENLABS_API_KEY: "",
      LIVEAVATAR_API_KEY: "",
      QUEUE_SHARED_SECRET: "",
      FIREBASE_PROJECT_ID: "",
      DEFAULT_ELEVEN_VOICE_ID: "",
    });

    expect(report.ready).toBe(false);
    expect(report.blockers.map((blocker) => blocker.requiredInput)).toContain(
      "FIREBASE_PROJECT_ID"
    );
    expect(report.blockers.map((blocker) => blocker.requiredInput)).toContain(
      "DEFAULT_ELEVEN_VOICE_ID"
    );
  });

  it("prints queue defaults into the required input block", () => {
    const block = buildRequiredInputsBlock({
      GCLOUD_LOCATION: "asia-northeast1",
      CLOUD_TASKS_QUEUE_REGION: "asia-northeast1",
      CLOUD_TASKS_QUEUE_ANALYZE: "session-analysis",
    });

    expect(block).toContain("GCLOUD_LOCATION: asia-northeast1");
    expect(block).toContain(
      "Cloud Tasks queue region/name: asia-northeast1 / session-analysis"
    );
  });

  it("evaluates the 60 second scorecard SLA", () => {
    expect(evaluateScorecardSla(59_500).passed).toBe(true);
    expect(evaluateScorecardSla(60_100).passed).toBe(false);
  });

  it("detects local app base urls", () => {
    expect(isLocalAppBaseUrl("http://localhost:3000")).toBe(true);
    expect(isLocalAppBaseUrl("https://example.web.app")).toBe(false);
  });

  it("reuses an existing secret unless refresh is requested", () => {
    expect(resolveSecretReuseAction("sec_123", false)).toBe("reuse");
    expect(resolveSecretReuseAction("sec_123", true)).toBe("create");
    expect(resolveSecretReuseAction(undefined, false)).toBe("create");
  });
});
