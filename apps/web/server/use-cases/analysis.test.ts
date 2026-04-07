import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scorecard, SessionRecord } from "@top-performer/domain";

const {
  transitionToAnalysisRunning,
  getScorecard,
  update,
  listTurns,
  saveScorecard,
  getScenario,
  getPlaybook,
  gradeSession,
  gradeAccountingSession,
} = vi.hoisted(() => ({
  transitionToAnalysisRunning: vi.fn(),
  getScorecard: vi.fn(),
  update: vi.fn(),
  listTurns: vi.fn(),
  saveScorecard: vi.fn(),
  getScenario: vi.fn(),
  getPlaybook: vi.fn(),
  gradeSession: vi.fn(),
  gradeAccountingSession: vi.fn(),
}));

vi.mock("../appContext", () => ({
  getAppContext: () => ({
    env: {
      OPENAI_ANALYSIS_MODEL: "gpt-5.4",
    },
    repositories: {
      sessions: {
        transitionToAnalysisRunning,
        getScorecard,
        update,
        listTurns,
        saveScorecard,
      },
      scenarios: {
        get: getScenario,
      },
      playbooks: {
        get: getPlaybook,
      },
    },
    vendors: {
      openAi: {},
    },
  }),
}));

vi.mock("@top-performer/scoring", () => ({
  gradeSession,
  gradeAccountingSession,
}));

import { analyzeSession } from "./analysis";

function createSessionRecord(
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    sessionId: "sess_123",
    scenarioId: "staffing_order_hearing_busy_manager_medium",
    status: "analysis_running",
    liveavatarSessionId: "la_123",
    livekitRoomUrl: "wss://example.invalid",
    livekitToken: "token",
    avatarId: "avatar_123",
    elevenAgentId: "agent_123",
    startedAt: new Date().toISOString(),
    analysisVersion: "grade-session@2026-04-02.v1",
    ...overrides,
  };
}

function createScorecard(
  overrides: Partial<Scorecard> = {}
): Scorecard {
  return {
    sessionId: "sess_123",
    scenarioId: "staffing_order_hearing_busy_manager_medium",
    overallScore: 82,
    topPerformerAlignmentScore: 79,
    rubricScores: [],
    mustCaptureResults: [],
    strengths: [],
    misses: [],
    missedQuestions: [],
    nextDrills: [],
    summary: "summary",
    generatedAt: new Date().toISOString(),
    promptVersion: "grade-session@2026-04-02.v1",
    ...overrides,
  };
}

describe("analyzeSession", () => {
  beforeEach(() => {
    transitionToAnalysisRunning.mockReset();
    getScorecard.mockReset();
    update.mockReset();
    listTurns.mockReset();
    saveScorecard.mockReset();
    getScenario.mockReset();
    getPlaybook.mockReset();
    gradeSession.mockReset();
    gradeAccountingSession.mockReset();
  });

  it("reuses an existing scorecard with the same analysis version", async () => {
    transitionToAnalysisRunning.mockResolvedValue({
      session: createSessionRecord(),
      lockAcquired: false,
    });
    getScorecard.mockResolvedValue(createScorecard());

    const result = await analyzeSession("sess_123");

    expect(result.status).toBe("completed");
    expect(result.scorecard?.overallScore).toBe(82);
    expect(update).toHaveBeenCalledWith("sess_123", {
      status: "completed",
    });
    expect(gradeSession).not.toHaveBeenCalled();
    expect(gradeAccountingSession).not.toHaveBeenCalled();
  });

  it("returns a no-op response when another worker already holds the lock", async () => {
    transitionToAnalysisRunning.mockResolvedValue({
      session: createSessionRecord(),
      lockAcquired: false,
    });
    getScorecard.mockResolvedValue(null);

    const result = await analyzeSession("sess_123");

    expect(result.status).toBe("analysis_running");
    expect(result.scorecard).toBeUndefined();
    expect(gradeSession).not.toHaveBeenCalled();
    expect(gradeAccountingSession).not.toHaveBeenCalled();
  });

  it("uses the accounting grading path for accounting scenarios", async () => {
    transitionToAnalysisRunning.mockResolvedValue({
      session: createSessionRecord({
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
        analysisVersion: "grade-accounting-session@2026-04-08.v1",
      }),
      lockAcquired: true,
    });
    getScorecard.mockResolvedValue(null);
    listTurns.mockResolvedValue([
      {
        turnId: "turn_1",
        role: "user",
        text: "背景を教えてください。",
        relativeTimestamp: 1,
        dedupeKey: "turn_1",
      },
    ]);
    getScenario.mockResolvedValue({
      id: "accounting_clerk_enterprise_ap_busy_manager_medium",
      family: "accounting_clerk_enterprise_ap",
      generatedFromPlaybookVersion: "pb_accounting_v2",
    });
    getPlaybook.mockResolvedValue({ version: "pb_accounting_v2" });
    gradeAccountingSession.mockResolvedValue(
      createScorecard({
        scenarioId: "accounting_clerk_enterprise_ap_busy_manager_medium",
        promptVersion: "grade-accounting-session@2026-04-08.v1",
        evaluationMode: "accounting_v2",
      })
    );

    const result = await analyzeSession("sess_123");

    expect(result.status).toBe("completed");
    expect(gradeAccountingSession).toHaveBeenCalled();
    expect(gradeSession).not.toHaveBeenCalled();
    expect(saveScorecard).toHaveBeenCalled();
  });
});
