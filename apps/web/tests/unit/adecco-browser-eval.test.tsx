import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "../../lib/roleplay/auth";
import type { SessionArtifact } from "@top-performer/domain";

const savedArtifacts = vi.hoisted(() => new Map<string, SessionArtifact>());
const enqueueMock = vi.hoisted(() => vi.fn());
const scoringMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/appContext", () => ({
  getAppContext: () => ({
    env: {
      QUEUE_SHARED_SECRET: "queue-secret",
      APP_BASE_URL: "http://127.0.0.1:3000",
      FIREBASE_PROJECT_ID: "adecco-mendan",
      CLOUD_TASKS_QUEUE_ANALYZE: "session-analysis",
      CLOUD_TASKS_QUEUE_REGION: "asia-northeast1",
    },
    repositories: {
      sessions: {
        saveArtifact: vi.fn((artifact: SessionArtifact) => {
          savedArtifacts.set(`${artifact.sessionId}:${artifact.id}`, artifact);
          return Promise.resolve();
        }),
        getArtifact: vi.fn((sessionId: string, artifactId: string) =>
          Promise.resolve(savedArtifacts.get(`${sessionId}:${artifactId}`) ?? null)
        ),
      },
    },
  }),
}));

vi.mock("@/server/cloudTasks", () => ({
  enqueueAdeccoBrowserEvaluationTask: enqueueMock,
}));

vi.mock("@/server/use-cases/adeccoOrderHearingEval", () => ({
  runAdeccoOrderHearingScoring: scoringMock,
}));

function apiRequest(
  url: string,
  body: unknown,
  init: { cookie?: boolean; origin?: string } = {}
) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: init.origin ?? "http://127.0.0.1:3000",
    referer: "http://127.0.0.1:3000/demo/adecco-roleplay-v50-7",
  });
  if (init.cookie !== false) {
    headers.set("cookie", `roleplay_api_access=${signAccessToken("demo-secret")}`);
  }
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function resultRequest(sessionId: string) {
  return new NextRequest(
    `http://127.0.0.1:3000/api/grok-first-v50-7/evaluation/result?sessionId=${sessionId}`,
    {
      method: "GET",
      headers: {
        cookie: `roleplay_api_access=${signAccessToken("demo-secret")}`,
      },
    }
  );
}

describe("v50.7 browser evaluation APIs", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("NODE_ENV", "test");
    savedArtifacts.clear();
    enqueueMock.mockResolvedValue("tasks/adecco-browser-eval-test");
    scoringMock.mockResolvedValue({
      sessionId: "gv_sess_eval",
      conversationId: null,
      scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
      model: "claude-sonnet-4-5-20250929",
      usage: { input_tokens: 10, output_tokens: 20 },
      validation: { ok: true, status: "success" },
      retryNote: "not retried",
      reportJson: { total_score: 88, rubric_scores: {}, must_capture_items: [] },
      rawClaudeText: "{\"total_score\":88}",
      validationJsonText: "{\"total_score\":88}",
      startedAt: "2026-05-16T00:00:00.000Z",
      endedAt: "2026-05-16T00:01:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects evaluation start without access", async () => {
    const { POST } = await import(
      "../../app/api/grok-first-v50-7/evaluation/start/route"
    );
    const response = await POST(
      apiRequest(
        "http://127.0.0.1:3000/api/grok-first-v50-7/evaluation/start",
        {},
        { cookie: false }
      )
    );
    expect(response.status).toBe(401);
  });

  it("honors ADECCO_BROWSER_EVAL_ENABLED rollback flag", async () => {
    vi.stubEnv("ADECCO_BROWSER_EVAL_ENABLED", "0");
    const { POST } = await import(
      "../../app/api/grok-first-v50-7/evaluation/start/route"
    );
    const response = await POST(
      apiRequest("http://127.0.0.1:3000/api/grok-first-v50-7/evaluation/start", {
        sessionId: "gv_sess_eval",
        transcript: [
          { turn_id: "u1", role: "user", text: "募集背景を教えてください" },
          { turn_id: "a1", role: "agent", text: "増員です。" },
        ],
        source: "grok_first_v50_7_browser",
      })
    );
    const body = (await response.json()) as { status?: string };
    expect(response.status).toBe(409);
    expect(body.status).toBe("disabled");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("queues valid evaluation start without leaking secrets into the task payload", async () => {
    const { POST } = await import(
      "../../app/api/grok-first-v50-7/evaluation/start/route"
    );
    const response = await POST(
      apiRequest("http://127.0.0.1:3000/api/grok-first-v50-7/evaluation/start", {
        sessionId: "gv_sess_eval",
        transcript: [
          { turn_id: "u1", role: "user", text: "募集背景を教えてください" },
          { turn_id: "a1", role: "agent", text: "増員です。" },
        ],
        source: "grok_first_v50_7_browser",
      })
    );
    expect(response.status).toBe(202);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const payload = enqueueMock.mock.calls[0]?.[0] as unknown;
    expect(JSON.stringify(payload)).not.toContain("ticket");
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("audio");
    expect(savedArtifacts.get("gv_sess_eval:adecco_eval_status")?.payload).toMatchObject({
      status: "queued",
    });
  });

  it("worker saves browser scorecard and raw model output without sending Gmail", async () => {
    const { POST } = await import("../../app/api/internal/adecco-browser-eval/route");
    const response = await POST(
      new NextRequest("http://127.0.0.1:3000/api/internal/adecco-browser-eval", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-queue-shared-secret": "queue-secret",
        },
        body: JSON.stringify({
          sessionId: "gv_sess_eval",
          conversationId: null,
          transcript: [
            { turn_id: "u1", speaker: "sales", text: "背景は？", timestamp_sec: 0 },
            { turn_id: "a1", speaker: "client", text: "増員です。", timestamp_sec: 1 },
          ],
          startedAt: "2026-05-16T00:00:00.000Z",
          endedAt: "2026-05-16T00:01:00.000Z",
          source: "grok_first_v50_7_browser",
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(scoringMock).toHaveBeenCalledTimes(1);
    expect(savedArtifacts.get("gv_sess_eval:scorecard")?.payload).toMatchObject({
      evaluationFormat: "adecco_order_hearing_browser_v1",
      report: { total_score: 88 },
    });
    expect(savedArtifacts.get("gv_sess_eval:model_raw_output")?.payload).toMatchObject({
      rawClaudeText: "{\"total_score\":88}",
    });
    expect(savedArtifacts.get("gv_sess_eval:adecco_eval_status")?.payload).toMatchObject({
      status: "completed",
    });
  });

  it("result API returns completed scorecard without raw Claude text", async () => {
    savedArtifacts.set("gv_sess_eval:scorecard", {
      id: "scorecard",
      kind: "scorecard",
      sessionId: "gv_sess_eval",
      createdAt: "2026-05-16T00:01:00.000Z",
      payload: {
        evaluationFormat: "adecco_order_hearing_browser_v1",
        scenarioId: "scenario",
        sessionId: "gv_sess_eval",
        conversationId: null,
        startedAt: "2026-05-16T00:00:00.000Z",
        endedAt: "2026-05-16T00:01:00.000Z",
        model: "claude-sonnet-4-5-20250929",
        usage: {},
        validation: { ok: true, status: "success" },
        retryNote: "not retried",
        report: { total_score: 88 },
        generatedAt: "2026-05-16T00:01:00.000Z",
      },
    });
    savedArtifacts.set("gv_sess_eval:model_raw_output", {
      id: "model_raw_output",
      kind: "model_raw_output",
      sessionId: "gv_sess_eval",
      createdAt: "2026-05-16T00:01:00.000Z",
      payload: { rawClaudeText: "raw secret-ish model output" },
    });

    const { GET } = await import(
      "../../app/api/grok-first-v50-7/evaluation/result/route"
    );
    const response = await GET(resultRequest("gv_sess_eval"));
    const body = (await response.json()) as { status?: string };
    expect(body.status).toBe("completed");
    expect(JSON.stringify(body)).not.toContain("rawClaudeText");
    expect(JSON.stringify(body)).not.toContain("raw secret-ish model output");
  });
});

describe("AdeccoEvaluationReportView", () => {
  it("renders sparse report data without table layout", async () => {
    const { AdeccoEvaluationReportView } = await import(
      "../../components/roleplay/evaluation/AdeccoEvaluationReportView"
    );
    const html = renderToStaticMarkup(
      <AdeccoEvaluationReportView
        showRawJson={false}
        scorecard={{
          evaluationFormat: "adecco_order_hearing_browser_v1",
          scenarioId: "scenario",
          metadata: {
            sessionId: "mock-session",
            conversationId: null,
            startedAt: "2026-05-16T00:00:00.000Z",
            endedAt: "2026-05-16T00:01:00.000Z",
          },
          report: { total_score: 72, learner_feedback: "よく確認できています。" },
          model: "claude-sonnet-4-5-20250929",
          usage: {},
          validation: { ok: true, status: "success" },
          retryNote: "not retried",
          generatedAt: "2026-05-16T00:01:00.000Z",
        }}
      />
    );
    expect(html).toContain("AIロープレ評価レポート");
    expect(html).toContain("よく確認できています。");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("rawClaudeText");
  });
});
