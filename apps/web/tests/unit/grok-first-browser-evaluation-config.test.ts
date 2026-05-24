// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseBetterEvaluationSnapshot,
  endAndStartBrowserEvaluation,
  resolveBrowserEvaluationConfig,
  toEvaluationTranscript,
  validateEvaluationTranscript,
} from "../../components/roleplay/GrokFirstV50RoleplayShell";
import type { useGrokFirstRoleplayConversation } from "../../lib/grok-first-roleplay/useGrokFirstRoleplayConversation";
import type { TranscriptMessage } from "../../lib/roleplay/conversation-types";

describe("grok-first browser evaluation config", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses session browserEvaluation as the source of truth", () => {
    expect(
      resolveBrowserEvaluationConfig(
        "/api/grok-first-v51",
        {
          enabled: true,
          startEndpoint: "/api/grok-first-v51/evaluation/start",
          resultBasePath: "/demo/adecco-roleplay-v51/result",
          source: "grok_first_v51_browser",
          runtimeVersion: "v51",
        },
        false
      )
    ).toMatchObject({
      enabled: true,
      startEndpoint: "/api/grok-first-v51/evaluation/start",
      resultBasePath: "/demo/adecco-roleplay-v51/result",
      source: "grok_first_v51_browser",
      runtimeVersion: "v51",
    });
  });

  it("keeps the v50-7 fallback for existing sessions", () => {
    expect(
      resolveBrowserEvaluationConfig("/api/grok-first-v50-7", undefined, true)
    ).toMatchObject({
      enabled: true,
      startEndpoint: "/api/grok-first-v50-7/evaluation/start",
      resultBasePath: "/demo/adecco-roleplay-v50-7/result",
      source: "grok_first_v50_7_browser",
      runtimeVersion: "v50-7",
    });
  });

  it("uses v50-7-4 session result path when provided by the session contract", () => {
    expect(
      resolveBrowserEvaluationConfig(
        "/api/grok-first-v50-7-4",
        {
          enabled: true,
          startEndpoint: "/api/grok-first-v50-7/evaluation/start",
          resultBasePath: "/demo/adecco-roleplay-v50-7-4/result",
          source: "grok_first_v50_7_browser",
          runtimeVersion: "v50-7",
        },
        false
      )
    ).toMatchObject({
      enabled: true,
      startEndpoint: "/api/grok-first-v50-7/evaluation/start",
      resultBasePath: "/demo/adecco-roleplay-v50-7-4/result",
      source: "grok_first_v50_7_browser",
      runtimeVersion: "v50-7",
    });
  });

  it("uses v50-7-4-d session result path when provided by the session contract", () => {
    expect(
      resolveBrowserEvaluationConfig(
        "/api/grok-first-v50-7-4-d",
        {
          enabled: true,
          startEndpoint: "/api/grok-first-v50-7/evaluation/start",
          resultBasePath: "/demo/adecco-roleplay-v50-7-4-d/result",
          source: "grok_first_v50_7_browser",
          runtimeVersion: "v50-7",
        },
        false
      )
    ).toMatchObject({
      enabled: true,
      startEndpoint: "/api/grok-first-v50-7/evaluation/start",
      resultBasePath: "/demo/adecco-roleplay-v50-7-4-d/result",
      source: "grok_first_v50_7_browser",
      runtimeVersion: "v50-7",
    });
  });

  it("fails browser evaluation when sales-side transcript is missing", () => {
    const transcript = toEvaluationTranscript([
      transcriptMessage("agent", "初回のご相談ですね。", "final"),
      transcriptMessage("system", "debug marker", "final"),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({ role: "agent", text: "初回のご相談ですね。" }),
    ]);
    expect(validateEvaluationTranscript(transcript)).toMatchObject({
      ok: false,
      reason: "missing_sales_transcript",
      userTurns: 0,
      agentTurns: 1,
    });
  });

  it("accepts browser evaluation only when sales and client turns are present", () => {
    const transcript = toEvaluationTranscript([
      transcriptMessage("user", "募集背景を教えてください", "final"),
      transcriptMessage("agent", "増員です。", "final"),
      transcriptMessage("user", "入力中", "interim"),
    ]);

    expect(validateEvaluationTranscript(transcript)).toMatchObject({
      ok: true,
      userTurns: 1,
      agentTurns: 1,
      turnCount: 2,
    });
  });

  it("keeps firstMessage and the first sales turn in a valid evaluation transcript", () => {
    const transcript = toEvaluationTranscript([
      transcriptMessage("agent", "お電話ありがとうございます。", "final"),
      transcriptMessage("user", "募集背景を教えてください", "final"),
      transcriptMessage("agent", "増員です。", "final"),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({
        role: "agent",
        text: "お電話ありがとうございます。",
      }),
      expect.objectContaining({
        role: "user",
        text: "募集背景を教えてください",
      }),
      expect.objectContaining({ role: "agent", text: "増員です。" }),
    ]);
    expect(validateEvaluationTranscript(transcript)).toMatchObject({
      ok: true,
      userTurns: 1,
      agentTurns: 2,
      turnCount: 3,
    });
  });

  it("fails browser evaluation when client-side transcript is missing", () => {
    const transcript = toEvaluationTranscript([
      transcriptMessage("user", "募集背景を教えてください", "final"),
      transcriptMessage("system", "debug marker", "final"),
    ]);

    expect(validateEvaluationTranscript(transcript)).toMatchObject({
      ok: false,
      reason: "missing_client_transcript",
      userTurns: 1,
      agentTurns: 0,
    });
  });

  it("chooses a post-end snapshot when it is the first valid transcript", () => {
    const preEnd = [
      transcriptMessage("agent", "お電話ありがとうございます。", "final"),
    ];
    const postEnd = [
      ...preEnd,
      transcriptMessage("user", "募集背景を教えてください", "final"),
    ];

    expect(chooseBetterEvaluationSnapshot(preEnd, postEnd)).toEqual(postEnd);
  });

  it("chooses the snapshot with more completed transcript turns when both are valid", () => {
    const preEnd = [
      transcriptMessage("agent", "お電話ありがとうございます。", "final"),
      transcriptMessage("user", "募集背景を教えてください", "final"),
    ];
    const postEnd = [
      ...preEnd,
      transcriptMessage("agent", "増員です。", "final"),
      transcriptMessage("user", "人数は何名ですか", "interim"),
    ];

    expect(chooseBetterEvaluationSnapshot(preEnd, postEnd)).toEqual(postEnd);
  });

  it("starts browser evaluation from the latest v50-7-4-d transcript and redirects", async () => {
    const preEnd = [
      transcriptMessage("agent", "お電話ありがとうございます。", "final"),
    ];
    const postEnd = [
      ...preEnd,
      transcriptMessage("user", "募集背景を教えてください", "final"),
      transcriptMessage("agent", "増員です。", "final"),
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const push = vi.fn();
    const roleplay = {
      session: { sessionId: "gfv50_7_4_d_eval" },
      messages: preEnd,
      getLatestTranscriptSnapshot: vi
        .fn()
        .mockReturnValueOnce(preEnd)
        .mockReturnValueOnce(postEnd),
      endConversation: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useGrokFirstRoleplayConversation>;

    await endAndStartBrowserEvaluation({
      roleplay,
      router: { push } as never,
      browserEvaluation: {
        enabled: true,
        startEndpoint: "/api/grok-first-v50-7/evaluation/start",
        resultBasePath: "/demo/adecco-roleplay-v50-7-4-d/result",
        source: "grok_first_v50_7_browser",
        runtimeVersion: "v50-7",
      },
      isEndingAndRedirecting: false,
      setIsEndingAndRedirecting: vi.fn(),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/grok-first-v50-7/evaluation/start",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      sessionId: "gfv50_7_4_d_eval",
      source: "grok_first_v50_7_browser",
    });
    expect(body["transcript"]).toEqual([
      expect.objectContaining({ role: "agent", text: "お電話ありがとうございます。" }),
      expect.objectContaining({ role: "user", text: "募集背景を教えてください" }),
      expect.objectContaining({ role: "agent", text: "増員です。" }),
    ]);
    expect(push).toHaveBeenCalledWith(
      "/demo/adecco-roleplay-v50-7-4-d/result/gfv50_7_4_d_eval"
    );
  });

  it("redirects with startFailed when evaluation start fails", async () => {
    const messages = [
      transcriptMessage("agent", "お電話ありがとうございます。", "final"),
      transcriptMessage("user", "募集背景を教えてください", "final"),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const push = vi.fn();
    const roleplay = {
      session: { sessionId: "gfv50_7_4_d_eval" },
      messages,
      getLatestTranscriptSnapshot: vi.fn().mockReturnValue(messages),
      endConversation: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useGrokFirstRoleplayConversation>;

    await endAndStartBrowserEvaluation({
      roleplay,
      router: { push } as never,
      browserEvaluation: {
        enabled: true,
        startEndpoint: "/api/grok-first-v50-7/evaluation/start",
        resultBasePath: "/demo/adecco-roleplay-v50-7-4-d/result",
        source: "grok_first_v50_7_browser",
        runtimeVersion: "v50-7",
      },
      isEndingAndRedirecting: false,
      setIsEndingAndRedirecting: vi.fn(),
    });

    expect(push).toHaveBeenCalledWith(
      "/demo/adecco-roleplay-v50-7-4-d/result/gfv50_7_4_d_eval?startFailed=1"
    );
  });
});

function transcriptMessage(
  role: TranscriptMessage["role"],
  text: string,
  status: TranscriptMessage["status"]
): TranscriptMessage {
  return {
    id: `${role}-${text}`,
    role,
    channel: role === "system" ? "system" : "voice",
    text,
    status,
    source: role === "system" ? "system" : "local",
    createdAt: 0,
  };
}
