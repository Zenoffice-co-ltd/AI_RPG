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
    expect(html).toContain("Rubric Breakdown");
    expect(html).toContain("ヒアリング項目の網羅性");
    expect(html).toContain("Must Capture Groups");
    expect(html).toContain("Next Training Actions");
    expect(html).toContain("非言語評価の制約");
    expect(html).toContain("Compliance Flags");
    expect(html).toContain("adecco_order_hearing_eval_v2");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("rawClaudeText");
    expect(html).not.toContain("relay ticket");
    expect(html).not.toContain("API secret");
    expect(html).not.toContain("hidden system prompt");
  });
});
