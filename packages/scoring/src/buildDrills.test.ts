import { describe, expect, it } from "vitest";
import { buildDrills } from "./buildDrills";

describe("buildDrills", () => {
  it("maps missed must-capture items to fixed drill labels", () => {
    const drills = buildDrills({
      scenario: {
        id: "scenario",
        family: "staffing_order_hearing",
        version: "v1",
        title: "test",
        language: "ja",
        difficulty: "medium",
        persona: {
          role: "role",
          companyAlias: "Company_A",
          demeanor: "busy",
          responseStyle: "brief",
        },
        publicBrief: "brief",
        hiddenFacts: ["fact"],
        revealRules: [{ trigger: "x", reveals: ["y"] }],
        mustCaptureItems: [],
        rubric: [],
        closeCriteria: ["close"],
        openingLine: "hi",
        generatedFromPlaybookVersion: "pb",
        status: "draft",
      },
      scorecard: {
        sessionId: "sess",
        scenarioId: "scenario",
        overallScore: 50,
        topPerformerAlignmentScore: 40,
        rubricScores: [],
        mustCaptureResults: [
          {
            key: "decision_maker",
            label: "決裁者",
            status: "missed",
            evidenceTurnIds: [],
          },
        ],
        strengths: [],
        misses: [],
        missedQuestions: [],
        nextDrills: [],
        summary: "summary",
        generatedAt: new Date().toISOString(),
        promptVersion: "p1",
      },
    });

    expect(drills).toContain("決裁構造確認 drill");
  });
});
