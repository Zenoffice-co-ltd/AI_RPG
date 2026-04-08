import {
  ACCOUNTING_SCENARIO_FAMILY,
  ACCOUNTING_SCENARIO_ID,
  type ScenarioPackV2,
} from "./phase34";
import type { PublicScenarioSummary, ScenarioPack } from "./schemas";

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

export const ACCOUNTING_SCENARIO_IDS = {
  busy_manager_medium: ACCOUNTING_SCENARIO_ID,
} as const;

export const CORPUS_SOURCE_OF_TRUTH = {
  enterpriseAccountingApGoldV1: "enterprise_accounting_ap_gold_v1",
} as const;

export const SCENARIO_VARIANT_TITLES: Record<ScenarioVariant, string> = {
  friendly_manager_easy: "協力的な現場責任者",
  busy_manager_medium: "忙しい現場責任者",
  skeptical_manager_hard: "懐疑的な決裁関与者",
};

export const ACCOUNTING_SCENARIO_TITLES = {
  busy_manager_medium: "経理事務 AP 忙しい現場責任者",
} as const;

export const BUILTIN_SCENARIO_SUMMARIES: PublicScenarioSummary[] = [
  {
    id: DEFAULT_SCENARIO_IDS.friendly_manager_easy,
    title: SCENARIO_VARIANT_TITLES.friendly_manager_easy,
    difficulty: "easy",
    publicBrief: "協力的な相手との初級シナリオ",
    status: "draft",
  },
  {
    id: DEFAULT_SCENARIO_IDS.busy_manager_medium,
    title: SCENARIO_VARIANT_TITLES.busy_manager_medium,
    difficulty: "medium",
    publicBrief: "時間制約のある中級シナリオ",
    status: "draft",
  },
  {
    id: DEFAULT_SCENARIO_IDS.skeptical_manager_hard,
    title: SCENARIO_VARIANT_TITLES.skeptical_manager_hard,
    difficulty: "hard",
    publicBrief: "制約が隠れている上級シナリオ",
    status: "draft",
  },
  {
    id: ACCOUNTING_SCENARIO_ID,
    title: ACCOUNTING_SCENARIO_TITLES.busy_manager_medium,
    difficulty: "medium",
    publicBrief:
      "enterprise 会計の支払・経費精算ユニットを題材に、真因・判断業務・カルチャーフィットまで深掘りするシナリオ",
    status: "draft",
  },
];

export const PUBLISHABLE_SCENARIO_IDS = [
  DEFAULT_SCENARIO_IDS.busy_manager_medium,
  ACCOUNTING_SCENARIO_ID,
] as const;

export function toScenarioSummary(scenario: ScenarioPack | ScenarioPackV2) {
  return {
    id: scenario.id,
    title: scenario.title,
    difficulty:
      "difficulty" in scenario
        ? scenario.difficulty
        : scenario.persona.demeanor === "skeptical"
          ? "hard"
          : scenario.persona.demeanor === "busy"
            ? "medium"
            : "easy",
    publicBrief: scenario.publicBrief,
    status: "status" in scenario ? scenario.status : "draft",
  } as const;
}

export function isAccountingScenarioFamily(family: string) {
  return family === ACCOUNTING_SCENARIO_FAMILY;
}

export function toScenarioSummaryV2(scenario: ScenarioPackV2) {
  return {
    id: scenario.id,
    title: scenario.title,
    difficulty: scenario.persona.demeanor === "busy" ? "medium" : "easy",
    publicBrief: scenario.publicBrief,
    status: "draft" as const,
    family: ACCOUNTING_SCENARIO_FAMILY,
  } as const;
}
