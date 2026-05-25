import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("firebase-admin/app", () => ({
  applicationDefault: () => ({
    getAccessToken: vi.fn().mockResolvedValue({ access_token: "access-token" }),
  }),
}));

vi.mock("@/server/appContext", () => ({
  getAppContext: () => ({
    env: {
      APP_BASE_URL: "https://roleplay.mendan.biz",
      CLOUD_TASKS_QUEUE_ANALYZE: "session-analysis",
      CLOUD_TASKS_QUEUE_REGION: "asia-northeast1",
      FIREBASE_PROJECT_ID: "adecco-mendan",
      QUEUE_SHARED_SECRET: "queue-secret",
    },
  }),
}));

describe("Adecco browser evaluation long transcript timeout settings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("sets a 10 minute Cloud Tasks dispatch deadline for browser scoring", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "tasks/adecco-browser-eval-test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const {
      ADECCO_BROWSER_EVAL_DISPATCH_DEADLINE_SECONDS,
      enqueueAdeccoBrowserEvaluationTask,
    } = await import("../../server/cloudTasks");

    await enqueueAdeccoBrowserEvaluationTask({
      sessionId: "manual_eval_long_transcript",
      conversationId: null,
      transcript: [
        { turn_id: "u1", speaker: "sales", text: "背景は？", timestamp_sec: 0 },
        { turn_id: "a1", speaker: "client", text: "増員です。", timestamp_sec: 1 },
      ],
      startedAt: "2026-05-25T00:00:00.000Z",
      endedAt: "2026-05-25T00:30:00.000Z",
      source: "grok_first_v50_7_browser",
      runtimeVersion: "v50-7",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      task?: {
        dispatchDeadline?: string;
        httpRequest?: { url?: string };
      };
    };
    expect(ADECCO_BROWSER_EVAL_DISPATCH_DEADLINE_SECONDS).toBe(600);
    expect(body.task?.dispatchDeadline).toBe("600s");
    expect(body.task?.httpRequest?.url).toBe(
      "https://roleplay.mendan.biz/api/internal/adecco-browser-eval"
    );
  });

  it("keeps Claude scoring timeout safely inside the task deadline", async () => {
    const { getAdeccoEvalClaudeTimeoutMs } = await import(
      "../../server/use-cases/adeccoOrderHearingEval"
    );

    expect(getAdeccoEvalClaudeTimeoutMs()).toBe(540_000);

    vi.stubEnv("ADECCO_EVAL_CLAUDE_TIMEOUT_MS", "9999999");
    expect(getAdeccoEvalClaudeTimeoutMs()).toBe(540_000);

    vi.stubEnv("ADECCO_EVAL_CLAUDE_TIMEOUT_MS", "1000");
    expect(getAdeccoEvalClaudeTimeoutMs()).toBe(60_000);
  });
});
