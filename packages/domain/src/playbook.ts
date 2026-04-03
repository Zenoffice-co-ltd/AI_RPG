import { STAFFING_ORDER_HEARING_TAXONOMY } from "./taxonomy";

export const REQUIRED_ITEM_THRESHOLD = 0.7;
export const RECOMMENDED_ITEM_THRESHOLD = 0.4;
export const PLAYBOOK_PROMPT_VERSION = "extract-behaviors@2026-04-02.v1";
export const AGGREGATE_PLAYBOOK_PROMPT_VERSION =
  "aggregate-playbook@2026-04-02.v1";
export const COMPILE_SCENARIO_PROMPT_VERSION =
  "compile-scenario@2026-04-02.v1";
export const GRADE_SESSION_PROMPT_VERSION = "grade-session@2026-04-02.v1";

export const DEFAULT_RUBRIC_WEIGHTS = [
  {
    key: "coverage",
    label: "Coverage",
    weight: 0.3,
    description: "必要確認事項を取りこぼさず押さえられているか",
  },
  {
    key: "depth",
    label: "Depth",
    weight: 0.2,
    description: "表面的な確認で終わらず制約や背景まで踏み込めているか",
  },
  {
    key: "ordering",
    label: "Ordering",
    weight: 0.15,
    description: "トップ基準に近い順番で論点を展開できているか",
  },
  {
    key: "decision_process_clarity",
    label: "Decision Process Clarity",
    weight: 0.1,
    description: "決裁者・選考フロー・意思決定条件が明確になっているか",
  },
  {
    key: "constraint_discovery",
    label: "Constraint Discovery",
    weight: 0.1,
    description: "採用難度・NG条件・競合・予算など制約を拾えているか",
  },
  {
    key: "recap_confirmation",
    label: "Recap Confirmation",
    weight: 0.05,
    description: "会話の途中または終盤で整理と確認ができているか",
  },
  {
    key: "next_step_commitment",
    label: "Next Step Commitment",
    weight: 0.1,
    description: "次アクションが曖昧にならず合意できているか",
  },
] as const;

export const DEFAULT_WINNING_MOVES = [
  {
    key: "ladder_deadline_after_start_date",
    label: "開始時期の直後に充足期限へ進む",
    description: "開始時期を確認した直後に本当の期限と緊急度を確認する。",
  },
  {
    key: "clarify_decision_path_before_close",
    label: "締め前に決裁経路を明確化",
    description: "次アクションに進む前に誰が決めるかを曖昧にしない。",
  },
  {
    key: "separate_required_and_preferred_skills",
    label: "必須と歓迎条件を切り分ける",
    description: "スキル条件を採否に直結する軸へ整理する。",
  },
] as const;

export const DEFAULT_ANTI_PATTERNS = [
  {
    key: "shallow_requirement_dump",
    label: "浅い要件確認で終了",
    description: "情報を列挙するだけで背景や制約の確認に進まない。",
  },
  {
    key: "premature_pitch",
    label: "深掘り前の提案先行",
    description: "要件が固まる前に候補者提案や営業トークへ寄ってしまう。",
  },
  {
    key: "missing_recap",
    label: "要約確認なしで終了",
    description: "認識合わせをせずに会話を終えてしまう。",
  },
] as const;

export const DEFAULT_TAXONOMY_LABELS = Object.fromEntries(
  STAFFING_ORDER_HEARING_TAXONOMY.map((item) => [item.key, item.label])
) as Record<(typeof STAFFING_ORDER_HEARING_TAXONOMY)[number]["key"], string>;
