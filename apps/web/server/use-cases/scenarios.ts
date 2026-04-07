import {
  BUILTIN_SCENARIO_SUMMARIES,
  toScenarioSummary,
} from "@top-performer/domain";
import { getAppContext } from "../appContext";

export async function listScenarios() {
  const ctx = getAppContext();
  const scenarios = await ctx.repositories.scenarios.listAll();
  if (scenarios.length === 0) {
    return BUILTIN_SCENARIO_SUMMARIES;
  }
  return scenarios.map(toScenarioSummary);
}

export async function getScenarioById(scenarioId: string) {
  return getAppContext().repositories.scenarios.get(scenarioId);
}
