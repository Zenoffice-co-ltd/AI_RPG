import type { ScenarioPack } from "./schemas";

export const SCENARIO_VARIANTS = [
  "friendly_manager_easy",
  "busy_manager_medium",
  "skeptical_manager_hard",
] as const;

export type ScenarioVariant = (typeof SCENARIO_VARIANTS)[number];

export const DEFAULT_SCENARIO_IDS = {
  friendly_manager_easy: "staffing_order_hearing_friendly_manager_easy",
  busy_manager_medium: "staffing_order_hearing_busy_manager_medium",
  skeptical_manager_hard: "staffing_order_hearing_skeptical_manager_hard",
} as const satisfies Record<ScenarioVariant, string>;

export const SCENARIO_VARIANT_TITLES: Record<ScenarioVariant, string> = {
  friendly_manager_easy: "協力的な現場責任者",
  busy_manager_medium: "忙しい現場責任者",
  skeptical_manager_hard: "懐疑的な決裁関与者",
};

export function toScenarioSummary(scenario: ScenarioPack) {
  return {
    id: scenario.id,
    title: scenario.title,
    difficulty: scenario.difficulty,
    publicBrief: scenario.publicBrief,
    status: scenario.status,
  } as const;
}
