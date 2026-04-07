import { describe, expect, it } from "vitest";
import {
  buildBasePreflightReport,
  buildRequiredInputsBlock,
  buildWhyNeededBlock,
  evaluateScorecardSla,
  isLocalAppBaseUrl,
} from "./lib/acceptance";
import { resolveSecretReuseAction } from "./lib/vendorFlows";

describe("acceptance helpers", () => {
  it("flags missing secrets and project in preflight", async () => {
    const report = await buildBasePreflightReport(
      {
        OPENAI_API_KEY: "",
        SECRET_SOURCE_PROJECT_ID: "zapier-transfer",
        ELEVENLABS_API_KEY: "",
        LIVEAVATAR_API_KEY: "",
        QUEUE_SHARED_SECRET: "",
        FIREBASE_PROJECT_ID: "",
        DEFAULT_ELEVEN_VOICE_ID: "",
      },
      {
        hasApplicationDefaultCredentials: async () => true,
        secretExists: async () => true,
      }
    );

    expect(report.ready).toBe(false);
    expect(report.blockers.map((blocker) => blocker.requiredInput)).toContain(
      "FIREBASE_PROJECT_ID"
    );
    expect(report.blockers.map((blocker) => blocker.requiredInput)).not.toContain(
      "DEFAULT_ELEVEN_VOICE_ID"
    );
  });

  it("flags firebase credential secret only when ADC is unavailable", async () => {
    const report = await buildBasePreflightReport(
      {
        SECRET_SOURCE_PROJECT_ID: "zapier-transfer",
        FIREBASE_PROJECT_ID: "adecco-prod",
        ELEVENLABS_API_KEY: "eleven",
        LIVEAVATAR_API_KEY: "liveavatar",
        QUEUE_SHARED_SECRET: "queue",
        DEFAULT_ELEVEN_VOICE_ID: "voice",
      },
      {
        hasApplicationDefaultCredentials: async () => false,
        secretExists: async () => true,
      }
    );

    expect(report.blockers.map((blocker) => blocker.requiredInput)).toContain(
      "FIREBASE_CREDENTIALS_SECRET_NAME"
    );
  });

  it("prints the minimal input block with adecco tenant and no direct OpenAI key", () => {
    const block = buildRequiredInputsBlock(
      {
        GCLOUD_LOCATION: "asia-northeast1",
        CLOUD_TASKS_QUEUE_REGION: "asia-northeast1",
        CLOUD_TASKS_QUEUE_ANALYZE: "session-analysis",
        SECRET_SOURCE_PROJECT_ID: "zapier-transfer",
      },
      {
        includeLiveAvatarCredential: true,
      }
    );

    expect(block).toContain("tenant: adecco");
    expect(block).toContain("1. FIREBASE_PROJECT_ID");
    expect(block).toContain("4. Vendor credentials");
    expect(block).toContain("LIVEAVATAR_API_KEY");
    expect(block).not.toContain("ELEVENLABS_API_KEY");
    expect(block).not.toContain("FIREBASE_CREDENTIALS_SECRET_NAME");
    expect(block).not.toContain("OPENAI_API_KEY");
  });

  it("prints queue defaults into the required input block", () => {
    const block = buildRequiredInputsBlock(
      {
        GCLOUD_LOCATION: "asia-northeast1",
        CLOUD_TASKS_QUEUE_REGION: "asia-northeast1",
        CLOUD_TASKS_QUEUE_ANALYZE: "session-analysis",
        SECRET_SOURCE_PROJECT_ID: "zapier-transfer",
      },
      {
        includeLiveAvatarCredential: true,
      }
    );

    expect(block).toContain("GCLOUD_LOCATION: asia-northeast1");
    expect(block).toContain(
      "Cloud Tasks queue region/name: asia-northeast1 / session-analysis"
    );
  });

  it("can narrow the required input block to the remaining blocker only", () => {
    const block = buildRequiredInputsBlock(
      {
        FIREBASE_PROJECT_ID: "",
        DEFAULT_ELEVEN_VOICE_ID: "voice_123",
        QUEUE_SHARED_SECRET: "queue_123",
        GCLOUD_LOCATION: "asia-northeast1",
        CLOUD_TASKS_QUEUE_REGION: "asia-northeast1",
        CLOUD_TASKS_QUEUE_ANALYZE: "session-analysis",
        SECRET_SOURCE_PROJECT_ID: "zapier-transfer",
      },
      {
        includeFirebaseProjectId: true,
        includeDefaultElevenVoiceId: false,
        includeQueueSharedSecret: false,
      }
    );

    expect(block).toContain("1. FIREBASE_PROJECT_ID");
    expect(block).not.toContain("DEFAULT_ELEVEN_VOICE_ID");
    expect(block).not.toContain("QUEUE_SHARED_SECRET");
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

  it("uses the canonical OpenAI secret as a warning instead of a blocker", async () => {
    const report = await buildBasePreflightReport(
      {
        SECRET_SOURCE_PROJECT_ID: "zapier-transfer",
        FIREBASE_PROJECT_ID: "adecco-prod",
        ELEVENLABS_API_KEY: "eleven",
        LIVEAVATAR_API_KEY: "liveavatar",
        QUEUE_SHARED_SECRET: "queue",
        DEFAULT_ELEVEN_VOICE_ID: "voice",
      },
      {
        hasApplicationDefaultCredentials: async () => true,
        secretExists: async () => true,
      }
    );

    expect(report.blockers.map((blocker) => blocker.requiredInput)).not.toContain(
      "OpenAI secret in zapier-transfer"
    );
    expect(report.warnings.join("\n")).toContain("openai-api-key-default");
  });

  it("uses the canonical ElevenLabs secret as a warning instead of a blocker", async () => {
    const report = await buildBasePreflightReport(
      {
        SECRET_SOURCE_PROJECT_ID: "zapier-transfer",
        FIREBASE_PROJECT_ID: "adecco-prod",
        LIVEAVATAR_API_KEY: "liveavatar",
        QUEUE_SHARED_SECRET: "queue",
        DEFAULT_ELEVEN_VOICE_ID: "voice",
      },
      {
        hasApplicationDefaultCredentials: async () => true,
        secretExists: async () => true,
      }
    );

    expect(report.blockers.map((blocker) => blocker.requiredInput)).not.toContain(
      "ELEVENLABS_API_KEY"
    );
    expect(report.warnings.join("\n")).toContain("projects/zapier-transfer/secrets/ELEVENLABS_API_KEY");
  });

  it("uses the canonical LiveAvatar secret as a warning instead of a blocker", async () => {
    const report = await buildBasePreflightReport(
      {
        SECRET_SOURCE_PROJECT_ID: "zapier-transfer",
        FIREBASE_PROJECT_ID: "adecco-prod",
        QUEUE_SHARED_SECRET: "queue",
        DEFAULT_ELEVEN_VOICE_ID: "voice",
      },
      {
        hasApplicationDefaultCredentials: async () => true,
        secretExists: async () => true,
      }
    );

    expect(report.blockers.map((blocker) => blocker.requiredInput)).not.toContain(
      "LIVEAVATAR_API_KEY"
    );
    expect(report.warnings.join("\n")).toContain("projects/zapier-transfer/secrets/LIVEAVATAR_API_KEY");
  });

  it("omits firebase credential rationale when ADC fallback is not needed", () => {
    const why = buildWhyNeededBlock();

    expect(why).not.toContain("FIREBASE_CREDENTIALS_SECRET_NAME");
  });

  it("can narrow the why block to only the unresolved firebase project requirement", () => {
    const why = buildWhyNeededBlock({
      includeFirebaseProjectId: true,
      includeDefaultElevenVoiceId: false,
      includeQueueSharedSecret: false,
    });

    expect(why).toContain("FIREBASE_PROJECT_ID");
    expect(why).not.toContain("DEFAULT_ELEVEN_VOICE_ID");
    expect(why).not.toContain("QUEUE_SHARED_SECRET");
  });

  it("describes DEFAULT_ELEVEN_VOICE_ID as a legacy fallback instead of a hard blocker", () => {
    const why = buildWhyNeededBlock({
      includeDefaultElevenVoiceId: true,
      includeFirebaseProjectId: false,
      includeQueueSharedSecret: false,
    });

    expect(why).toContain("legacy fallback");
    expect(why).toContain("auto-resolve");
  });
});
