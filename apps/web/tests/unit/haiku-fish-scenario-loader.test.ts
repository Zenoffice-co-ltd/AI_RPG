import { describe, expect, it, beforeEach } from "vitest";
import {
  HAIKU_FISH_SCENARIO_ID,
  clearHaikuFishScenarioBundleCache,
  loadHaikuFishScenarioBundle,
} from "../../server/haikuFish/scenarioLoader";

describe("haiku-fish scenario loader", () => {
  beforeEach(() => {
    clearHaikuFishScenarioBundleCache();
  });

  it("returns the compiled prompt + KB + first message from generated artefacts", async () => {
    const bundle = await loadHaikuFishScenarioBundle();
    expect(bundle.scenarioId).toBe(HAIKU_FISH_SCENARIO_ID);
    expect(bundle.promptVersion.length).toBeGreaterThan(0);
    expect(bundle.agentSystemPrompt.length).toBeGreaterThan(2_000);
    // The compiled prompt is structured around "# Personality" / "# Scenario"
    // and we rely on it being self-contained.
    expect(bundle.agentSystemPrompt).toMatch(/Personality/);
    expect(bundle.agentSystemPrompt).toMatch(/Scenario/);
    expect(bundle.knowledgeBaseText.length).toBeGreaterThan(500);
    expect(bundle.firstMessage.length).toBeGreaterThan(20);

    // Hashes are non-empty hex digests (sha256 -> 64 chars).
    expect(bundle.agentSystemPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.knowledgeBaseTextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.promptSectionsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same cached bundle on repeated calls", async () => {
    const a = await loadHaikuFishScenarioBundle();
    const b = await loadHaikuFishScenarioBundle();
    expect(b).toBe(a);
  });
});
