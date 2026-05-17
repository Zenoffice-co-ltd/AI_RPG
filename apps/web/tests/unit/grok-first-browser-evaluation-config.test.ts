// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  resolveBrowserEvaluationConfig,
  toEvaluationTranscript,
  validateEvaluationTranscript,
} from "../../components/roleplay/GrokFirstV50RoleplayShell";
import type { TranscriptMessage } from "../../lib/roleplay/conversation-types";

describe("grok-first browser evaluation config", () => {
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
