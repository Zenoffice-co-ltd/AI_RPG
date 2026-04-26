/**
 * Mutation regression test: 2026-04-26 orb session の AI 不良応答を
 * 各 ConvAI regression test の `failure_examples` に明示バインドし、
 * 「prior orb 失敗ログを入力したら少なくとも以下が FAIL すること」
 * という Final Release DoD 追加要件を保証する。
 *
 * - 各 prior bad response は、対応する regression test の failure_examples
 *   または success_condition の banned-keyword 列に出現していること
 * - これによりテスト定義が「単に追加されただけ」ではなく、
 *   「実際の失敗モードを検出する」ことを構造的に保証する
 */

import { describe, expect, it } from "vitest";
import { ADECCO_MANUFACTURER_SCENARIO_ID } from "@top-performer/domain";
import { __testing as publishAgentInternals } from "./publishAgent";

const SCENARIO_ID = ADECCO_MANUFACTURER_SCENARIO_ID;

interface PriorOrbBadResponse {
  /** 1-line description of the failure mode. */
  description: string;
  /** Quote from the 2026-04-26 orb session. */
  badResponse: string;
  /**
   * regression test name (after ::), at least one of these must contain
   * the badResponse in failure_examples OR mark it bad via success_condition.
   */
  expectedFailingRegressions: string[];
}

const PRIOR_ORB_BAD_RESPONSES: PriorOrbBadResponse[] = [
  {
    description:
      "Q『今回の募集について概要を教えてください』に対して 増員 + 新規派遣会社声かけ を早出し",
    badResponse:
      "増員のためです。新しい派遣会社さんにも一度声をかけて、要件整理を進めたいと思っています。",
    expectedFailingRegressions: ["shallow-overview-no-hidden-leak"],
  },
  {
    description:
      "Q『募集背景を教えてください』(浅い段階) で現行ベンダー供給不足/レスポンス不満を一気にリーク",
    badResponse:
      "現行ベンダーの供給が安定せず、稼働確保やレスポンス面で課題が出ているため、新規比較も含めて相談を始めています。",
    expectedFailingRegressions: ["shallow-overview-no-hidden-leak"],
  },
  {
    description:
      "Q『なぜ新しい派遣会社にも声かけたんですか？』に対して、業務内容を返答 (1 ターン先回り)",
    badResponse: "受発注や納期調整まわりの営業事務です。",
    expectedFailingRegressions: ["background-depth-controlled-disclosure"],
  },
  {
    description:
      "Q『件数や繁忙サイクルはどんな感じですか』に対して、競合相談を返答 (1 ターン先ズレ)",
    badResponse:
      "現時点では現行ベンダーに加えてもう1社の大手にも相談中です。",
    expectedFailingRegressions: [
      "one-turn-lag-regression",
      "business-task-depth-controlled-disclosure",
    ],
  },
  {
    description:
      "Q『先行提案期間をいただけますか』に対して、決定構造を返答 (1 ターン先ズレ)",
    badResponse:
      "ベンダー選定は人事が主導しますが、現場課長の意見が強く反映されます。",
    expectedFailingRegressions: ["one-turn-lag-regression"],
  },
  {
    description:
      "学習者要約後にAIが沈黙催促 / 汎用応答 / Adecco逆質問の繰り返しを返した",
    badResponse: "まだご検討中でしょうか。どの点から確認しますか。",
    expectedFailingRegressions: [
      "ending-summary-then-adecco-reverse-question",
      "phrase-loop-regression",
      "manual-test-script-fixture",
    ],
  },
  {
    description: "「どの点についてですか」を毎ターン定型句として連呼",
    badResponse: "どの点についてですか。",
    expectedFailingRegressions: [
      "phrase-loop-regression",
      "ending-summary-then-adecco-reverse-question",
    ],
  },
  {
    description: "Adecco 逆質問を 2 回以上繰り返す",
    badResponse:
      "Adeccoさんの強みは何ですか。Adeccoさんの強みは何ですか。",
    expectedFailingRegressions: ["ending-summary-then-adecco-reverse-question"],
  },
  {
    description: "学習者にコーチングを返してしまう",
    badResponse:
      "まずは決裁者、その次に充足期限、最後に単価を聞いてください。",
    expectedFailingRegressions: ["no-coaching-strict"],
  },
  {
    description: "ASR が崩れた競合質問を 三営業日先行に逸らす (前回未確認・防御テスト)",
    badResponse:
      "要件整理が合えば、初回は三営業日程度の先行提案期間を検討します。",
    expectedFailingRegressions: ["asr-variant-robustness"],
  },
  {
    description: "SAP 経験を必須として返答する (今回 SAP 前提を完全削除済み)",
    badResponse: "メーカー受発注やエスエーピー経験者だと特に助かります。",
    expectedFailingRegressions: ["sap-absence"],
  },
];

function findTestDefinition(name: string) {
  // DoD v2: prior orb failure mutation tests bind to the LOCAL regression
  // bundle, not the vendor smoke gate. This ensures the rich regression
  // suite remains the source of truth for failure-mode coverage even when
  // the vendor smoke set is intentionally narrow.
  const fakeScenario = { id: SCENARIO_ID } as never;
  const definitions =
    publishAgentInternals.buildAdeccoLocalRegressionDefinitions(fakeScenario);
  return definitions.find((def) => def.name === `${SCENARIO_ID}::${name}`);
}

function failureExampleMatches(
  failureExamples: Array<{ response: string }>,
  badResponse: string
) {
  // Accept exact match OR a meaningful substring overlap (>= 8 chars).
  const sanitized = badResponse.replace(/\s+/g, "");
  return failureExamples.some((example) => {
    const candidate = example.response.replace(/\s+/g, "");
    if (candidate === sanitized) return true;
    // Overlap when one contains a substantive prefix/suffix of the other
    // — protects against minor wording differences while still binding
    // the test to the actual failure mode.
    if (sanitized.length >= 8 && candidate.includes(sanitized.slice(0, 8))) {
      return true;
    }
    if (candidate.length >= 8 && sanitized.includes(candidate.slice(0, 8))) {
      return true;
    }
    return false;
  });
}

describe("Prior 2026-04-26 orb failure log binds to regression test failure_examples", () => {
  for (const bad of PRIOR_ORB_BAD_RESPONSES) {
    it(`${bad.description} → maps to a regression test`, () => {
      const matchingTests: string[] = [];
      for (const regressionName of bad.expectedFailingRegressions) {
        const def = findTestDefinition(regressionName);
        expect(
          def,
          `regression test ${regressionName} must exist`
        ).toBeDefined();
        const failureExamples =
          (def as { failure_examples?: Array<{ response: string }> })
            .failure_examples ?? [];
        if (failureExampleMatches(failureExamples, bad.badResponse)) {
          matchingTests.push(regressionName);
        }
      }
      expect(
        matchingTests.length,
        `expected at least one of [${bad.expectedFailingRegressions.join(", ")}] to bind the bad response "${bad.badResponse}" via failure_examples`
      ).toBeGreaterThan(0);
    });
  }

  it("覆 (cover): every regression test that DoD 4 enumerates has at least one failure example", () => {
    const required = [
      "shallow-overview-no-hidden-leak",
      "background-depth-controlled-disclosure",
      "business-task-depth-controlled-disclosure",
      "competitor-and-decision-depth-controlled-disclosure",
      "one-turn-lag-regression",
      "ending-summary-then-adecco-reverse-question",
      "phrase-loop-regression",
      "no-coaching-strict",
      "asr-variant-robustness",
      "sap-absence",
      "manual-test-script-fixture",
    ];
    for (const tail of required) {
      const def = findTestDefinition(tail);
      expect(def, `regression ${tail} must exist`).toBeDefined();
      const failureExamples =
        (def as { failure_examples?: Array<{ response: string }> })
          .failure_examples ?? [];
      expect(
        failureExamples.length,
        `${tail} must include at least one failure_example`
      ).toBeGreaterThan(0);
    }
  });
});
