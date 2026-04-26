import { describe, expect, it } from "vitest";
import type { SessionTurn } from "@top-performer/domain";
import {
  STAFFING_MUST_CAPTURE_ITEMS,
  gradeStaffingSessionCoverage,
} from "./gradeStaffingSession";

function makeTurn(
  index: number,
  role: SessionTurn["role"],
  text: string
): SessionTurn {
  return {
    turnId: `t_${index}`,
    role,
    text,
    relativeTimestamp: index,
    source: "transcript_api",
    dedupeKey: `${role}:${index}:${text.slice(0, 8)}`,
  };
}

const passingTranscript: SessionTurn[] = [
  makeTurn(1, "user", "募集背景を教えてください。"),
  makeTurn(
    2,
    "avatar",
    "増員のためです。新しい派遣会社さんも比較しながら、要件整理を進めたいと考えています。"
  ),
  makeTurn(3, "user", "増員ですか、それとも交代の補充でしょうか。"),
  makeTurn(4, "avatar", "増員寄りです。"),
  makeTurn(5, "user", "職種としては営業事務とのことですが、業務の大枠を教えてください。"),
  makeTurn(6, "avatar", "受発注や納期調整まわりの営業事務です。"),
  makeTurn(
    7,
    "user",
    "具体的に、受発注、納期調整、在庫確認、対外対応のどれが主業務になりますか。"
  ),
  makeTurn(
    8,
    "avatar",
    "受発注入力と納期調整が中心です。在庫確認や対外対応も付随します。"
  ),
  makeTurn(9, "user", "件数や繁忙サイクルはどんな感じですか。"),
  makeTurn(
    10,
    "avatar",
    "受注は月に六百から七百件程度です。月末月初、月曜午前、商材切替時に負荷が上がります。"
  ),
  makeTurn(11, "user", "引継ぎはどのように進めますか。"),
  makeTurn(12, "avatar", "現任スタッフと二週間程度のオン・ボーディングが可能です。"),
  makeTurn(13, "user", "開始日はいつ頃を想定されていますか。期間は。"),
  makeTurn(14, "avatar", "六月一日希望です。"),
  makeTurn(15, "user", "勤務時間と休憩時間を教えてください。"),
  makeTurn(16, "avatar", "平日八時四十五分から十七時三十分までです。"),
  makeTurn(17, "user", "残業はどの程度発生しますか。"),
  makeTurn(18, "avatar", "月十から十五時間ほどです。"),
  makeTurn(19, "user", "在宅勤務の頻度はありますか。"),
  makeTurn(20, "avatar", "在宅は当面なしです。"),
  makeTurn(21, "user", "請求単価のレンジと交通費の扱いを教えてください。"),
  makeTurn(
    22,
    "avatar",
    "請求は経験により千七百五十円から千九百円のレンジです。交通費は別途。"
  ),
  makeTurn(23, "user", "必須条件と歓迎条件、優先順位はどうなりますか。"),
  makeTurn(
    24,
    "avatar",
    "受発注経験を最優先で、正確性と協調性、柔軟性の順で見ます。"
  ),
  makeTurn(25, "user", "求める資格やオーエースキルはありますか。"),
  makeTurn(26, "avatar", "基本操作ができれば十分です。"),
  makeTurn(27, "user", "部署の人数や男女比を教えてください。"),
  makeTurn(28, "avatar", "営業管理課は十二名です。"),
  makeTurn(29, "user", "指揮命令者はどんなお人柄ですか。"),
  makeTurn(30, "avatar", "落ち着いた方ですが正確性に厳しい人です。"),
  makeTurn(31, "user", "部署の雰囲気はいかがですか。"),
  makeTurn(32, "avatar", "事務系で落ち着いた雰囲気です。"),
  makeTurn(33, "user", "他の派遣会社さんにも並行で相談されていますか。"),
  makeTurn(
    34,
    "avatar",
    "もう一社の大手にも比較中で、供給力やレスポンス、要件理解を比較軸にしています。"
  ),
  makeTurn(
    35,
    "user",
    "初回は当社に少し先行して提案する期間をいただけますか。"
  ),
  makeTurn(36, "avatar", "三営業日程度の先行提案期間を検討できます。"),
  makeTurn(37, "user", "職場見学はいつ頃可能でしょうか。"),
  makeTurn(38, "avatar", "来週後半が有力です。"),
  makeTurn(39, "user", "最終的に派遣会社の決定はどなたが持っていますか。"),
  makeTurn(
    40,
    "avatar",
    "ベンダー選定は人事が主導しますが、候補者最終フィットは現場課長の意見が強く反映されます。"
  ),
  makeTurn(41, "user", "ご連絡はメールとお電話のどちらが良いでしょうか。"),
  makeTurn(42, "avatar", "メールがありがたいです。"),
  makeTurn(43, "user", "今後のスケジュール感を教えてください。"),
  makeTurn(44, "avatar", "見学後二から三営業日で決定です。"),
  makeTurn(
    45,
    "user",
    "来週水曜までに候補者をメールでご提案する流れでよろしいですか。"
  ),
  makeTurn(46, "avatar", "はい、その流れでお願いします。"),
];

describe("gradeStaffingSessionCoverage", () => {
  it("returns coverage 1.0 and passes for a fully-captured transcript", () => {
    const result = gradeStaffingSessionCoverage({ turns: passingTranscript });
    expect(result.criticalItemsCoverage).toBe(1.0);
    expect(result.missingCriticalItems).toEqual([]);
    expect(result.requiredCoverage).toBeGreaterThanOrEqual(0.9);
    expect(result.passed).toBe(true);
    expect(Object.keys(result.detectedItems)).toEqual(
      expect.arrayContaining([
        "hiring_background",
        "competing_agencies",
        "post_visit_decision_process",
      ])
    );
  });

  it("flags critical items as missing when the orb-failure transcript is replayed (DoD 5 regression)", () => {
    // Replay the 2026-04-26 orb session (truncated learner side).
    // Notably absent: competition follow-up, decision structure, billing,
    // overtime explicit ask, etc.
    const failingTranscript: SessionTurn[] = [
      makeTurn(1, "user", "あなたは誰ですか。"),
      makeTurn(2, "avatar", "営業事務を一名お願いする相談です。"),
      makeTurn(3, "user", "今回の募集について概要を教えてください。"),
      makeTurn(4, "avatar", "増員のためです。"),
      makeTurn(5, "user", "募集背景を教えてください。"),
      makeTurn(
        6,
        "avatar",
        "現行ベンダーの供給が安定せず、稼働確保やレスポンス面で課題が出ています。"
      ),
      makeTurn(7, "user", "なんで新しい派遣会社にも声かけたんですか。"),
      makeTurn(8, "avatar", "受発注や納期調整まわりの営業事務です。"),
    ];

    const result = gradeStaffingSessionCoverage({ turns: failingTranscript });
    expect(result.passed).toBe(false);
    expect(result.criticalItemsCoverage).toBeLessThan(1.0);
    expect(result.missingCriticalItems).toEqual(
      expect.arrayContaining([
        "volume_and_peak_cycle",
        "billing_and_transportation",
        "competing_agencies",
        "post_visit_decision_process",
        "specific_next_action_due_date",
      ])
    );
  });

  it("does NOT count decision_structure when only 人事 alone is mentioned (combined criterion / false-positive guard)", () => {
    const partialTranscript: SessionTurn[] = [
      makeTurn(1, "user", "最終的に派遣会社の決定はどなたが持っていますか。"),
      // Avatar mentions HR only. 現場課長 is NOT mentioned.
      makeTurn(2, "avatar", "ベンダー選定は人事が主導します。"),
    ];

    const result = gradeStaffingSessionCoverage({ turns: partialTranscript });
    expect(result.detectedItems).not.toHaveProperty("post_visit_decision_process");
    expect(result.missingCriticalItems).toContain("post_visit_decision_process");
  });

  it("counts decision_structure ONLY when both 人事主導 and 現場課長 are mentioned", () => {
    const fullTranscript: SessionTurn[] = [
      makeTurn(1, "user", "最終的に派遣会社の決定はどなたが持っていますか。"),
      makeTurn(
        2,
        "avatar",
        "ベンダー選定は人事が主導しますが、候補者最終フィットは現場課長の意見が強く反映されます。"
      ),
    ];

    const result = gradeStaffingSessionCoverage({ turns: fullTranscript });
    expect(result.detectedItems).toHaveProperty("post_visit_decision_process");
  });

  it("acceptableEvidenceExamples in each definition match their own regex (sanity)", () => {
    for (const item of STAFFING_MUST_CAPTURE_ITEMS) {
      for (const example of item.acceptableEvidenceExamples) {
        const matches = item.regexPatterns.some((pattern) =>
          pattern.test(example)
        );
        expect(
          matches,
          `${item.canonicalId} example "${example}" should match its own regexPatterns`
        ).toBe(true);
      }
    }
  });

  it("exposes the 11 critical items required by DoD 5", () => {
    const expectedCritical = new Set([
      "hiring_background",
      "role_and_task_scope",
      "volume_and_peak_cycle",
      "start_date_and_term",
      "work_days_hours_break",
      "overtime",
      "billing_and_transportation",
      "competing_agencies",
      "post_visit_decision_process",
      "must_best_priority",
      "specific_next_action_due_date",
    ]);
    const actualCritical = new Set(
      STAFFING_MUST_CAPTURE_ITEMS.filter((item) => item.critical).map(
        (item) => item.canonicalId
      )
    );
    expect(actualCritical).toEqual(expectedCritical);
    expect(actualCritical.size).toBe(11);
  });

  it("totals 27 items with 23 required and 4 recommended (matches reference SoT)", () => {
    expect(STAFFING_MUST_CAPTURE_ITEMS).toHaveLength(27);
    const required = STAFFING_MUST_CAPTURE_ITEMS.filter((item) => item.required);
    const recommended = STAFFING_MUST_CAPTURE_ITEMS.filter(
      (item) => !item.required
    );
    expect(required.length).toBe(23);
    expect(recommended.length).toBe(4);
    expect(recommended.map((item) => item.canonicalId).sort()).toEqual([
      "average_age",
      "direct_hire_possibility",
      "dress_code",
      "lunch_breakroom_facilities",
    ]);
  });
});
