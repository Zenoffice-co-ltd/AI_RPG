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

function workerRequest(init: { secret?: string; body?: unknown } = {}) {
  return new NextRequest("http://127.0.0.1:3000/api/internal/adecco-browser-eval", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init.secret ? { "x-queue-shared-secret": init.secret } : {}),
    },
    body: JSON.stringify(
      init.body ?? {
        sessionId: "gv_sess_eval",
        conversationId: null,
        transcript: [
          { turn_id: "u1", speaker: "sales", text: "背景は？", timestamp_sec: 0 },
          { turn_id: "a1", speaker: "client", text: "増員です。", timestamp_sec: 1 },
        ],
        startedAt: "2026-05-16T00:00:00.000Z",
        endedAt: "2026-05-16T00:01:00.000Z",
        source: "grok_first_v50_7_browser",
        runtimeVersion: "v50-7",
      }
    ),
  });
}

describe("v50.7 browser evaluation APIs", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_ACCESS_TOKEN", "demo-secret");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("XAI_RELAY_TICKET_SECRET", "x".repeat(32));
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

  it("keeps v50.7 session prompt and guardrail identity", async () => {
    const { POST } = await import("../../app/api/grok-first-v50-7/session/route");
    const response = await POST(
      apiRequest(
        "http://127.0.0.1:3000/api/grok-first-v50-7/session",
        {}
      )
    );
    const body = (await response.json()) as {
      promptVersion?: string;
      guardrailVersion?: string;
      demoSlug?: string;
      backend?: string;
      browserEvaluationEnabled?: boolean;
    };
    expect(response.status).toBe(200);
    expect(body.demoSlug).toBe("adecco-roleplay-v50-7");
    expect(body.backend).toBe("grok-first-v50-7");
    expect(body.promptVersion).toBe("grok-first-v50.6-2026-05-15");
    expect(body.guardrailVersion).toBe("grok-first-v50.7-guard-2026-05-15");
    expect(body.browserEvaluationEnabled).toBe(true);
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
    const response = await POST(workerRequest({ secret: "queue-secret" }));
    expect(response.status).toBe(200);
    expect(scoringMock).toHaveBeenCalledTimes(1);
    expect(savedArtifacts.get("gv_sess_eval:scorecard")?.payload).toMatchObject({
      evaluationFormat: "adecco_order_hearing_browser_v1",
      evaluationProfile: "adecco_order_hearing_eval_v2",
      runtimeVersion: "v50-7",
      report: { total_score: 88 },
    });
    expect(savedArtifacts.get("gv_sess_eval:model_raw_output")?.payload).toMatchObject({
      rawClaudeText: "{\"total_score\":88}",
    });
    expect(savedArtifacts.get("gv_sess_eval:adecco_eval_status")?.payload).toMatchObject({
      status: "completed",
    });
  });

  it("worker rejects mismatched queue secret", async () => {
    const { POST } = await import("../../app/api/internal/adecco-browser-eval/route");
    const response = await POST(workerRequest({ secret: "wrong-secret" }));
    expect(response.status).toBe(401);
    expect(scoringMock).not.toHaveBeenCalled();
  });

  it("worker stores safe failed status when scoring throws", async () => {
    scoringMock.mockRejectedValueOnce(new Error("provider exploded"));
    const { POST } = await import("../../app/api/internal/adecco-browser-eval/route");
    const response = await POST(workerRequest({ secret: "queue-secret" }));
    const responseBody = (await response.json()) as unknown;
    const failedPayload = savedArtifacts.get(
      "gv_sess_eval:adecco_eval_status"
    )?.payload;
    expect(response.status).toBe(500);
    expect(failedPayload).toMatchObject({
      status: "failed",
      error: "評価に失敗しました。時間をおいて再試行してください。",
    });
    expect(JSON.stringify(failedPayload)).not.toContain("provider exploded");
    expect(JSON.stringify(responseBody)).not.toContain("provider exploded");
  });

  it("result API rejects invalid session id and missing access", async () => {
    const { GET } = await import(
      "../../app/api/grok-first-v50-7/evaluation/result/route"
    );
    const invalid = await GET(resultRequest("../bad"));
    const noAccess = await GET(
      new NextRequest(
        "http://127.0.0.1:3000/api/grok-first-v50-7/evaluation/result?sessionId=gv_sess_eval",
        { method: "GET" }
      )
    );
    expect(invalid.status).toBe(400);
    expect(noAccess.status).toBe(401);
  });

  it("result API returns running, not_found, failed, and completed states", async () => {
    const { GET } = await import(
      "../../app/api/grok-first-v50-7/evaluation/result/route"
    );
    savedArtifacts.set("gv_sess_eval:adecco_eval_status", {
      id: "adecco_eval_status",
      kind: "adecco_eval_status",
      sessionId: "gv_sess_eval",
      createdAt: "2026-05-16T00:00:00.000Z",
      payload: { status: "running" },
    });
    const running = (await (
      await GET(resultRequest("gv_sess_eval"))
    ).json()) as { status?: string };
    expect(running.status).toBe("running");

    savedArtifacts.clear();
    const notFound = (await (
      await GET(resultRequest("gv_sess_eval"))
    ).json()) as { status?: string };
    expect(notFound.status).toBe("not_found");

    savedArtifacts.set("gv_sess_eval:adecco_eval_status", {
      id: "adecco_eval_status",
      kind: "adecco_eval_status",
      sessionId: "gv_sess_eval",
      createdAt: "2026-05-16T00:00:00.000Z",
      payload: { status: "failed" },
    });
    const failed = (await (
      await GET(resultRequest("gv_sess_eval"))
    ).json()) as { status?: string; error?: string };
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("評価に失敗しました。時間をおいて再試行してください。");

    savedArtifacts.clear();
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
    const completed = (await (
      await GET(resultRequest("gv_sess_eval"))
    ).json()) as { status?: string };
    expect(completed.status).toBe("completed");
  });

  it("accepts v51 browser evaluation source and records runtime metadata", async () => {
    const { POST } = await import(
      "../../app/api/grok-first-v51/evaluation/start/route"
    );
    const response = await POST(
      apiRequest("http://127.0.0.1:3000/api/grok-first-v51/evaluation/start", {
        sessionId: "gv_sess_v51_eval",
        transcript: [
          { turn_id: "u1", role: "user", text: "募集背景を教えてください" },
          { turn_id: "a1", role: "agent", text: "増員です。" },
        ],
        source: "grok_first_v51_browser",
      })
    );
    expect(response.status).toBe(202);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const payload = enqueueMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      sessionId: "gv_sess_v51_eval",
      source: "grok_first_v51_browser",
      runtimeVersion: "v51",
    });
    expect(JSON.stringify(payload)).not.toContain("ticket");
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("audio");
    expect(JSON.stringify(payload)).not.toContain("instructions");
  });

  it("result API returns completed scorecard without raw or sensitive fields", async () => {
    savedArtifacts.set("gv_sess_eval:scorecard", {
      id: "scorecard",
      kind: "scorecard",
      sessionId: "gv_sess_eval",
      createdAt: "2026-05-16T00:01:00.000Z",
      payload: {
        evaluationFormat: "adecco_order_hearing_browser_v1",
        evaluationProfile: "adecco_order_hearing_eval_v2",
        runtimeVersion: "v51",
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
      payload: {
        rawClaudeText: "raw secret-ish model output",
        validationJsonText: "validation raw json",
        ticket: "relay-ticket",
        secret: "api-secret",
        audio: "base64-audio",
        instructions: "prompt instructions",
      },
    });

    const { GET } = await import(
      "../../app/api/grok-first-v50-7/evaluation/result/route"
    );
    const response = await GET(resultRequest("gv_sess_eval"));
    const body = (await response.json()) as { status?: string };
    const serialized = JSON.stringify(body);
    expect(body.status).toBe("completed");
    expect(serialized).not.toContain("rawClaudeText");
    expect(serialized).not.toContain("validationJsonText");
    expect(serialized).not.toContain("ticket");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("audio");
    expect(serialized).not.toContain("instructions");
    expect(serialized).not.toContain("raw secret-ish model output");
    expect(serialized).toContain("adecco_order_hearing_eval_v2");
    expect(serialized).toContain("v51");
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
          evaluationProfile: "adecco_order_hearing_eval_v2",
          runtimeVersion: "v51",
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
