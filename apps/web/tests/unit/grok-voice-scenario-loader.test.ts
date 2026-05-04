import { describe, expect, it, beforeEach } from "vitest";
import {
  GROK_VOICE_SCENARIO_ID,
  clearGrokVoiceScenarioBundleCache,
  loadGrokVoiceScenarioBundle,
} from "../../server/grokVoice/scenarioLoader";

describe("grok-voice scenario loader", () => {
  beforeEach(() => {
    clearGrokVoiceScenarioBundleCache();
  });

  it("returns the compiled prompt + KB + first message from generated artefacts", async () => {
    const bundle = await loadGrokVoiceScenarioBundle();
    expect(bundle.scenarioId).toBe(GROK_VOICE_SCENARIO_ID);
    expect(bundle.promptVersion.length).toBeGreaterThan(0);
    expect(bundle.agentSystemPrompt.length).toBeGreaterThan(2_000);
    expect(bundle.agentSystemPrompt).toMatch(/Personality/);
    expect(bundle.agentSystemPrompt).toMatch(/Scenario/);
    expect(bundle.knowledgeBaseText.length).toBeGreaterThan(500);
    expect(bundle.firstMessage.length).toBeGreaterThan(20);

    expect(bundle.agentSystemPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.knowledgeBaseTextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.promptSectionsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same cached bundle on repeated calls", async () => {
    const a = await loadGrokVoiceScenarioBundle();
    const b = await loadGrokVoiceScenarioBundle();
    expect(b).toBe(a);
  });
});
