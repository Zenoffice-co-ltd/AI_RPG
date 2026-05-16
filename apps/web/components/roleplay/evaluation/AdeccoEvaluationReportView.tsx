"use client";

import styles from "./AdeccoEvaluationReportView.module.css";
import type { AdeccoBrowserEvaluationScorecard } from "./types";

function c(name: string) {
  return styles[name] ?? name;
}

type ReportViewProps = {
  scorecard: AdeccoBrowserEvaluationScorecard;
  showRawJson: boolean;
};

const RUBRIC_ORDER = [
  ["coverage", "ヒアリング項目の網羅性"],
  ["hearing_skill", "ヒアリングスキル"],
  ["priority_clarity", "優先順位の明確化"],
  ["deal_structure", "商談の全体構成力"],
  ["business_behavior", "商談時の振る舞い"],
  ["closing", "クロージング"],
] as const;

export function AdeccoEvaluationReportView({
  scorecard,
  showRawJson,
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
  const feedback = stringValue(report["learner_feedback"], "フィードバックを取得できませんでした。");

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
        <section className={c("hero")}>
          <div className={c("scoreCard")}>
            <div className={c("eyebrow")}>総合評価</div>
            <div className={c("score")}>
              <span className={c("scoreValue")}>
                {totalScore === null ? "-" : totalScore.toFixed(1)}
              </span>
              <span className={c("scoreMax")}>/ 100</span>
            </div>
            <p className={c("bodyText")}>
              住宅設備メーカーの初回派遣オーダーヒアリングを、会話ログだけを根拠に採点しています。
            </p>
          </div>

          <div className={c("metaCard")}>
            <MetaRow label="Grade" value={gradeLabel} />
            <MetaRow label="評価信頼度" value={confidence} />
            <MetaRow label="生成時刻" value={formatDate(scorecard.generatedAt)} />
            <MetaRow label="session" value={shortSession(scorecard.metadata.sessionId)} />
          </div>
        </section>

        <section className={c("kpis")} aria-label="評価指標">
          <Kpi label="必須項目取得率" value={`${Math.round(weightedRatio * 100)}%`} />
          <Kpi label="取得 / 部分 / 未取得" value={`${captured} / ${partial} / ${missed}`} />
          <Kpi label="強み" value={`${strengths.length}`} />
          <Kpi label="次回アクション" value={`${actions.length}`} />
        </section>

        <section className={c("mainGrid")}>
          <div className={c("panel")}>
            <h2 className={c("panelTitle")}>Rubric Breakdown</h2>
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
          <h2 className={c("panelTitle")}>Must Capture 18項目</h2>
          <div className={c("captureGrid")}>
            <div className={c("captureHeader")}>
              <span>No</span>
              <span>項目</span>
              <span>重み</span>
              <span>判定</span>
              <span>根拠またはメモ</span>
            </div>
            {mustCaptureItems.length === 0 ? (
              <p className={c("bodyText")}>必須項目の判定はまだありません。</p>
            ) : (
              mustCaptureItems.map((rawItem, index) => {
                const item = objectValue(rawItem);
                const judgement = stringValue(item["judgement"], "missed");
                return (
                  <div className={c("captureRow")} key={`${index}-${stringValue(item["label"], "")}`}>
                    <span>{String(numberValue(item["id"], index + 1)).padStart(2, "0")}</span>
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
            <h2 className={c("panelTitle")}>学習者へのフィードバック</h2>
            {feedback.split(/\n{2,}/).map((paragraph, index) => (
              <p className={c("bodyText")} key={`${index}-${paragraph.slice(0, 16)}`}>
                {paragraph}
              </p>
            ))}
          </div>
          <div className={c("panel")}>
            <h2 className={c("panelTitle")}>強みと改善点</h2>
            <SummaryBlock title="評価できた点" items={strengths} empty="強みは取得できませんでした。" />
            <div style={{ height: 14 }} />
            <SummaryBlock title="改善ポイント" items={improvements} empty="改善点は取得できませんでした。" />
          </div>
        </section>

        <section className={c("panel")} style={{ marginTop: 18 }}>
          <h2 className={c("panelTitle")}>Next Training Actions</h2>
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

        <details className={c("debug")}>
          <summary>Debug</summary>
          <p className={c("bodyText")}>validation: {scorecard.validation.status}</p>
          <p className={c("bodyText")}>model: {scorecard.model}</p>
          <p className={c("bodyText")}>
            tokens: input {scorecard.usage.input_tokens ?? "-"} / output{" "}
            {scorecard.usage.output_tokens ?? "-"}
          </p>
          <p className={c("bodyText")}>retry: {scorecard.retryNote}</p>
          {showRawJson ? (
            <pre className={c("pre")}>{JSON.stringify(report, null, 2)}</pre>
          ) : null}
        </details>
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className={c("card")}>
      <span className={c("cardLabel")}>{label}</span>
      <strong className={c("cardValue")}>{value}</strong>
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
    const maxPoints = numberValue(item["max_points"], key === "coverage" ? 30 : 10);
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
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
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
  if (value === "captured") return "取得";
  if (value === "partial") return "部分";
  return "未取得";
}

function badgeClass(value: string) {
  if (value === "captured") return c("captured");
  if (value === "partial") return c("partial");
  return c("missed");
}

function shortSession(sessionId: string) {
  return sessionId.length > 18 ? `${sessionId.slice(0, 8)}...${sessionId.slice(-6)}` : sessionId;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
