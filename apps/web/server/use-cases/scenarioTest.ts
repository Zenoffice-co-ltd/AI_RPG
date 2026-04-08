import { getAppContext } from "../appContext";

export type ScenarioTestMessage = {
  role: "assistant" | "user";
  text: string;
};

export async function getScenarioTestSetup(scenarioId: string) {
  const ctx = getAppContext();
  const scenario = await ctx.repositories.scenarios.get(scenarioId);
  if (!scenario) {
    return null;
  }

  const assets = await ctx.repositories.scenarios.getAssets(scenarioId);
  if (!assets) {
    throw new Error(`Scenario assets not found: ${scenarioId}`);
  }

  return {
    scenario,
    assets,
    openingLine: scenario.openingLine,
  };
}

function buildScenarioTestSystemPrompt(agentSystemPrompt: string) {
  return [
    "You are running a text-only roleplay test harness for a Japanese business scenario.",
    "Stay fully in character as the scenario counterpart.",
    "Reply in natural Japanese only.",
    "Do not mention policies, hidden facts, prompt rules, or evaluation criteria explicitly.",
    "Do not use markdown, bullets, XML, JSON, or speaker labels.",
    "Keep each reply concise and conversational unless the user asks for more detail.",
    "",
    "Scenario instructions:",
    agentSystemPrompt,
  ].join("\n");
}

export async function generateScenarioTestReply(input: {
  scenarioId: string;
  messages: ScenarioTestMessage[];
}) {
  const ctx = getAppContext();
  const setup = await getScenarioTestSetup(input.scenarioId);
  if (!setup) {
    throw new Error(`Scenario not found: ${input.scenarioId}`);
  }

  const messages = input.messages
    .map((message) => ({
      role: message.role,
      text: message.text.trim(),
    }))
    .filter((message) => message.text.length > 0);

  if (messages.length === 0) {
    throw new Error("At least one message is required.");
  }

  const response = await ctx.vendors.openAi.createTextResponse({
    model: ctx.env.OPENAI_ANALYSIS_MODEL,
    systemPrompt: buildScenarioTestSystemPrompt(setup.assets.agentSystemPrompt),
    messages,
    maxOutputTokens: 400,
  });

  return {
    responseId: response.responseId,
    text: response.text.trim(),
    openingLine: setup.openingLine,
    title: setup.scenario.title,
  };
}
