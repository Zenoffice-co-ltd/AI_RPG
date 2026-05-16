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
const POLL_TIMEOUT_MS = 90_000;

export function AdeccoEvaluationResultClient({
  sessionId,
  mock,
  visualTest,
  debug,
  startFailed,
}: {
  sessionId: string;
  mock: boolean;
  visualTest: boolean;
  debug: boolean;
  startFailed: boolean;
}) {
  const [result, setResult] = useState<AdeccoBrowserEvaluationResult | null>(
    mock || visualTest
      ? {
          ok: true,
          status: "completed",
          sessionId,
          scorecard: buildMockScorecard(sessionId),
        }
      : null
  );
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const fetchResult = useCallback(async () => {
    const response = await fetch(
      `/api/grok-first-v50-7/evaluation/result?sessionId=${encodeURIComponent(
        sessionId
      )}`
    );
    if (!response.ok) {
      throw new Error("result fetch failed");
    }
    return (await response.json()) as AdeccoBrowserEvaluationResult;
  }, [sessionId]);

  useEffect(() => {
    if (mock || visualTest) return;
    let cancelled = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const next = await fetchResult();
        if (cancelled) return;
        setResult(next);
        if (
          next.status === "completed" ||
          next.status === "failed" ||
          Date.now() - startedAt > POLL_TIMEOUT_MS
        ) {
          setTimedOut(next.status !== "completed" && next.status !== "failed");
          return;
        }
        timer = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            setTimedOut(true);
            return;
          }
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
      const response = await fetch("/api/grok-first-v50-7/evaluation/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (response.ok) {
        setTimedOut(false);
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
        showRawJson={debug || visualTest}
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
          <a className={c("buttonSecondary")} href="/demo/adecco-roleplay-v50-7">
            ロープレに戻る
          </a>
          <a className={c("button")} href="/demo/adecco-roleplay-v50-7">
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
                Claude 採点が完了すると、このページに評価レポートが表示されます。
              </p>
              {timedOut ? (
                <p className={c("bodyText")}>
                  まだ採点中です。しばらくして更新してください。
                </p>
              ) : null}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function buildMockScorecard(sessionId: string): AdeccoBrowserEvaluationScorecard {
  const now = new Date().toISOString();
  return {
    evaluationFormat: "adecco_order_hearing_browser_v1",
    scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
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
      total_score: 78.5,
      grade_label: "B",
      score_confidence: "high",
      must_capture_summary: {
        weighted_capture_ratio: 0.74,
        count_capture_ratio: 0.67,
        captured_count: 12,
        partial_count: 3,
        missed_count: 3,
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
          points: 8,
          max_points: 10,
          reason: "質問の流れが自然で、相手の回答を踏まえた追加確認ができています。",
        },
        priority_clarity: {
          label: "優先順位の明確化",
          points: 7,
          max_points: 10,
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
        judgement: index < 12 ? "captured" : index < 15 ? "partial" : "missed",
        evidence: [
          {
            quote: index < 12 ? "会話内で確認済みです。" : "",
          },
        ],
      })),
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
