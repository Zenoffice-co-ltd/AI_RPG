/**
 * 27 項目 mustCapture 自動カバレッジ採点 (DoD 5)
 *
 * 学習者 (user) の発話 + AI クライアント (avatar) の応答を transcript として渡し、
 * 各 canonicalId に対して `regexPatterns` / `negativePatterns` / `combineWith`
 * を評価して hit / partial / miss を決定する。LLM judge には依存しない、
 * 完全に決定論的なロジック。
 *
 * 単純な単語一致では PASS にしない：
 *   - decision_structure は「人事主導」と「現場課長」の両方が揃って初めて hit
 *   - competing_agencies は学習者が比較質問をしたうえで AI が比較中であると返した場合のみ hit
 *
 * critical items 11 個は required: 100% 必須。1 つでも miss なら
 * `criticalItemsCoverage < 1.0` となり閾値判定が不合格になる。
 */

import type { SessionTurn } from "@top-performer/domain";

export interface MustCaptureDefinition {
  canonicalId: string;
  labelJa: string;
  required: boolean;
  /** Critical items must reach 100% required coverage to release. */
  critical: boolean;
  /** Patterns the learner (user) is expected to ask. */
  regexPatterns: RegExp[];
  /** Patterns that, when matched, indicate a false-positive (do NOT count as hit). */
  negativePatterns: RegExp[];
  /** Sample utterances that should clearly count as evidence — used in tests. */
  acceptableEvidenceExamples: string[];
  /** Common ASR distortions the matcher should still accept. */
  asrVariants: string[];
  /**
   * For combined criteria, list other canonicalIds whose evidence is also
   * required for this item to count. `combineRule: 'all'` requires every
   * listed item; `'any'` requires at least one.
   */
  combineRule?: "all" | "any";
  combineWith?: string[];
  /**
   * Patterns the AI client (avatar) is expected to surface when answering
   * the learner correctly. Used to validate that the question was actually
   * answered, not just asked.
   */
  expectedAvatarPatterns?: RegExp[];
}

export interface StaffingCoverageResult {
  totalCoverage: number;
  requiredCoverage: number;
  criticalItemsCoverage: number;
  missingRequiredItems: string[];
  missingCriticalItems: string[];
  detectedItems: Record<string, { evidenceQuotes: string[] }>;
  falsePositiveWarnings: string[];
  passThreshold: {
    required: number;
    critical: number;
  };
  passed: boolean;
}

const STAFFING_PASS_THRESHOLD = {
  required: 0.9,
  critical: 1.0,
} as const;

export const STAFFING_MUST_CAPTURE_ITEMS: MustCaptureDefinition[] = [
  {
    canonicalId: "hiring_background",
    labelJa: "募集背景",
    required: true,
    critical: true,
    regexPatterns: [/募集.{0,2}背景/, /なぜ.{0,4}募集/, /なぜ.{0,4}相談/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["募集背景を教えてください", "なぜ今回ご相談に至ったのでしょうか"],
    asrVariants: ["背景を", "経緯を"],
    expectedAvatarPatterns: [/増員|交代|供給|レスポンス|稼働/],
  },
  {
    canonicalId: "increase_or_replacement_reason",
    labelJa: "増員・交代と理由",
    required: true,
    critical: false,
    regexPatterns: [/増員|交代|欠員|退職|補充/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["増員ですか、それとも交代の補充でしょうか"],
    asrVariants: ["新規採用", "新しく"],
  },
  {
    canonicalId: "role_and_task_scope",
    labelJa: "職種・業務の大枠",
    required: true,
    critical: true,
    regexPatterns: [/営業事務|職種|どんな業務|お仕事の内容/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["職種としては営業事務とのことですが、業務の大枠を教えてください"],
    asrVariants: ["職種は", "業務範囲"],
  },
  {
    canonicalId: "task_details_and_daily_flow",
    labelJa: "業務内容・一日の流れ",
    required: true,
    critical: false,
    regexPatterns: [/具体的に|主業務|内訳|どれが中心|一日の流れ|1日の流れ/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["具体的に、受発注、納期調整、在庫確認、対外対応のどれが主業務になりますか"],
    asrVariants: ["分解", "業務割合"],
    expectedAvatarPatterns: [/受発注入力|納期調整|在庫確認/],
  },
  {
    canonicalId: "volume_and_peak_cycle",
    labelJa: "業務量・繁忙サイクル",
    required: true,
    critical: true,
    regexPatterns: [/件数|月.{0,4}件|繁忙|波形|サイクル|ピーク|忙しい時期/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["件数や繁忙サイクルはどんな感じですか"],
    asrVariants: ["量は", "山は", "ボリューム"],
    expectedAvatarPatterns: [/六百|七百|月末|月初|月曜午前|商材切替/],
  },
  {
    canonicalId: "handover_method_and_period",
    labelJa: "引継ぎ方法・期間",
    required: true,
    critical: false,
    regexPatterns: [/引継ぎ|引き継ぎ|オージェーティー|OJT|立ち上がり|オン.?ボーディング/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["引継ぎはどのように進めますか"],
    asrVariants: ["立ち上げ", "重なり期間"],
  },
  {
    canonicalId: "start_date_and_term",
    labelJa: "就業開始日・期間",
    required: true,
    critical: true,
    regexPatterns: [/開始日|いつから|スタート|開始時期|期間/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["開始日はいつ頃を想定されていますか"],
    asrVariants: ["着任", "稼働開始"],
    expectedAvatarPatterns: [/六月|来月|月一日/],
  },
  {
    canonicalId: "work_days_hours_break",
    labelJa: "就業曜日・時間・休憩",
    required: true,
    critical: true,
    regexPatterns: [/就業時間|勤務時間|何時から|曜日|休憩/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["勤務時間と休憩時間を教えてください"],
    asrVariants: ["稼働時間", "始業"],
    expectedAvatarPatterns: [/八時|十七時|時から/],
  },
  {
    canonicalId: "overtime",
    labelJa: "残業",
    required: true,
    critical: true,
    regexPatterns: [/残業|時間外|超過勤務/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["残業はどの程度発生しますか"],
    asrVariants: ["時間外労働"],
    expectedAvatarPatterns: [/月十|十から十五|時間/],
  },
  {
    canonicalId: "remote_work_frequency",
    labelJa: "リモート有無・頻度",
    required: true,
    critical: false,
    regexPatterns: [/在宅|リモート|テレワーク|出社頻度/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["在宅勤務の頻度はありますか"],
    asrVariants: ["WFH", "ハイブリッド"],
  },
  {
    canonicalId: "billing_and_transportation",
    labelJa: "請求金額・交通費",
    required: true,
    critical: true,
    regexPatterns: [/請求|時給|単価|予算|交通費/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["請求単価のレンジと交通費の扱いを教えてください"],
    asrVariants: ["時給単価", "費用感"],
    expectedAvatarPatterns: [/千七百|千九百|円/],
  },
  {
    canonicalId: "direct_hire_possibility",
    labelJa: "直接雇用の可能性",
    required: false,
    critical: false,
    regexPatterns: [/直接雇用|社員化|正社員登用/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["将来的に直接雇用の可能性はありますか"],
    asrVariants: ["登用"],
  },
  {
    canonicalId: "must_best_priority",
    labelJa: "必須条件・ベスト要件・優先順位",
    required: true,
    critical: true,
    regexPatterns: [/必須条件|ベスト|優先順位|優先度|どちらを優先|何を優先/],
    negativePatterns: [/.*しかない/],
    acceptableEvidenceExamples: ["必須条件と歓迎条件、優先順位はどうなりますか"],
    asrVariants: ["マスト", "ウォント"],
    expectedAvatarPatterns: [/受発注|協調性|柔軟/],
  },
  {
    canonicalId: "certification_and_oa_skills",
    labelJa: "資格・OAスキル",
    required: true,
    critical: false,
    regexPatterns: [/資格|オーエー|OA|エクセル|Excel|Word|スキル/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["求める資格やOAスキルはありますか"],
    asrVariants: ["パソコンスキル", "ITスキル"],
  },
  {
    canonicalId: "department_composition",
    labelJa: "部署人数・男女比・派遣社員有無",
    required: true,
    critical: false,
    regexPatterns: [/部署.{0,2}人数|男女比|派遣.{0,2}有無|チーム構成/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["部署の人数や男女比を教えてください"],
    asrVariants: ["何名くらい", "メンバー構成"],
  },
  {
    canonicalId: "average_age",
    labelJa: "平均年齢層",
    required: false,
    critical: false,
    regexPatterns: [/年齢層|平均年齢|何代/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["年齢層はどのあたりですか"],
    asrVariants: ["年代"],
  },
  {
    canonicalId: "dress_code",
    labelJa: "服装",
    required: false,
    critical: false,
    regexPatterns: [/服装|ドレスコード|オフィスカジュアル/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["服装の決まりはありますか"],
    asrVariants: ["私服", "スーツ"],
  },
  {
    canonicalId: "lunch_breakroom_facilities",
    labelJa: "昼食・休憩室・施設",
    required: false,
    critical: false,
    regexPatterns: [/昼食|休憩室|社食|食堂|施設/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["昼食や休憩室はどう運用されていますか"],
    asrVariants: ["お昼", "ランチ"],
  },
  {
    canonicalId: "supervisor_personality",
    labelJa: "指揮命令者の人柄",
    required: true,
    critical: false,
    regexPatterns: [/指揮命令者|上司|マネジャー|リーダー|人柄|どんな方/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["指揮命令者はどんなお人柄ですか"],
    asrVariants: ["教育担当", "OJT担当"],
  },
  {
    canonicalId: "team_atmosphere",
    labelJa: "部署の雰囲気",
    required: true,
    critical: false,
    regexPatterns: [/雰囲気|カルチャー|文化|空気/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["部署の雰囲気はいかがですか"],
    asrVariants: ["風土"],
  },
  {
    canonicalId: "competing_agencies",
    labelJa: "競合他社依頼状況",
    required: true,
    critical: true,
    regexPatterns: [/他社|並行|相見積|比較|他の派遣会社|あいこう/],
    negativePatterns: [/^人事(?!主導)/],
    acceptableEvidenceExamples: ["他の派遣会社さんにも並行で相談されていますか"],
    asrVariants: ["Aコウ", "外資さん"],
    expectedAvatarPatterns: [/もう一社|大手|比較中|比較軸/],
  },
  {
    canonicalId: "exclusive_window_negotiation",
    labelJa: "独占期間の設定交渉",
    required: true,
    critical: false,
    regexPatterns: [/先行.{0,4}提案|独占期間|提案期間|先に候補/],
    negativePatterns: [],
    acceptableEvidenceExamples: [
      "初回は当社に少し先行して提案する期間をいただけますか",
    ],
    asrVariants: ["前倒し提案"],
    expectedAvatarPatterns: [/三営業日|三日|営業日/],
  },
  {
    canonicalId: "workplace_visit_timing",
    labelJa: "職場見学日時",
    required: true,
    critical: false,
    regexPatterns: [/職場見学|見学|オフィス見学|現場.{0,2}見/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["職場見学はいつ頃可能でしょうか"],
    asrVariants: ["現場ツアー"],
  },
  {
    canonicalId: "post_visit_decision_process",
    labelJa: "見学後の決定プロセス",
    required: true,
    critical: true,
    regexPatterns: [/決定|決裁|誰が決める|最終判断|選定プロセス|派遣会社.{0,2}決定/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["最終的に派遣会社の決定はどなたが持っていますか"],
    asrVariants: ["決め手"],
    /**
     * Combined criterion: requires both 人事 (HR-led selection) AND 現場課長
     * (on-site manager) to be mentioned in the avatar's reply. A single
     * "人事" keyword is NOT enough.
     */
    expectedAvatarPatterns: [/人事/, /現場.{0,2}課長/],
  },
  {
    canonicalId: "preferred_contact_method",
    labelJa: "ベターな連絡方法",
    required: true,
    critical: false,
    regexPatterns: [/連絡方法|ご連絡は|やり取り|メールがいい/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["ご連絡はメールとお電話のどちらが良いでしょうか"],
    asrVariants: ["やり取りは"],
  },
  {
    canonicalId: "future_schedule",
    labelJa: "今後のスケジュール",
    required: true,
    critical: false,
    regexPatterns: [/今後のスケジュール|今後の進め方|スケジュール感/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["今後のスケジュール感を教えてください"],
    asrVariants: ["今後の流れ"],
  },
  {
    canonicalId: "specific_next_action_due_date",
    labelJa: "具体的なネクストアクションと期日",
    required: true,
    critical: true,
    regexPatterns: [/ネクストアクション|次の.{0,2}アクション|期日|までに|提出期限/],
    negativePatterns: [],
    acceptableEvidenceExamples: ["来週水曜までに候補者をメールでご提案する流れでよろしいですか"],
    asrVariants: ["次回までに"],
  },
];

function regexHits(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function findUserEvidence(
  turns: SessionTurn[],
  item: MustCaptureDefinition
): { hit: boolean; quotes: string[]; falsePositive: boolean } {
  const userTurns = turns.filter((turn) => turn.role === "user");
  const matched = userTurns.filter((turn) =>
    regexHits(turn.text, item.regexPatterns)
  );
  if (matched.length === 0) {
    return { hit: false, quotes: [], falsePositive: false };
  }

  const falsePositive = matched.every((turn) =>
    regexHits(turn.text, item.negativePatterns)
  );

  if (falsePositive) {
    return {
      hit: false,
      quotes: matched.map((turn) => turn.text),
      falsePositive: true,
    };
  }

  return {
    hit: true,
    quotes: matched.map((turn) => turn.text),
    falsePositive: false,
  };
}

function findAvatarConfirmation(
  turns: SessionTurn[],
  expectedPatterns: RegExp[]
): { confirmed: boolean; quotes: string[] } {
  if (expectedPatterns.length === 0) {
    return { confirmed: true, quotes: [] };
  }
  const avatarTurns = turns.filter((turn) => turn.role === "avatar");
  const allMatch = expectedPatterns.every((pattern) =>
    avatarTurns.some((turn) => pattern.test(turn.text))
  );
  if (!allMatch) {
    return { confirmed: false, quotes: [] };
  }
  const quotes = avatarTurns
    .filter((turn) => expectedPatterns.some((pattern) => pattern.test(turn.text)))
    .map((turn) => turn.text);
  return { confirmed: true, quotes };
}

export interface GradeStaffingSessionInput {
  turns: SessionTurn[];
  items?: MustCaptureDefinition[];
}

export function gradeStaffingSessionCoverage(
  input: GradeStaffingSessionInput
): StaffingCoverageResult {
  const items = input.items ?? STAFFING_MUST_CAPTURE_ITEMS;
  const detectedItems: Record<string, { evidenceQuotes: string[] }> = {};
  const falsePositiveWarnings: string[] = [];
  const missingRequiredItems: string[] = [];
  const missingCriticalItems: string[] = [];

  let totalHits = 0;
  let requiredItems = 0;
  let requiredHits = 0;
  let criticalItems = 0;
  let criticalHits = 0;

  for (const item of items) {
    const userEvidence = findUserEvidence(input.turns, item);
    const avatarEvidence = findAvatarConfirmation(
      input.turns,
      item.expectedAvatarPatterns ?? []
    );

    let hit = userEvidence.hit && avatarEvidence.confirmed;

    // Combined criteria: every listed canonicalId must also have evidence.
    if (hit && item.combineWith && item.combineWith.length > 0) {
      const others = items.filter((other) =>
        item.combineWith!.includes(other.canonicalId)
      );
      const otherResults = others.map((other) => ({
        canonicalId: other.canonicalId,
        userHit: findUserEvidence(input.turns, other).hit,
        avatarHit: findAvatarConfirmation(
          input.turns,
          other.expectedAvatarPatterns ?? []
        ).confirmed,
      }));
      const rule = item.combineRule ?? "all";
      const allHit = otherResults.every((r) => r.userHit && r.avatarHit);
      const anyHit = otherResults.some((r) => r.userHit && r.avatarHit);
      hit = rule === "all" ? allHit : anyHit;
    }

    if (userEvidence.falsePositive) {
      falsePositiveWarnings.push(
        `${item.canonicalId}: 質問パターンは見つかったが negativePattern にも合致したため、エビデンス採用しません。`
      );
    }

    if (hit) {
      detectedItems[item.canonicalId] = {
        evidenceQuotes: [
          ...userEvidence.quotes,
          ...avatarEvidence.quotes,
        ],
      };
      totalHits += 1;
    } else {
      if (item.required) {
        missingRequiredItems.push(item.canonicalId);
      }
      if (item.critical) {
        missingCriticalItems.push(item.canonicalId);
      }
    }

    if (item.required) {
      requiredItems += 1;
      if (hit) requiredHits += 1;
    }
    if (item.critical) {
      criticalItems += 1;
      if (hit) criticalHits += 1;
    }
  }

  const totalCoverage = items.length > 0 ? totalHits / items.length : 0;
  const requiredCoverage = requiredItems > 0 ? requiredHits / requiredItems : 0;
  const criticalItemsCoverage =
    criticalItems > 0 ? criticalHits / criticalItems : 0;

  const passed =
    requiredCoverage >= STAFFING_PASS_THRESHOLD.required &&
    criticalItemsCoverage >= STAFFING_PASS_THRESHOLD.critical;

  return {
    totalCoverage,
    requiredCoverage,
    criticalItemsCoverage,
    missingRequiredItems,
    missingCriticalItems,
    detectedItems,
    falsePositiveWarnings,
    passThreshold: { ...STAFFING_PASS_THRESHOLD },
    passed,
  };
}
