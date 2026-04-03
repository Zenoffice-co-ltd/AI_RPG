export const STAFFING_ORDER_HEARING_TAXONOMY_VERSION = "2026-04-02.v1";

export const STAFFING_ORDER_HEARING_TAXONOMY = [
  { key: "opening", label: "導入" },
  { key: "rapport", label: "ラポール形成" },
  { key: "hiring_background", label: "採用背景" },
  { key: "headcount", label: "採用人数" },
  { key: "start_date", label: "開始時期" },
  { key: "urgency", label: "緊急度" },
  { key: "fill_deadline", label: "充足期限" },
  { key: "required_skills", label: "必須スキル" },
  { key: "preferred_skills", label: "歓迎スキル" },
  { key: "unacceptable_conditions", label: "NG条件" },
  { key: "work_conditions", label: "就業条件" },
  { key: "shift_or_hours", label: "シフト・時間帯" },
  { key: "onboarding", label: "立ち上がり支援" },
  { key: "team_structure", label: "チーム構成" },
  { key: "selection_flow", label: "選考フロー" },
  { key: "decision_maker", label: "決裁者" },
  { key: "competing_agencies", label: "競合状況" },
  { key: "budget_flexibility", label: "予算柔軟性" },
  { key: "recap_confirmation", label: "要約確認" },
  { key: "next_step_commitment", label: "次アクション合意" },
] as const;

export const TAXONOMY_KEYS = STAFFING_ORDER_HEARING_TAXONOMY.map(
  (item) => item.key
);

export type TaxonomyKey = (typeof STAFFING_ORDER_HEARING_TAXONOMY)[number]["key"];
