import type {
  PlaybookNorms,
  ScenarioPack,
  Scorecard,
  SessionTurn,
} from "@top-performer/domain";
import { scorecardSchema } from "@top-performer/domain";
import type { OpenAiResponsesClient } from "@top-performer/vendors";
import { GRADE_SESSION_PROMPT_VERSION } from "@top-performer/domain";
import { buildDrills } from "./buildDrills";
import { loadPromptAsset } from "./promptLoader";
import {
  gradeSessionJsonSchema,
  gradeSessionResponseSchema,
} from "./schemas";

type GradeSessionInput = {
  client: OpenAiResponsesClient;
  model: string;
  sessionId: string;
  scenario: ScenarioPack;
  playbook: PlaybookNorms;
  turns: SessionTurn[];
};

export async function gradeSession(input: GradeSessionInput): Promise<Scorecard> {
  const prompt = await loadPromptAsset("grade-session.md");

  const rawScorecard = await input.client.createStructuredOutput({
    model: input.model,
    schemaName: "scorecard",
    jsonSchema: gradeSessionJsonSchema,
    responseSchema: gradeSessionResponseSchema,
    systemPrompt: prompt,
    userPrompt: JSON.stringify(
      {
        promptVersion: GRADE_SESSION_PROMPT_VERSION,
        sessionId: input.sessionId,
        scenario: input.scenario,
        playbook: input.playbook,
        turns: input.turns,
      },
      null,
      2
    ),
  });

  const scorecard = scorecardSchema.parse({
    ...rawScorecard,
    sessionId: input.sessionId,
    scenarioId: input.scenario.id,
    generatedAt: new Date().toISOString(),
    promptVersion: GRADE_SESSION_PROMPT_VERSION,
  });

  return {
    ...scorecard,
    nextDrills: buildDrills({
      scenario: input.scenario,
      scorecard,
    }),
  };
}
