// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveBrowserEvaluationConfig } from "../../components/roleplay/GrokFirstV50RoleplayShell";

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
});
