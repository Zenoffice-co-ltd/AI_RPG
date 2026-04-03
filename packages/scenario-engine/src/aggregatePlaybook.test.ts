import { describe, expect, it } from "vitest";
import { aggregatePlaybook } from "./aggregatePlaybook";

describe("aggregatePlaybook", () => {
  it("applies required and recommended thresholds deterministically", () => {
    const transcripts = [
      {
        id: "tr1",
        sourceFile: "a",
        family: "staffing_order_hearing" as const,
        performanceTier: "top" as const,
        language: "ja" as const,
        metadata: {},
        turns: [
          { turnId: "t_001", speaker: "sales" as const, text: "x" },
          { turnId: "t_002", speaker: "sales" as const, text: "y" },
        ],
        importedAt: new Date().toISOString(),
        redactionStatus: "redacted" as const,
      },
      {
        id: "tr2",
        sourceFile: "b",
        family: "staffing_order_hearing" as const,
        performanceTier: "top" as const,
        language: "ja" as const,
        metadata: {},
        turns: [
          { turnId: "t_001", speaker: "sales" as const, text: "x" },
          { turnId: "t_002", speaker: "sales" as const, text: "y" },
        ],
        importedAt: new Date().toISOString(),
        redactionStatus: "redacted" as const,
      },
      {
        id: "tr3",
        sourceFile: "c",
        family: "staffing_order_hearing" as const,
        performanceTier: "top" as const,
        language: "ja" as const,
        metadata: {},
        turns: [
          { turnId: "t_001", speaker: "sales" as const, text: "x" },
          { turnId: "t_002", speaker: "sales" as const, text: "y" },
        ],
        importedAt: new Date().toISOString(),
        redactionStatus: "redacted" as const,
      },
      {
        id: "tr4",
        sourceFile: "d",
        family: "staffing_order_hearing" as const,
        performanceTier: "top" as const,
        language: "ja" as const,
        metadata: {},
        turns: [
          { turnId: "t_001", speaker: "sales" as const, text: "x" },
          { turnId: "t_002", speaker: "sales" as const, text: "y" },
        ],
        importedAt: new Date().toISOString(),
        redactionStatus: "redacted" as const,
      },
      {
        id: "tr5",
        sourceFile: "e",
        family: "staffing_order_hearing" as const,
        performanceTier: "top" as const,
        language: "ja" as const,
        metadata: {},
        turns: [
          { turnId: "t_001", speaker: "sales" as const, text: "x" },
          { turnId: "t_002", speaker: "sales" as const, text: "y" },
        ],
        importedAt: new Date().toISOString(),
        redactionStatus: "redacted" as const,
      },
    ];

    const playbook = aggregatePlaybook({
      family: "staffing_order_hearing",
      transcripts,
      extractions: [
        {
          transcriptId: "tr1",
          phaseSegments: [],
          capturedItems: [
            {
              key: "start_date",
              firstTurnId: "t_001",
              depthScore: 4,
              evidenceTurnIds: ["t_001"],
            },
            {
              key: "decision_maker",
              firstTurnId: "t_002",
              depthScore: 3,
              evidenceTurnIds: ["t_002"],
            },
          ],
          winningMoves: [],
          antiPatterns: [],
        },
        {
          transcriptId: "tr2",
          phaseSegments: [],
          capturedItems: [
            {
              key: "start_date",
              firstTurnId: "t_001",
              depthScore: 5,
              evidenceTurnIds: ["t_001"],
            },
          ],
          winningMoves: [],
          antiPatterns: [],
        },
        {
          transcriptId: "tr3",
          phaseSegments: [],
          capturedItems: [
            {
              key: "start_date",
              firstTurnId: "t_001",
              depthScore: 3,
              evidenceTurnIds: ["t_001"],
            },
          ],
          winningMoves: [],
          antiPatterns: [],
        },
        {
          transcriptId: "tr4",
          phaseSegments: [],
          capturedItems: [
            {
              key: "start_date",
              firstTurnId: "t_001",
              depthScore: 4,
              evidenceTurnIds: ["t_001"],
            },
            {
              key: "decision_maker",
              firstTurnId: "t_002",
              depthScore: 3,
              evidenceTurnIds: ["t_002"],
            },
          ],
          winningMoves: [],
          antiPatterns: [],
        },
        {
          transcriptId: "tr5",
          phaseSegments: [],
          capturedItems: [],
          winningMoves: [],
          antiPatterns: [],
        },
      ],
    });

    expect(playbook.requiredItems.map((item) => item.key)).toContain("start_date");
    expect(playbook.recommendedItems.map((item) => item.key)).toContain(
      "decision_maker"
    );
  });
});
