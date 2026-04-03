import { DEFAULT_SCENARIO_IDS, toScenarioSummary } from "@top-performer/domain";
import type { PublicScenarioSummary } from "@top-performer/domain";
import { getAppContext } from "../appContext";

const fallbackScenarios: PublicScenarioSummary[] = [
  {
    id: DEFAULT_SCENARIO_IDS.friendly_manager_easy,
    title: "協力的な現場責任者",
    difficulty: "easy",
    publicBrief: "協力的な相手との初級シナリオ",
    status: "draft",
  },
  {
    id: DEFAULT_SCENARIO_IDS.busy_manager_medium,
    title: "忙しい現場責任者",
    difficulty: "medium",
    publicBrief: "時間制約のある中級シナリオ",
    status: "draft",
  },
  {
    id: DEFAULT_SCENARIO_IDS.skeptical_manager_hard,
    title: "懐疑的な決裁関与者",
    difficulty: "hard",
    publicBrief: "制約が隠れている上級シナリオ",
    status: "draft",
  },
];

export async function listScenarios() {
  const ctx = getAppContext();
  const scenarios = await ctx.repositories.scenarios.listAll();
  if (scenarios.length === 0) {
    return fallbackScenarios;
  }
  return scenarios.map(toScenarioSummary);
}

export async function getScenarioById(scenarioId: string) {
  return getAppContext().repositories.scenarios.get(scenarioId);
}
