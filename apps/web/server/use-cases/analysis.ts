import { gradeAccountingSession, gradeSession } from "@top-performer/scoring";
import {
  ACCOUNTING_SCENARIO_FAMILY,
  resultResponseSchema,
} from "@top-performer/domain";
import { getAppContext } from "../appContext";

export async function analyzeSession(sessionId: string) {
  const ctx = getAppContext();
  const transition = await ctx.repositories.sessions.transitionToAnalysisRunning(
    sessionId
  );
  if (!transition) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const { session, lockAcquired } = transition;
  const existingScorecard = await ctx.repositories.sessions.getScorecard(sessionId);

  if (session.status === "completed") {
    return resultResponseSchema.parse({
      sessionId,
      status: "completed",
      scorecard: existingScorecard ?? undefined,
    });
  }

  if (existingScorecard?.promptVersion === session.analysisVersion) {
    await ctx.repositories.sessions.update(sessionId, {
      status: "completed",
    });
    return resultResponseSchema.parse({
      sessionId,
      status: "completed",
      scorecard: existingScorecard,
    });
  }

  if (!lockAcquired) {
    return resultResponseSchema.parse({
      sessionId,
      status: session.status,
      scorecard: existingScorecard ?? undefined,
    });
  }

  try {
    const turns = await ctx.repositories.sessions.listTurns(sessionId);
    const scenario = await ctx.repositories.scenarios.get(session.scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${session.scenarioId}`);
    }

    const playbook = await ctx.repositories.playbooks.get(
      scenario.generatedFromPlaybookVersion
    );
    if (!playbook) {
      throw new Error(
        `Playbook not found: ${scenario.generatedFromPlaybookVersion}`
      );
    }

    const scorecard =
      scenario.family === ACCOUNTING_SCENARIO_FAMILY
        ? await gradeAccountingSession({
            client: ctx.vendors.openAi,
            model: ctx.env.OPENAI_ANALYSIS_MODEL,
            sessionId,
            scenario,
            playbook,
            turns,
          })
        : await gradeSession({
            client: ctx.vendors.openAi,
            model: ctx.env.OPENAI_ANALYSIS_MODEL,
            sessionId,
            scenario,
            playbook,
            turns,
          });

    await ctx.repositories.sessions.saveScorecard(scorecard);
    await ctx.repositories.sessions.update(sessionId, {
      status: "completed",
      error: undefined,
    });

    return resultResponseSchema.parse({
      sessionId,
      status: "completed",
      scorecard,
    });
  } catch (error) {
    await ctx.repositories.sessions.update(sessionId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown analysis error",
    });
    throw error;
  }
}

export async function getSessionResult(sessionId: string) {
  const ctx = getAppContext();
  const session = await ctx.repositories.sessions.get(sessionId);
  if (!session) {
    return null;
  }

  const scorecard = await ctx.repositories.sessions.getScorecard(sessionId);
  return resultResponseSchema.parse({
    sessionId,
    status: session.status,
    scorecard: scorecard ?? undefined,
  });
}
