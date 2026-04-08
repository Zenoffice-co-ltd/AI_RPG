import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  scenariosGet,
  scenariosGetAssets,
  createTextResponse,
} = vi.hoisted(() => ({
  scenariosGet: vi.fn(),
  scenariosGetAssets: vi.fn(),
  createTextResponse: vi.fn(),
}));

vi.mock("../appContext", () => ({
  getAppContext: () => ({
    env: {
      OPENAI_ANALYSIS_MODEL: "gpt-5.4",
    },
    repositories: {
      scenarios: {
        get: scenariosGet,
        getAssets: scenariosGetAssets,
      },
    },
    vendors: {
      openAi: {
        createTextResponse,
      },
    },
  }),
}));

import {
  generateScenarioTestReply,
  getScenarioTestSetup,
} from "./scenarioTest";

describe("scenario test use-case", () => {
  beforeEach(() => {
    scenariosGet.mockReset();
    scenariosGetAssets.mockReset();
    createTextResponse.mockReset();

    scenariosGet.mockResolvedValue({
      id: "staffing_order_hearing_busy_manager_medium",
      title: "忙しい現場責任者",
      openingLine: "時間がないので要点だけお願いします。",
    });
    scenariosGetAssets.mockResolvedValue({
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      promptVersion: "v1",
      knowledgeBaseText: "kb",
      agentSystemPrompt: "Stay busy and only reveal details when asked well.",
      generatedAt: new Date().toISOString(),
    });
    createTextResponse.mockResolvedValue({
      responseId: "resp_123",
      text: "募集背景から先に教えてください。",
    });
  });

  it("returns setup data with opening line", async () => {
    const setup = await getScenarioTestSetup(
      "staffing_order_hearing_busy_manager_medium"
    );

    expect(setup?.openingLine).toBe("時間がないので要点だけお願いします。");
  });

  it("generates a reply from scenario assets and conversation history", async () => {
    const result = await generateScenarioTestReply({
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      messages: [
        {
          role: "assistant",
          text: "時間がないので要点だけお願いします。",
        },
        {
          role: "user",
          text: "募集背景を教えてください。",
        },
      ],
    });

    expect(createTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        messages: [
          {
            role: "assistant",
            text: "時間がないので要点だけお願いします。",
          },
          {
            role: "user",
            text: "募集背景を教えてください。",
          },
        ],
      })
    );
    expect(result.text).toBe("募集背景から先に教えてください。");
  });
});
