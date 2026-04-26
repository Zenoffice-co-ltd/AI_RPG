import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnvOrSecret: vi.fn(),
}));

vi.mock("../../server/secrets", async () => {
  const actual = await vi.importActual<typeof import("../../server/secrets")>(
    "../../server/secrets"
  );
  return {
    ...actual,
    getEnvOrSecret: mocks.getEnvOrSecret,
  };
});

describe("voice server env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("falls back to Secret Manager for the server-only API key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_AGENT_ID", "agent");
    vi.stubEnv("ELEVENLABS_BRANCH_ID", "branch");
    vi.stubEnv("ELEVENLABS_ENVIRONMENT", "production");
    vi.stubEnv("SECRET_SOURCE_PROJECT_ID", "zapier-transfer");
    mocks.getEnvOrSecret.mockResolvedValue("secret-api-key");

    const { getVoiceServerEnvWithSecretFallback } = await import(
      "../../lib/roleplay/server-env"
    );
    await expect(getVoiceServerEnvWithSecretFallback()).resolves.toMatchObject({
      ELEVENLABS_API_KEY: "secret-api-key",
      ELEVENLABS_AGENT_ID: "agent",
      ELEVENLABS_BRANCH_ID: "branch",
    });
    expect(mocks.getEnvOrSecret).toHaveBeenCalledWith(
      "ELEVENLABS_API_KEY",
      "ELEVENLABS_API_KEY",
      "zapier-transfer"
    );
  });

  it("requires the API key env in production instead of using cross-project fallback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_AGENT_ID", "agent");
    vi.stubEnv("ELEVENLABS_BRANCH_ID", "branch");
    vi.stubEnv("ELEVENLABS_ENVIRONMENT", "production");
    vi.stubEnv("SECRET_SOURCE_PROJECT_ID", "zapier-transfer");
    mocks.getEnvOrSecret.mockResolvedValue("secret-api-key");

    const { getVoiceServerEnvWithSecretFallback } = await import(
      "../../lib/roleplay/server-env"
    );
    await expect(getVoiceServerEnvWithSecretFallback()).rejects.toThrow(
      "Voice session server environment is not configured."
    );
    expect(mocks.getEnvOrSecret).not.toHaveBeenCalled();
  });

  it("uses the Cloud Run injected API key env in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ELEVENLABS_API_KEY", "cloud-run-secret-api-key");
    vi.stubEnv("ELEVENLABS_AGENT_ID", "agent");
    vi.stubEnv("ELEVENLABS_BRANCH_ID", "branch");
    vi.stubEnv("ELEVENLABS_ENVIRONMENT", "production");
    vi.stubEnv("SECRET_SOURCE_PROJECT_ID", "zapier-transfer");

    const { getVoiceServerEnvWithSecretFallback } = await import(
      "../../lib/roleplay/server-env"
    );
    await expect(getVoiceServerEnvWithSecretFallback()).resolves.toMatchObject({
      ELEVENLABS_API_KEY: "cloud-run-secret-api-key",
      ELEVENLABS_AGENT_ID: "agent",
      ELEVENLABS_BRANCH_ID: "branch",
    });
    expect(mocks.getEnvOrSecret).not.toHaveBeenCalled();
  });
});
