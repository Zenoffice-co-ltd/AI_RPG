"use client";

import styles from "./AdeccoEvaluationReportView.module.css";
import type { AdeccoBrowserEvaluationScorecard } from "./types";

function c(name: string) {
  return styles[name] ?? name;
}

type ReportViewProps = {
  scorecard: AdeccoBrowserEvaluationScorecard;
  showRawJson: boolean;
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
  showRawJson,
  roleplayPath = "/demo/adecco-roleplay-v50-7",
}: ReportViewProps) {
  const report = objectValue(scorecard.report);
  const totalScore = numberValue(report["total_score"]);
  const gradeLabel = stringValue(report["grade_label"], "-");
  const confidence = stringValue(report["score_confidence"], "-");
  const summary = objectValue(report["must_capture_summary"]);
  const mustCaptureItems = arrayValue(report["must_capture_items"]);
  const modalityLimitations = stringList(report["modality_limitations"]);
  const complianceFlags = objectValue(report["sales_compliance_flags"]);
  const captured = numberValue(summary["captured_count"]) ?? 0;
  const partial = numberValue(summary["partial_count"]) ?? 0;
  const missed = numberValue(summary["missed_count"]) ?? 0;
  const weightedRatio = numberValue(summary["weighted_capture_ratio"]) ?? 0;
  const priorityItem = selectPriorityItem(mustCaptureItems);
  const mustCaptureCountLabel =
    mustCaptureItems.length > 0 ? `${mustCaptureItems.length}項目` : "必須項目";
  const strengths = stringList(report["strengths"]);
  const improvements = stringList(report["improvement_points"]);
  const actions = stringList(report["next_training_actions"]);
  const feedback = stringValue(report["learner_feedback"], "フィードバックを取得できませんでした。");
  const leadText = feedback.split(/\n{2,}/)[0] ?? feedback;

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
        <section className={c("hero")}>
          <div className={c("scoreCard")}>
            <div className={c("eyebrow")}>総合評価</div>
            <div className={c("score")}>
              <span className={c("scoreValue")}>
                {totalScore === null ? "-" : totalScore.toFixed(1)}
              </span>
              <span className={c("scoreMax")}>/ 100</span>
              <span className={c("grade")}>{gradeLabel}</span>
            </div>
            <p className={c("bodyText")}>{leadText}</p>
          </div>

          <div className={c("metaCard")}>
            <MetaRow label="評価信頼度" value={confidence} />
            <MetaRow label="ロープレ" value="住宅設備メーカー 人事課主任" />
          </div>
        </section>

        <section className={c("kpis")} aria-label="評価指標">
          <Kpi
            label="ヒアリング達成度"
            value={`${Math.round(weightedRatio * 100)}%`}
            note={`${mustCaptureCountLabel}を重要度込みで換算`}
          />
          <Kpi
            label="完全取得 / 部分取得 / 未取得"
            value={`${captured} / ${partial} / ${missed}`}
            note={`${mustCaptureCountLabel}判定内訳`}
          />
          <Kpi
            label="最優先改善領域"
            value={priorityItem?.label ?? "未取得項目"}
            note="改善インパクト最大"
          />
        </section>

        <section className={c("mainGrid")}>
          <div className={c("panel")}>
            <h2 className={c("panelTitle")}>6大カテゴリ</h2>
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
              <SummaryBlock title="練習アクション" items={actions.slice(0, 3)} empty="次回アクションは取得できませんでした。" />
            </div>
          </aside>
        </section>

        <section className={c("panel")} style={{ marginTop: 18 }}>
          <h2 className={c("panelTitle")}>必須ヒアリング {mustCaptureCountLabel}</h2>
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

        <section className={c("feedbackGrid")}>
          <div className={c("panel")}>
            <h2 className={c("panelTitle")}>非言語評価の制約</h2>
            <SummaryBlock
              title="評価対象外または推定しない項目"
              items={modalityLimitations}
              empty="音声・映像がないため、声量・表情・視線・姿勢・メモ中の態度は直接評価していません。"
            />
          </div>
          <div className={c("panel")}>
            <h2 className={c("panelTitle")}>Compliance Flags</h2>
            <ComplianceFlags flags={complianceFlags} />
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

function ComplianceFlags({ flags }: { flags: Record<string, unknown> }) {
  const deepened = Boolean(flags["inappropriate_demographic_requirement_deepened"]);
  const reframed = Boolean(flags["inappropriate_requirement_reframed"]);
  const details = arrayValue(flags["details"]);
  return (
    <div className={c("summaryList")}>
      <div className={c("summaryItem")}>
        <strong>不適切属性の深掘り</strong>
        <p className={c("bodyText")}>{deepened ? "検出あり" : "検出なし"}</p>
      </div>
      <div className={c("summaryItem")}>
        <strong>職務関連要件への言い換え</strong>
        <p className={c("bodyText")}>{reframed ? "検出あり" : "検出なし"}</p>
      </div>
      {details.length > 0 ? (
        <div className={c("summaryItem")}>
          <strong>詳細</strong>
          <div className={c("summaryList")} style={{ marginTop: 10 }}>
            {details.map((rawDetail, index) => {
              const detail = objectValue(rawDetail);
              return (
                <span className={c("bodyText")} key={index}>
                  {stringValue(detail["impact"], "詳細は取得できませんでした。")}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
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

function Kpi({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className={c("card")}>
      <span className={c("cardLabel")}>{label}</span>
      <strong className={c("cardValue")}>{value}</strong>
      {note ? <small className={c("cardNote")}>{note}</small> : null}
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

function extractQuestionExamples(improvements: string[], actions: string[]) {
  return [...improvements, ...actions]
    .filter((item) => /聞|確認|質問|ヒアリング/u.test(item))
    .slice(0, 3);
}

function selectPriorityItem(items: unknown[]) {
  let selected: { label: string; impact: number } | null = null;
  for (const rawItem of items) {
    const item = objectValue(rawItem);
    const label = stringValue(item["label"]);
    const weight = numberValue(item["weight_points"], 1) ?? 1;
    const judgement = stringValue(item["judgement"], "missed");
    const captureRate = judgement === "captured" ? 1 : judgement === "partial" ? 0.5 : 0;
    const impact = weight * (1 - captureRate);
    if (label && (!selected || impact > selected.impact)) {
      selected = { label, impact };
    }
  }
  return selected;
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
  if (value === "captured") return "完全取得";
  if (value === "partial") return "部分取得";
  return "未取得";
}

function badgeClass(value: string) {
  if (value === "captured") return c("captured");
  if (value === "partial") return c("partial");
  return c("missed");
}
