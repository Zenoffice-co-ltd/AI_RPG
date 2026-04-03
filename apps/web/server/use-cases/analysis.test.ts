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
} = vi.hoisted(() => ({
  transitionToAnalysisRunning: vi.fn(),
  getScorecard: vi.fn(),
  update: vi.fn(),
  listTurns: vi.fn(),
  saveScorecard: vi.fn(),
  getScenario: vi.fn(),
  getPlaybook: vi.fn(),
  gradeSession: vi.fn(),
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
  });
});
