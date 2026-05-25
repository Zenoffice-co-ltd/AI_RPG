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
  const [pollEpoch, setPollEpoch] = useState(0);

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
    if (mock || visualTest || startFailed) return;
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
  }, [fetchResult, mock, visualTest, startFailed, pollEpoch]);

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
        setPollEpoch((value) => value + 1);
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
      total_score: 74.5,
      grade_label: "B",
      score_confidence: "high",
      roleplay_name: "住宅設備メーカー営業事務1名",
      must_capture_summary: {
        weighted_capture_ratio: 0.7,
        count_capture_ratio: 0.33,
        captured_count: 4,
        partial_count: 8,
        missed_count: 0,
        weighted_coverage_points: 21,
      },
      rubric_scores: {
        coverage: {
          label: "ヒアリング項目の網羅性",
          points: 21,
          max_points: 30,
          reason: "明示確認できた項目だけを加点すると、完全取得は4項目です。未確認の小項目を推測で補わないため、網羅性は70%です。",
        },
        hearing_skill: {
          label: "ヒアリングスキル",
          points: 16,
          max_points: 20,
          reason: "質問は明確で深掘りもありますが、1日の流れや職場環境の細部など、確認すべき粒度の取り残しがあります。",
        },
        priority_clarity: {
          label: "優先順位の明確化",
          points: 15,
          max_points: 20,
          reason: "必須/歓迎、期限優先、時給調整余地は確認できています。緩和可能条件や複数要件の順位づけは時系列不足です。",
        },
        deal_structure: {
          label: "商談の全体構成力",
          points: 8,
          max_points: 10,
          reason: "流れは自然ですが、条件確認からクロージングまでの中で未確認項目が残っています。",
        },
        business_behavior: {
          label: "商談時の振る舞い",
          points: 8,
          max_points: 10,
          reason: "簡潔で丁寧な進行です。ただし短いやり取りに詰まり、確認・要約の粒度は限定的です。",
        },
        closing: {
          label: "クロージング",
          points: 6.5,
          max_points: 10,
          reason: "候補提示期限と面談枠候補までは合意できていますが、連絡方法、担当者、確認期限は明示されていません。",
        },
      },
      must_capture_items: ([
        ["募集背景", 8, "captured", "住宅設備メーカーの営業事務1名募集と受注処理増加による増員背景を確認。"],
        ["業務内容・1日の流れ", 9, "partial", "受注入力中心の業務に把握。1日の流れや具体的な作業比率は未確認。"],
        ["業務量・繁忙・引継ぎ", 7, "partial", "納期遅延時の影響と独り立ち目安は確認。業務量・繁忙サイクルは追加確認余地あり。"],
        ["就業開始日・期間", 6, "partial", "来月1日に初回1名、残り2名は2週間後までという元タイミングは確認。契約期間は未確認。"],
        ["曜日・時間・残業・リモート", 6, "partial", "平日9時から18時、月末30分程度の残業可能性は確認。休憩、リモート有無は未確認。"],
        ["料金・交通費・直接雇用", 4, "partial", "時給1600円前後と交通費別途支給を確認。直接雇用可能性は未確認。"],
        ["必須要件・ベター要件", 10, "captured", "受注入力経験、Excel、物流業界経験、社内チャット経験、NG条件を確認。"],
        ["優先順位の明確化", 10, "captured", "開始時期の重要度、必須/歓迎、時給調整余地まで確認できています。"],
        ["職場環境", 7, "partial", "社員2名、派遣4名、SVフォローを確認。年齢層、服装、施設は未確認。"],
        ["雰囲気・NG人物像", 7, "partial", "電話対応や正確性重視のNGは確認。職場の雰囲気や合う人物像はやや浅いです。"],
        ["競合・見学・決定プロセス", 12, "captured", "選考フロー、職場見学、決裁者、競合2社の進行を確認。"],
        ["連絡方法・スケジュール・ネクストステップ", 14, "partial", "社内共有、候補提示期限、面談枠候補を示し合意。連絡方法、窓口、候補確認期限は未確認。"],
      ] as const).map(([label, weight, judgement, note], index) => ({
        id: index + 1,
        label,
        weight_points: weight,
        capture_level: judgement === "captured" ? 1 : 0.5,
        captured_by_sales: true,
        client_disclosed_without_prompt: false,
        judgement,
        missing_detail: judgement === "captured" ? null : note,
        evidence: [
          {
            turn_id: `t${String(index + 1).padStart(3, "0")}`,
            speaker: "sales",
            quote: note,
            why_relevant: "該当項目の確認根拠です。",
          },
        ],
      })),
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
        "期限遅延時の影響まで聞けており、緊急度が明確です。",
        "競合状況と決裁者まで押さえ、提案優先を判断しやすいです。",
        "終盤で要約し、候補提示と面談枠の進め方まで合意できています。",
      ],
      improvement_points: [
        "1日の業務の流れと作業比率を確認する。",
        "職場の雰囲気、年齢層、服装、施設など候補者説明に必要な細部を拾う。",
        "直接雇用可能性を条件確認の中で一言確認する。",
      ],
      learner_feedback:
        "募集背景、必須/歓迎条件、選考フロー、競合状況は確認できています。一方で、1日の業務の流れ、契約期間、リモート有無、直接雇用、職場環境の細部、連絡方法までは確認できていません。短い会話でも推測で補完せず、聞けていない項目は部分取得として扱う評価です。",
      next_training_actions: [
        "終話前に「候補者提示後は、どなたに、どの方法で、いつまでにご確認いただく流れがよろしいですか」と聞く。",
        "業務内容確認時に「1日の流れとして、午前・午後でどの作業が多いですか」と聞く。",
        "条件確認の最後に、直接雇用可能性と長期就業前提の有無を確認する。",
      ],
    },
  };
}
