import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdeccoEvaluationResultClient } from "../../components/roleplay/evaluation/AdeccoEvaluationResultClient";

describe("AdeccoEvaluationResultClient v2 mock", () => {
  it("renders v51 mock scorecard sections without leaking raw output", () => {
    const html = renderToStaticMarkup(
      <AdeccoEvaluationResultClient
        sessionId="mock-session"
        mock={true}
        visualTest={false}
        debug={false}
        startFailed={false}
        resultEndpoint="/api/grok-first-v51/evaluation/result"
        retryEndpoint="/api/grok-first-v51/evaluation/retry"
        roleplayPath="/demo/adecco-roleplay-v51"
        mockRuntimeVersion="v51"
      />
    );

    expect(html).toContain("総合評価");
    expect(html).toContain("6大カテゴリ");
    expect(html).toContain("ヒアリング達成度");
    expect(html).toContain("完全取得 / 部分取得 / 未取得");
    expect(html).toContain("最優先改善領域");
    expect(html).toContain("ヒアリング項目の網羅性");
    expect(html).toContain("必須ヒアリング");
    expect(html).toContain("Next Training Actions");
    expect(html).toContain("非言語評価の制約");
    expect(html).toContain("Compliance Flags");
    expect(html).not.toContain("評価基準");
    expect(html).not.toContain("生成時刻");
    expect(html).not.toContain("session");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("rawClaudeText");
    expect(html).not.toContain("relay ticket");
    expect(html).not.toContain("API secret");
    expect(html).not.toContain("hidden system prompt");
  });

  it("renders v50-7-4-d mock scorecard sections without leaking raw output", () => {
    const html = renderToStaticMarkup(
      <AdeccoEvaluationResultClient
        sessionId="mock-session"
        mock={true}
        visualTest={false}
        debug={false}
        startFailed={false}
        resultEndpoint="/api/grok-first-v50-7/evaluation/result"
        retryEndpoint="/api/grok-first-v50-7/evaluation/retry"
        roleplayPath="/demo/adecco-roleplay-v50-7-4-d"
        mockRuntimeVersion="v50-7"
      />
    );

    expect(html).toContain("6大カテゴリ");
    expect(html).toContain("ヒアリング達成度");
    expect(html).toContain("完全取得 / 部分取得 / 未取得");
    expect(html).toContain("最優先改善領域");
    expect(html).toContain("必須ヒアリング");
    expect(html).not.toContain("評価基準");
    expect(html).not.toContain("生成時刻");
    expect(html).not.toContain("session");
    expect(html).not.toContain("rawClaudeText");
    expect(html).not.toContain("relay ticket");
    expect(html).not.toContain("API secret");
    expect(html).not.toContain("hidden system prompt");
  });
});
