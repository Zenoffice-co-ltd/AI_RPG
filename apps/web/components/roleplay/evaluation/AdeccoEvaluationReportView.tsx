"use client";

import styles from "./AdeccoEvaluationReportView.module.css";
import type { AdeccoBrowserEvaluationScorecard } from "./types";

function c(name: string) {
  return styles[name] ?? name;
}

type ReportViewProps = {
  scorecard: AdeccoBrowserEvaluationScorecard;
  showRawJson?: boolean;
  roleplayPath?: string;
};

const RUBRIC_ORDER = [
  ["coverage", "ヒアリング項目の網羅性"],
  ["hearing_skill", "ヒアリングスキル"],
  ["priority_clarity", "優先順位の明確化"],
  ["deal_structure", "商談の全体構成力"],
  ["business_behavior", "商談時の振る舞い"],
  ["closing", "クロージング"],
] as const;

const RUBRIC_MAX_POINTS: Record<(typeof RUBRIC_ORDER)[number][0], number> = {
  coverage: 30,
  hearing_skill: 20,
  priority_clarity: 20,
  deal_structure: 10,
  business_behavior: 10,
  closing: 10,
};

export function AdeccoEvaluationReportView({
  scorecard,
  showRawJson = false,
  roleplayPath = "/demo/adecco-roleplay-v50-7",
}: ReportViewProps) {
  const report = objectValue(scorecard.report);
  const totalScore = numberValue(report["total_score"]);
  const gradeLabel = stringValue(report["grade_label"], "-");
  const confidence = stringValue(report["score_confidence"], "-");
  const summary = objectValue(report["must_capture_summary"]);
  const mustCaptureItems = arrayValue(report["must_capture_items"]);
  const captured = numberValue(summary["captured_count"]) ?? 0;
  const partial = numberValue(summary["partial_count"]) ?? 0;
  const missed = numberValue(summary["missed_count"]) ?? 0;
  const weightedRatio = numberValue(summary["weighted_capture_ratio"]) ?? 0;
  const strengths = stringList(report["strengths"]);
  const improvements = stringList(report["improvement_points"]);
  const actions = stringList(report["next_training_actions"]);
  const priorityGap = findPriorityGap(mustCaptureItems);
  const roleplayName = stringValue(
    report["roleplay_name"],
    "住宅設備メーカー営業事務1名"
  );
  const overallSummary = stringValue(
    report["overall_summary"],
    stringValue(
      report["learner_feedback"],
      "募集背景、必須/歓迎条件、選考フロー、競合状況は確認できています。一方で、1日の業務の流れ、契約期間、リモート有無、直接雇用、職場環境の細部、連絡方法までは明示的には確認できていません。短い会話でも推測で補完せず、聞けていない項目は部分取得として扱う評価です。"
    )
  );

  return (
    <div className={c("page")}>
      <header className={c("topbar")}>
        <a className={c("brand")} href="https://mendan.biz/">
          MENDAN
        </a>
        <div className={c("title")}>AIロープレ評価レポート</div>
        <div className={c("actions")}>
          <a className={c("buttonSecondary")} href={roleplayPath}>
            一覧に戻る
          </a>
          <a className={c("button")} href={roleplayPath}>
            Transcript
          </a>
        </div>
      </header>

      <main className={c("shell")}>
        <section className={c("hero")}>
          <div className={c("scoreCard")}>
            <div className={c("eyebrow")}>総合評価</div>
            <div className={c("score")}>
              <span className={c("scoreValue")}>
                {totalScore === null ? "-" : totalScore.toFixed(1)}
              </span>
              <span className={c("scoreMax")}>/ 100</span>
              <span className={c("gradePill")}>{gradeLabel}</span>
            </div>
            <p className={c("bodyText")}>{overallSummary}</p>
          </div>

          <div className={c("metaCard")}>
            <MetaRow label="評価信頼度" value={confidence} />
            <MetaRow label="ロープレ" value={roleplayName} />
          </div>
        </section>

        <section className={c("kpis")} aria-label="評価指標">
          <Kpi
            label="ヒアリング達成度"
            value={`${Math.round(weightedRatio * 100)}%`}
            note="12項目を重要度込みで換算"
          />
          <Kpi
            label="完全取得 / 部分取得 / 未取得"
            value={`${captured} / ${partial} / ${missed}`}
            note="必須ヒアリング12項目判定内訳"
          />
          <Kpi
            label="最優先改善領域"
            value={priorityGap}
            note="12項目のうち改善インパクト最大"
          />
        </section>

        <section className={c("mainGrid")}>
          <div className={c("panel")}>
            <div className={c("panelHeading")}>
              <h2 className={c("panelTitle")}>6大カテゴリ</h2>
              <span>小カテゴリの判定を集約した最終表示です。</span>
            </div>
            <div className={c("rubrics")}>
              {renderRubrics(report).map((rubric) => (
                <article className={c("rubric")} key={rubric.key}>
                  <div className={c("rubricHeader")}>
                    <div className={c("rubricName")}>{rubric.label}</div>
                    <div className={c("rubricScore")}>
                      {rubric.pointsText} / {rubric.maxPointsText}
                    </div>
                  </div>
                  <div className={c("bar")}>
                    <div
                      className={c("barFill")}
                      style={{ width: `${rubric.percent}%` }}
                    />
                  </div>
                  <p className={c("bodyText")}>{rubric.reason}</p>
                </article>
              ))}
            </div>
            <p className={c("footnote")}>※ 商談時の振る舞いは、会話ログのみをもとに採点しています。</p>
          </div>

          <aside className={`${c("panel")} ${c("sticky")}`}>
            <h2 className={c("panelTitle")}>次回に効く要点</h2>
            <div className={c("summaryList")}>
              <SummaryBlock title="最重要改善点" items={improvements.slice(0, 2)} empty="改善点は取得できませんでした。" />
              <SummaryBlock title="次回の質問例" items={extractQuestionExamples(improvements, actions)} empty="質問例は取得できませんでした。" />
              <SummaryBlock title="次回アクション" items={actions.slice(0, 3)} empty="次回アクションは取得できませんでした。" />
            </div>
          </aside>
        </section>

        <section className={c("panel")} style={{ marginTop: 18 }}>
          <h2 className={c("panelTitle")}>必須ヒアリング 12項目</h2>
          <div className={c("captureGrid")}>
            <div className={c("captureHeader")}>
              <span>項目</span>
              <span>重み</span>
              <span>判定</span>
              <span>根拠・不足</span>
            </div>
            {mustCaptureItems.length === 0 ? (
              <p className={c("bodyText")}>必須項目の判定はまだありません。</p>
            ) : (
              mustCaptureItems.map((rawItem, index) => {
                const item = objectValue(rawItem);
                const judgement = stringValue(item["judgement"], "missed");
                return (
                  <div className={c("captureRow")} key={`${index}-${stringValue(item["label"], "")}`}>
                    <strong>{stringValue(item["label"], `項目${index + 1}`)}</strong>
                    <span>{item["weight_points"] === null ? "-" : stringValue(item["weight_points"], "-")}</span>
                    <span className={`${c("badge")} ${badgeClass(judgement)}`}>
                      {judgementLabel(judgement)}
                    </span>
                    <span className={c("bodyText")}>{captureEvidence(item)}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className={c("feedbackGrid")}>
          <div className={c("panel")}>
            <h2 className={c("panelTitle")}>会話フロー</h2>
            <div className={c("summaryList")}>
              {buildConversationFlow(mustCaptureItems).map((item) => (
                <div className={c("groupItem")} key={item.label}>
                  <span className={`${c("badge")} ${badgeClass(item.judgement)}`}>
                    {judgementLabel(item.judgement)}
                  </span>
                  <strong>{item.label}</strong>
                  <span className={c("bodyText")}>{item.detail}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={c("panel")}>
            <h2 className={c("panelTitle")}>強みと改善点</h2>
            <SummaryBlock title="評価できた点" items={strengths} empty="強みは取得できませんでした。" />
            <div style={{ height: 14 }} />
            <SummaryBlock title="改善ポイント" items={improvements} empty="改善点は取得できませんでした。" />
          </div>
        </section>

        <section className={c("panel")} style={{ marginTop: 18 }}>
          <h2 className={c("panelTitle")}>次回トレーニングアクション</h2>
          <div className={c("numbered")}>
            {(actions.length > 0 ? actions : ["次回アクションは取得できませんでした。"]).map(
              (action, index) => (
                <div className={c("numberedItem")} key={`${index}-${action.slice(0, 18)}`}>
                  <span className={c("number")}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={c("bodyText")}>{action}</span>
                </div>
              )
            )}
          </div>
        </section>

        {showRawJson ? (
          <details className={c("debug")}>
            <summary>Debug</summary>
            <p className={c("bodyText")}>validation: {scorecard.validation.status}</p>
            <p className={c("bodyText")}>model: {scorecard.model}</p>
            <p className={c("bodyText")}>
              tokens: input {scorecard.usage.input_tokens ?? "-"} / output{" "}
              {scorecard.usage.output_tokens ?? "-"}
            </p>
            <p className={c("bodyText")}>retry: {scorecard.retryNote}</p>
            <pre className={c("pre")}>{JSON.stringify(report, null, 2)}</pre>
          </details>
        ) : null}
      </main>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={c("metaRow")}>
      <span className={c("metaLabel")}>{label}</span>
      <span className={c("metaValue")}>{value}</span>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={c("card")}>
      <span className={c("cardLabel")}>{label}</span>
      <strong className={c("cardValue")}>{value}</strong>
      {note ? <span className={c("cardNote")}>{note}</span> : null}
    </div>
  );
}

function SummaryBlock({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className={c("summaryItem")}>
      <strong>{title}</strong>
      <div className={c("summaryList")} style={{ marginTop: 10 }}>
        {(items.length > 0 ? items : [empty]).map((item) => (
          <span className={c("bodyText")} key={item}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function renderRubrics(report: Record<string, unknown>) {
  const scores = objectValue(report["rubric_scores"]);
  return RUBRIC_ORDER.map(([key, fallbackLabel]) => {
    const item = objectValue(scores[key]);
    const points = numberValue(item["points"]);
    const maxPoints = numberValue(item["max_points"], RUBRIC_MAX_POINTS[key]);
    const percent =
      points !== null && maxPoints !== null && maxPoints > 0
        ? Math.max(0, Math.min(100, (points / maxPoints) * 100))
        : 0;
    return {
      key,
      label: stringValue(item["label"], fallbackLabel),
      pointsText: points === null ? "-" : points.toFixed(1),
      maxPointsText: maxPoints === null ? "-" : String(maxPoints),
      percent,
      reason: stringValue(item["reason"], "評価理由が取得できませんでした。"),
    };
  });
}

function captureEvidence(item: Record<string, unknown>) {
  const missing = stringValue(item["missing_detail"]);
  if (missing) return missing;
  const evidence = arrayValue(item["evidence"])
    .map((entry) => stringValue(objectValue(entry)["quote"]))
    .filter(Boolean);
  return evidence.length > 0 ? evidence.join(" / ") : "根拠は取得できませんでした。";
}

function findPriorityGap(items: unknown[]) {
  const gaps = items
    .map(objectValue)
    .filter((item) => stringValue(item["judgement"], "missed") !== "captured")
    .sort((left, right) => {
      const leftWeight = numberValue(left["weight_points"], 0) ?? 0;
      const rightWeight = numberValue(right["weight_points"], 0) ?? 0;
      return rightWeight - leftWeight;
    });
  return stringValue(gaps[0]?.["label"], "なし");
}

function buildConversationFlow(items: unknown[]) {
  const byId = new Map(
    items.map((rawItem) => {
      const item = objectValue(rawItem);
      return [numberValue(item["id"], 0), item] as const;
    })
  );
  const definitions = [
    { label: "導入", ids: [1], fallback: "募集背景から自然に開始" },
    { label: "背景", ids: [1], fallback: "立ち上げ背景と人数を確認" },
    { label: "業務分解", ids: [2, 3], fallback: "業務の流れを整理" },
    { label: "優先順位", ids: [7, 8], fallback: "必須/歓迎/期限優先を確認" },
    { label: "職場環境", ids: [9, 10], fallback: "体制とフォローを確認" },
    { label: "競合・決定", ids: [11], fallback: "競合、見学、決裁者を確認" },
    { label: "要約・終話", ids: [12], fallback: "次行動を期日付きで合意" },
  ];
  return definitions.map((definition) => {
    const related = definition.ids
      .map((id) => byId.get(id))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const judgements = related.map((item) =>
      stringValue(item["judgement"], "missed")
    );
    const judgement = judgements.includes("missed")
      ? "missed"
      : judgements.includes("partial")
        ? "partial"
        : "captured";
    const detail =
      related
        .map((item) => captureEvidence(item))
        .filter(Boolean)
        .slice(0, 2)
        .join(" / ") || definition.fallback;
    return { ...definition, judgement, detail };
  });
}

function extractQuestionExamples(improvements: string[], actions: string[]) {
  return [...improvements, ...actions]
    .filter((item) => /聞|確認|質問|ヒアリング/u.test(item))
    .slice(0, 3);
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = "") {
  if (typeof value === "string") return sanitizeVisibleText(value.trim()) || fallback;
  if (typeof value === "number" || typeof value === "boolean") {
    return sanitizeVisibleText(String(value)) || fallback;
  }
  return fallback;
}

function sanitizeVisibleText(value: string) {
  return value
    .replace(/\bturn[_\s-]*id\s*[:#]?\s*(?:[a-z]\s*)?\d+\b/gi, "")
    .replace(/\bturn\s*[:#]?\s*\d+\b/gi, "")
    .replace(/(^|[\s（(［\[])[tguac]\d{1,4}(?=$|[\s、。,.）)\]］])/gi, "$1")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([、。,.])/g, "$1")
    .trim();
}

function numberValue(value: unknown, fallback: number | null = null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringList(value: unknown) {
  return arrayValue(value)
    .map((item) => stringValue(item))
    .filter(Boolean);
}

function judgementLabel(value: string) {
  if (value === "captured") return "完全取得";
  if (value === "partial") return "部分取得";
  return "未取得";
}

function badgeClass(value: string) {
  if (value === "captured") return c("captured");
  if (value === "partial") return c("partial");
  return c("missed");
}
