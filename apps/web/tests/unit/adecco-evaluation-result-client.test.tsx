// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdeccoEvaluationResultClient } from "../../components/roleplay/evaluation/AdeccoEvaluationResultClient";
import { AdeccoEvaluationReportView } from "../../components/roleplay/evaluation/AdeccoEvaluationReportView";
import type { AdeccoBrowserEvaluationScorecard } from "../../components/roleplay/evaluation/types";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
    expect(html).not.toContain("非言語評価の制約");
    expect(html).not.toContain("Compliance Flags");
    expect(html).not.toContain("Debug");
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
    expect(html).not.toContain("非言語評価の制約");
    expect(html).not.toContain("Compliance Flags");
    expect(html).not.toContain("Debug");
    expect(html).not.toContain("評価基準");
    expect(html).not.toContain("生成時刻");
    expect(html).not.toContain("session");
    expect(html).not.toContain("rawClaudeText");
    expect(html).not.toContain("relay ticket");
    expect(html).not.toContain("API secret");
    expect(html).not.toContain("hidden system prompt");
  });

  it("keeps polling after the previous 90 second window and renders the completed report", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount += 1;
        return {
          ok: true,
          json: async () =>
            callCount < 48
              ? { ok: true, status: "queued", sessionId: "session-poll" }
              : {
                  ok: true,
                  status: "completed",
                  sessionId: "session-poll",
                  scorecard: buildScorecard(),
                },
        };
      })
    );

    render(
      <AdeccoEvaluationResultClient
        sessionId="session-poll"
        mock={false}
        visualTest={false}
        debug={false}
        startFailed={false}
      />
    );

    expect(
      screen.getByText(
        "採点が完了すると、このページに評価レポートが表示されます。採点には4-5分かかりますので、しばらくお待ちください。"
      )
    ).toBeTruthy();

    for (let i = 0; i < 48; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(2_000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(screen.getByText("総合評価")).toBeTruthy();
    expect(callCount).toBeGreaterThan(47);
  });

  it("renders the failed state when the result endpoint fails closed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: false,
          status: "failed",
          sessionId: "session-failed",
          error: "評価に失敗しました。",
          retryAvailable: false,
        }),
      }))
    );

    render(
      <AdeccoEvaluationResultClient
        sessionId="session-failed"
        mock={false}
        visualTest={false}
        debug={false}
        startFailed={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("評価を開始できませんでした")).toBeTruthy();
    });
  });

  it("hides debug-only and machine turn identifiers from visible report text", () => {
    const html = renderToStaticMarkup(
      <AdeccoEvaluationReportView
        scorecard={buildScorecard({
          rubricReason: "turn_id 12 の営業側の確認で条件を整理しています。",
          missingDetail: "turn 12 で決定権者の確認が不足しています。",
          feedback: "t012 の発話を踏まえると、次は期限確認が必要です。",
          improvement: "g12 に頼らず候補者提示日を確認してください。",
        })}
        roleplayPath="/demo/adecco-roleplay-v50-7-4-d"
      />
    );

    expect(html).not.toContain("turn_id 12");
    expect(html).not.toContain("turn 12");
    expect(html).not.toContain("t012");
    expect(html).not.toContain("g12");
    expect(html).not.toContain("Debug");
    expect(html).not.toContain("非言語評価の制約");
    expect(html).not.toContain("Compliance Flags");
  });
});

function buildScorecard(overrides: {
  rubricReason?: string;
  missingDetail?: string;
  feedback?: string;
  improvement?: string;
} = {}): AdeccoBrowserEvaluationScorecard {
  const reason = overrides.rubricReason ?? "募集背景と条件を確認できています。";
  const now = "2026-05-24T00:00:00.000Z";
  return {
    evaluationFormat: "adecco_order_hearing_browser_v1",
    evaluationProfile: "adecco_order_hearing_eval_v2",
    runtimeVersion: "v50-7",
    scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
    metadata: {
      sessionId: "session-poll",
      conversationId: "conversation",
      startedAt: now,
      endedAt: now,
    },
    model: "claude-sonnet-4-5-20250929",
    usage: { input_tokens: 1, output_tokens: 1 },
    validation: { ok: true, status: "success" },
    retryNote: "not retried",
    generatedAt: now,
    report: {
      schema_version: "adecco_order_hearing_eval_v2",
      total_score: 78.5,
      grade_label: "B",
      score_confidence: "high",
      must_capture_summary: {
        weighted_capture_ratio: 0.75,
        count_capture_ratio: 0.75,
        captured_count: 1,
        partial_count: 1,
        missed_count: 0,
        weighted_coverage_points: 22.5,
      },
      rubric_scores: {
        coverage: {
          label: "ヒアリング項目の網羅性",
          points: 22.5,
          max_points: 30,
          reason,
          evidence: [],
        },
        hearing_skill: {
          label: "ヒアリングスキル",
          points: 16,
          max_points: 20,
          reason,
          evidence: [],
        },
        priority_clarity: {
          label: "優先順位の明確化",
          points: 16,
          max_points: 20,
          reason,
          evidence: [],
        },
        deal_structure: {
          label: "商談の全体構成力",
          points: 8,
          max_points: 10,
          reason,
          evidence: [],
        },
        business_behavior: {
          label: "商談時の振る舞い",
          points: 8,
          max_points: 10,
          reason,
          evidence: [],
        },
        closing: {
          label: "クロージング",
          points: 8,
          max_points: 10,
          reason,
          evidence: [],
        },
      },
      must_capture_items: [
        {
          id: 1,
          label: "募集背景・新規ベンダー検討理由",
          weight_points: 2,
          capture_level: 1,
          captured_by_sales: true,
          client_disclosed_without_prompt: false,
          judgement: "captured",
          missing_detail: null,
          evidence: [
            {
              turn_id: "t012",
              speaker: "sales",
              quote: "募集背景を教えてください。",
              why_relevant: "背景確認です。",
            },
          ],
        },
        {
          id: 2,
          label: "決定プロセス・決定権者",
          weight_points: 2,
          capture_level: 0.5,
          captured_by_sales: true,
          client_disclosed_without_prompt: false,
          judgement: "partial",
          missing_detail: overrides.missingDetail ?? "最終決裁者の確認に余地があります。",
          evidence: [],
        },
      ],
      learner_feedback:
        overrides.feedback ?? "全体として、要件の整理と確認ができています。",
      strengths: ["相手の回答を受けて条件整理ができています。"],
      improvement_points: [
        overrides.improvement ?? "決定プロセスをもう一段具体化しましょう。",
      ],
      next_training_actions: [
        overrides.improvement ?? "候補者提示日と連絡方法を終盤で確認しましょう。",
      ],
      modality_limitations: ["音声・映像は直接評価していません。"],
      sales_compliance_flags: {
        inappropriate_demographic_requirement_deepened: false,
        inappropriate_requirement_reframed: false,
        details: [],
      },
    },
  };
}
