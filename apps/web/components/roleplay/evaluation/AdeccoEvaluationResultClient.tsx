"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./AdeccoEvaluationReportView.module.css";
import { AdeccoEvaluationReportView } from "./AdeccoEvaluationReportView";
import type {
  AdeccoBrowserEvaluationResult,
  AdeccoBrowserEvaluationScorecard,
} from "./types";

function c(name: string) {
  return styles[name] ?? name;
}

const POLL_INTERVAL_MS = 2_000;

export function AdeccoEvaluationResultClient({
  sessionId,
  mock,
  visualTest,
  startFailed,
  resultEndpoint = "/api/grok-first-v50-7/evaluation/result",
  retryEndpoint = "/api/grok-first-v50-7/evaluation/retry",
  roleplayPath = "/demo/adecco-roleplay-v50-7",
  mockRuntimeVersion = "v50-7",
}: {
  sessionId: string;
  mock: boolean;
  visualTest: boolean;
  debug: boolean;
  startFailed: boolean;
  resultEndpoint?: string;
  retryEndpoint?: string;
  roleplayPath?: string;
  mockRuntimeVersion?: "v50-7" | "v51";
}) {
  const [result, setResult] = useState<AdeccoBrowserEvaluationResult | null>(
    mock || visualTest
      ? {
          ok: true,
          status: "completed",
          sessionId,
          scorecard: buildMockScorecard(sessionId, mockRuntimeVersion),
        }
      : null
  );
  const [retrying, setRetrying] = useState(false);

  const fetchResult = useCallback(async () => {
    const response = await fetch(
      `${resultEndpoint}?sessionId=${encodeURIComponent(
        sessionId
      )}`
    );
    if (!response.ok) {
      throw new Error("result fetch failed");
    }
    return (await response.json()) as AdeccoBrowserEvaluationResult;
  }, [resultEndpoint, sessionId]);

  useEffect(() => {
    if (mock || visualTest) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const next = await fetchResult();
        if (cancelled) return;
        setResult(next);
        if (
          next.status === "completed" ||
          next.status === "failed"
        ) {
          return;
        }
        timer = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) {
          timer = setTimeout(() => {
            void poll();
          }, POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchResult, mock, visualTest]);

  const retry = async () => {
    setRetrying(true);
    try {
      const response = await fetch(retryEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (response.ok) {
        setResult({ ok: true, status: "queued", sessionId });
        return;
      }
      setResult({
        ok: false,
        status: "failed",
        sessionId,
        error: "この結果ページからは再試行できません。ロープレを再実施してください。",
        retryAvailable: false,
      });
    } finally {
      setRetrying(false);
    }
  };

  if (result?.status === "completed") {
    return (
      <AdeccoEvaluationReportView
        scorecard={result.scorecard}
        roleplayPath={roleplayPath}
      />
    );
  }

  return (
    <div className={c("page")}>
      <header className={c("topbar")}>
        <a className={c("brand")} href="https://mendan.biz/">
          MENDAN
        </a>
        <div className={c("title")}>AIロープレ評価レポート</div>
        <div className={c("actions")}>
          <a className={c("buttonSecondary")} href={roleplayPath}>
            ロープレに戻る
          </a>
          <a className={c("button")} href={roleplayPath}>
            再実施
          </a>
        </div>
      </header>

      <main className={c("shell")}>
        <section className={`${c("panel")} ${c("stateBox")}`}>
          {result?.status === "failed" || startFailed ? (
            <>
              <h1 className={c("panelTitle")}>評価を開始できませんでした</h1>
              <p className={c("bodyText")}>
                {result?.status === "failed"
                  ? result.error
                  : "評価開始リクエストに失敗しました。"}
              </p>
              {result?.status === "failed" && result.retryAvailable ? (
                <button
                  className={c("button")}
                  disabled={retrying}
                  onClick={() => {
                    void retry();
                  }}
                  type="button"
                >
                  {retrying ? "再試行中..." : "評価を再試行"}
                </button>
              ) : (
                <p className={c("bodyText")}>
                  このページから再実行できない場合は、ロープレを再実施してください。
                </p>
              )}
            </>
          ) : (
            <>
              <div className={c("spinner")} />
              <h1 className={c("panelTitle")}>採点中です</h1>
              <p className={c("bodyText")}>
                採点が完了すると、このページに評価レポートが表示されます。採点には4-5分かかりますので、しばらくお待ちください。
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function buildMockScorecard(
  sessionId: string,
  runtimeVersion: "v50-7" | "v51"
): AdeccoBrowserEvaluationScorecard {
  const now = new Date().toISOString();
  return {
    evaluationFormat: "adecco_order_hearing_browser_v1",
    evaluationProfile: "adecco_order_hearing_eval_v2",
    runtimeVersion,
    scenarioId:
      runtimeVersion === "v51"
        ? "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v51"
        : "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
    metadata: {
      sessionId,
      conversationId: "mock-conversation",
      startedAt: now,
      endedAt: now,
    },
    model: "claude-sonnet-4-5-20250929",
    usage: { input_tokens: 3200, output_tokens: 1800 },
    validation: {
      ok: true,
      status: "success: required and additional top-level keys present",
    },
    retryNote: "not retried",
    generatedAt: now,
    report: {
      schema_version: "adecco_order_hearing_eval_v2",
      total_score: 78.5,
      grade_label: "B",
      score_confidence: "high",
      must_capture_summary: {
        weighted_capture_ratio: 0.74,
        count_capture_ratio: 0.67,
        captured_count: 12,
        partial_count: 3,
        missed_count: 3,
        weighted_coverage_points: 22.2,
      },
      rubric_scores: {
        coverage: {
          label: "ヒアリング項目の網羅性",
          points: 23,
          max_points: 30,
          reason: "募集背景、業務内容、条件面は押さえられていますが、決定プロセスの深掘りに余地があります。",
        },
        hearing_skill: {
          label: "ヒアリングスキル",
          points: 15,
          max_points: 20,
          reason: "質問の流れが自然で、相手の回答を踏まえた追加確認ができています。",
        },
        priority_clarity: {
          label: "優先順位の明確化",
          points: 14,
          max_points: 20,
          reason: "必須経験は確認できましたが、must/want の切り分けがもう一段あるとよいです。",
        },
        deal_structure: {
          label: "商談の全体構成力",
          points: 8,
          max_points: 10,
          reason: "開始時期から提案期限まで整理できており、次アクションも明確です。",
        },
        business_behavior: {
          label: "商談時の振る舞い",
          points: 8,
          max_points: 10,
          reason: "丁寧で落ち着いた対応です。確認の粒度も実務的でした。",
        },
        closing: {
          label: "クロージング",
          points: 7,
          max_points: 10,
          reason: "提案期限は合意できましたが、候補者提案後の判断者確認を補足できるとさらに良いです。",
        },
      },
      must_capture_items: Array.from({ length: 18 }, (_, index) => ({
        id: index + 1,
        label: [
          "募集背景",
          "業務内容",
          "業務量",
          "開始日",
          "勤務時間",
          "残業",
          "在宅可否",
          "必須経験",
          "歓迎条件",
          "人物面",
          "単価レンジ",
          "競合状況",
          "提案期限",
          "職場見学",
          "決定プロセス",
          "引継ぎ",
          "職場環境",
          "次回アクション",
        ][index],
        weight_points: index === 10 ? 5 : 1,
        capture_level: index < 12 ? 1 : index < 15 ? 0.5 : 0,
        captured_by_sales: index < 15,
        client_disclosed_without_prompt: false,
        judgement: index < 12 ? "captured" : index < 15 ? "partial" : "missed",
        missing_detail:
          index < 12 ? null : index < 15 ? "確認はありますが粒度が浅いです。" : "会話内で確認できていません。",
        evidence: [
          {
            turn_id: `t${String(index + 1).padStart(3, "0")}`,
            speaker: index < 12 ? "sales" : "unknown",
            quote: index < 12 ? "会話内で確認済みです。" : "",
            why_relevant: "該当項目の確認根拠です。",
          },
        ],
      })),
      must_capture_groups: buildMockMustCaptureGroups(),
      modality_limitations: [
        "この評価は会話テキストを根拠としており、声量・表情・視線・姿勢・メモ中の態度は直接評価していません。商談時の振る舞いは、発話の簡潔さ、傾聴姿勢、相手の発言を受けた確認・要約から評価しています。",
      ],
      sales_compliance_flags: {
        inappropriate_demographic_requirement_deepened: false,
        inappropriate_requirement_reframed: true,
        details: [
          {
            flag_type: "inappropriate_requirement_reframed",
            turn_id: "t011",
            quote: "年齢ではなく、受発注経験や社外調整の経験を重視する理解でよろしいですか。",
            impact:
              "年齢条件を候補者選定要件として扱わず、職務関連要件に置き換えています。",
          },
        ],
      },
      strengths: [
        "募集背景から条件面まで、確認の順序が自然でした。",
        "提案期限を明確に合意できています。",
      ],
      improvement_points: [
        "決定者と現場判断の流れをもう一段具体化すると、提案後の動きが明確になります。",
        "must と want の優先順位を切り分けて確認できると候補者選定に使いやすくなります。",
      ],
      learner_feedback:
        "全体として、初回ヒアリングに必要な主要条件を丁寧に確認できています。次回は、競合状況と決定プロセスをつなげて確認し、提案後の進め方まで合意できるとさらに実践的です。",
      next_training_actions: [
        "条件確認後に「必須と歓迎を分けるとどうなりますか」と確認する。",
        "職場見学から決定までの判断者と日数をセットで確認する。",
        "最後に提案期限、候補者像、次回連絡方法を一文で要約する。",
      ],
    },
  };
}

function buildMockMustCaptureGroups() {
  const labels = [
    ["background", "募集背景"],
    ["job_scope", "業務内容"],
    ["working_conditions", "就業条件"],
    ["selection_requirements", "人選要件"],
    ["workplace_environment", "職場環境"],
    ["workplace_climate", "職場の雰囲気"],
    ["other_process", "その他"],
    ["closing", "クロージング"],
  ] as const;
  return labels.map(([group_id, group_label], index) => ({
    group_id,
    group_label,
    items: [
      {
        id: index + 1,
        label: `${group_label}の確認`,
        weight_points: index < 4 ? 2 : 1,
        capture_level: index < 5 ? 1 : 0.5,
        captured_by_sales: true,
        client_disclosed_without_prompt: false,
        judgement: index < 5 ? "captured" : "partial",
        missing_detail: index < 5 ? null : "一部、確認期限の具体化に余地があります。",
        evidence: [
          {
            turn_id: `g${index + 1}`,
            speaker: "sales",
            quote: "必要条件と次の確認事項を整理しています。",
            why_relevant: `${group_label}に関する確認根拠です。`,
          },
        ],
      },
    ],
  }));
}
