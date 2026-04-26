export const ADECCO_SCENARIO_ID = "adecco-orb" as const;

export const ROLEPLAY_TITLE =
  "[Adecco Demo] 住宅設備メーカー 人事課主任 初回派遣オーダーヒアリング";

export const ROLEPLAY_DISPLAY_NAME = "MENDAN AIロープレ";

export const SESSION_LIMIT_MS = 15 * 60 * 1000;

export type ScenarioId = typeof ADECCO_SCENARIO_ID;

export function isSupportedScenarioId(value: string): value is ScenarioId {
  return value === ADECCO_SCENARIO_ID;
}
