import { createSign, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { accessSecretValue } from "@/server/secrets";

const SCENARIO_ID =
  "staffing_order_hearing_adecco_manufacturer_busy_manager_medium";
const SCENARIO_TITLE = "初回派遣オーダーヒアリング";
const LEARNER_NAME = "アデコ営業（学習者）";
const CLIENT_ROLE = "中堅住宅設備メーカーの人事課主任";
const ORIGINAL_TO_ADDRESS = "iwase@zenoffice.co.jp";
const ANTHROPIC_SECRET_NAME = "anthropic-api-key-default";
const GMAIL_SERVICE_ACCOUNT_SECRET_NAME = "gmail-client-secret";
const MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 6000;
const RETRY_MAX_TOKENS = 12000;

const REQUIRED_TOP_LEVEL_KEYS = [
  "total_score",
  "rubric_scores",
  "must_capture_items",
] as const;

const ADDITIONAL_TOP_LEVEL_KEYS = [
  "schema_version",
  "session_id",
  "scenario_id",
  "score_confidence",
  "agent_quality_flags",
  "learner_feedback",
] as const;

export type NormalizedTurn = {
  turn_id: string;
  speaker: "sales" | "client" | "unknown";
  text: string;
  timestamp_sec: number;
};

type ClaudeResult = {
  result: string;
  model: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

type ValidationResult = {
  ok: boolean;
  status: string;
  jsonText: string;
  parsed: unknown;
};

type ReportMetadata = {
  sessionId: string;
  conversationId: string | null;
  startedAt: string;
  endedAt: string;
};

type GmailServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type AdeccoEvaluationInput = {
  sessionId?: string;
  conversationId: string | null;
  transcript: NormalizedTurn[];
  startedAt?: string;
  endedAt?: string;
  transcriptSource?: string;
  asrQualityNote?: string;
};

export type AdeccoEvaluationResult = {
  sessionId: string;
  model: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  };
  validation: {
    ok: boolean;
    status: string;
  };
  mail: {
    routed_to: string;
    delivery: "direct";
    ok: boolean;
    status: string;
    id?: string;
  };
  retryNote: string;
};

function getSecretProjectId() {
  return (
    process.env["ADECCO_EVAL_SECRET_PROJECT_ID"] ??
    process.env["SECRET_SOURCE_PROJECT_ID"] ??
    "zapier-transfer"
  );
}

function getPromptsRoot() {
  const explicitRoot = process.env["ADECCO_EVAL_PROMPTS_ROOT"];
  if (explicitRoot) {
    return resolve(explicitRoot);
  }

  const candidates = [
    resolve(process.cwd(), "scripts", "adecco_order_hearing_eval", "prompts"),
    resolve("/app", "scripts", "adecco_order_hearing_eval", "prompts"),
  ];
  return (
    candidates.find((candidate) => existsSync(join(candidate, "system.md"))) ??
    resolve(process.cwd(), "scripts", "adecco_order_hearing_eval", "prompts")
  );
}

function getEmailTemplatesRoot() {
  const explicitRoot = process.env["ADECCO_EVAL_EMAIL_TEMPLATES_ROOT"];
  if (explicitRoot) {
    return resolve(explicitRoot);
  }

  const candidates = [
    resolve(
      process.cwd(),
      "scripts",
      "adecco_order_hearing_eval",
      "email_templates"
    ),
    resolve("/app", "scripts", "adecco_order_hearing_eval", "email_templates"),
  ];
  return (
    candidates.find((candidate) =>
      existsSync(join(candidate, "adecco_report_v2.html"))
    ) ??
    resolve(
      process.cwd(),
      "scripts",
      "adecco_order_hearing_eval",
      "email_templates"
    )
  );
}

function fillTemplate(template: string, replacements: Record<string, string>) {
  let filled = template;
  for (const [key, value] of Object.entries(replacements)) {
    filled = filled.replaceAll(`{{${key}}}`, value);
  }
  return filled;
}

function extractJsonCandidate(rawText: string) {
  const stripped = rawText.trim();
  if (stripped.startsWith("```")) {
    const lines = stripped.split(/\r?\n/);
    if (lines[0]?.trim().startsWith("```")) {
      lines.shift();
    }
    if (lines[lines.length - 1]?.trim() === "```") {
      lines.pop();
    }
    return {
      jsonText: lines.join("\n").trim(),
      note: "stripped markdown code fence",
    };
  }

  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    return {
      jsonText: stripped.slice(firstBrace, lastBrace + 1),
      note: "extracted first JSON object",
    };
  }

  return { jsonText: stripped, note: "raw" };
}

function validateResponseText(rawText: string): ValidationResult {
  const { jsonText, note } = extractJsonCandidate(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      ok: false,
      status: `failed: json_parse_error=${
        error instanceof Error ? error.message : "unknown"
      }; extraction=${note}`,
      jsonText,
      parsed: null,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      status: `failed: parsed JSON is not an object; extraction=${note}`,
      jsonText,
      parsed,
    };
  }

  const record = parsed as Record<string, unknown>;
  const missingRequired = REQUIRED_TOP_LEVEL_KEYS.filter(
    (key) => !(key in record)
  );
  const missingAdditional = ADDITIONAL_TOP_LEVEL_KEYS.filter(
    (key) => !(key in record)
  );

  if (missingRequired.length > 0) {
    return {
      ok: false,
      status:
        `failed: missing required top-level keys=${missingRequired.join(",")}` +
        (missingAdditional.length > 0
          ? `; missing additional keys=${missingAdditional.join(",")}`
          : "") +
        `; extraction=${note}`,
      jsonText,
      parsed,
    };
  }

  if (missingAdditional.length > 0) {
    return {
      ok: true,
      status: `success: required keys present; missing additional keys=${missingAdditional.join(",")}`,
      jsonText,
      parsed,
    };
  }

  return {
    ok: true,
    status: `success: required and additional top-level keys present; extraction=${note}`,
    jsonText,
    parsed,
  };
}

async function loadPromptBundle() {
  const promptsRoot = getPromptsRoot();
  const [systemPrompt, userTemplate, schemaText] = await Promise.all([
    readFile(join(promptsRoot, "system.md"), "utf8"),
    readFile(join(promptsRoot, "user_template.md"), "utf8"),
    readFile(join(promptsRoot, "schema.json"), "utf8"),
  ]);

  return { systemPrompt, userTemplate, schemaText };
}

async function loadEmailHtmlTemplate() {
  return readFile(join(getEmailTemplatesRoot(), "adecco_report_v2.html"), "utf8");
}

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asReportObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asReportArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asReportNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asReportString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asStringList(value: unknown) {
  return asReportArray(value)
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function formatPoint(value: unknown, digits = 1) {
  return asReportNumber(value).toFixed(digits);
}

function formatPercent(value: unknown) {
  return Math.round(asReportNumber(value) * 100);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get(
    "minute"
  )}`;
}

function formatSessionTime(startedAt: string, endedAt: string) {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const startLabel = formatDateTime(startedAt);
  const endLabel = formatDateTime(endedAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startLabel} - ${endLabel}`;
  }

  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const endTime = endLabel.split(" ").at(-1) ?? endLabel;
  return `${startLabel} - ${endTime}（${minutes}分）`;
}

function progressColor(points: number, maxPoints: number) {
  const ratio = maxPoints > 0 ? points / maxPoints : 0;
  if (ratio >= 0.8) {
    return {
      text: "#1f7a4f",
      gradient: "linear-gradient(90deg,#1f7a4f,#3a9d6e)",
      badgeBg: "#e8f5ee",
      badgeText: "#1f7a4f",
    };
  }
  if (ratio < 0.6) {
    return {
      text: "#b8761f",
      gradient: "linear-gradient(90deg,#b8761f,#d49a4a)",
      badgeBg: "#fef4e8",
      badgeText: "#b8761f",
    };
  }
  return {
    text: "#0f2649",
    gradient: "linear-gradient(90deg,#1a3a6b,#3d6bb3)",
    badgeBg: "#eef4fd",
    badgeText: "#0f2649",
  };
}

function captureBadge(item: Record<string, unknown>) {
  const judgement = asReportString(item["judgement"]);
  const level = asReportNumber(item["capture_level"], -1);
  if (judgement === "captured" || level === 1) {
    return {
      label: "取得",
      bg: "#e8f5ee",
      color: "#1f7a4f",
    };
  }
  if (judgement === "partial" || level === 0.5) {
    return {
      label: "部分",
      bg: "#fef4e8",
      color: "#b8761f",
    };
  }
  return {
    label: "未取得",
    bg: "#fdecec",
    color: "#b8312f",
  };
}

function replaceBetween(
  html: string,
  startMarker: string,
  endMarker: string,
  replacement: string
) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) {
    return html;
  }
  return (
    html.slice(0, start + startMarker.length) +
    replacement +
    html.slice(end)
  );
}

function replaceFirst(html: string, search: string | RegExp, replacement: string) {
  return html.replace(search, replacement);
}

const RUBRIC_ORDER = [
  ["coverage", "ヒアリング項目の網羅性"],
  ["hearing_skill", "ヒアリングスキル"],
  ["priority_clarity", "優先順位の明確化"],
  ["deal_structure", "商談の全体構成力"],
  ["business_behavior", "商談時の振る舞い"],
  ["closing", "クロージング"],
] as const;

function renderRubricCards(report: Record<string, unknown>) {
  const scores = asReportObject(report["rubric_scores"]);
  return RUBRIC_ORDER.map(([key, fallbackLabel]) => {
    const item = asReportObject(scores[key]);
    const label = asReportString(item["label"], fallbackLabel);
    const points = asReportNumber(item["points"]);
    const maxPoints = asReportNumber(item["max_points"], key === "coverage" ? 30 : 10);
    const reason = asReportString(item["reason"], "評価理由が取得できませんでした。");
    const percent = maxPoints > 0 ? Math.min(100, Math.max(0, (points / maxPoints) * 100)) : 0;
    const color = progressColor(points, maxPoints);
    const badge =
      points / Math.max(maxPoints, 1) >= 0.8
        ? ' <span style="background-color:#e8f5ee;color:#1f7a4f;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;margin-left:6px;">高評価</span>'
        : points / Math.max(maxPoints, 1) < 0.6
          ? ' <span style="background-color:#fef4e8;padding:1px 6px;border-radius:3px;font-size:11px;color:#b8761f;font-weight:600;">要改善</span>'
          : "";

    return `

<!-- ${key} -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:14px;border:1px solid #e6eaf0;border-radius:6px;">
<tr><td style="padding:16px 20px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr>
<td style="font-size:14px;font-weight:700;color:#1a2332;">${htmlEscape(label)}${badge}</td>
<td align="right" style="font-size:13px;font-weight:700;color:${color.text};white-space:nowrap;"><span style="font-size:20px;">${formatPoint(points)}</span> <span style="color:#8898ad;font-size:12px;font-weight:500;">/ ${htmlEscape(maxPoints)}</span></td>
</tr>
</table>
<div style="margin-top:8px;background-color:#eef0f4;height:6px;border-radius:3px;overflow:hidden;">
<div style="background:${color.gradient};width:${percent.toFixed(0)}%;height:100%;"></div>
</div>
<div style="margin-top:10px;font-size:13px;color:#3a4756;line-height:1.65;">${badge.trim().startsWith("<span") && points / Math.max(maxPoints, 1) < 0.6 ? `${badge} ` : ""}${htmlEscape(reason)}</div>
</td></tr>
</table>`;
  }).join("\n");
}

function renderMustCaptureRows(report: Record<string, unknown>) {
  const items = asReportArray(report["must_capture_items"]);
  return items.map((rawItem, index) => {
    const item = asReportObject(rawItem);
    const badge = captureBadge(item);
    const id = asReportNumber(item["id"], index + 1);
    const label = asReportString(item["label"], `項目${id}`);
    const weight = item["weight_points"] === null ? "—" : String(item["weight_points"] ?? "—");
    const background = index % 2 === 1 ? ' style="background-color:#fafbfc;"' : "";
    const bottom = index === items.length - 1 ? "" : "border-bottom:1px solid #f0f2f5;";
    const important =
      id === 11
        ? ' <span style="color:#b8312f;font-size:10px;font-weight:600;">★最重要</span>'
        : "";

    return `<tr${background}><td style="padding:11px 14px;color:#8898ad;${bottom}">${String(id).padStart(2, "0")}</td><td style="padding:11px 8px;color:#1a2332;${bottom}">${htmlEscape(label)}${important}</td><td align="center" style="padding:11px 8px;color:#5a6779;${bottom}">${htmlEscape(weight)}</td><td align="center" style="padding:11px 14px;${bottom}"><span style="background-color:${badge.bg};color:${badge.color};font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;">${badge.label}</span></td></tr>`;
  }).join("\n\n");
}

function renderStrengths(report: Record<string, unknown>) {
  const strengths = asStringList(report["strengths"]);
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
${strengths.slice(0, 5).map((strength, index) => `
<tr><td style="padding:10px 0;${index > 0 ? "border-top:1px dashed #e6eaf0;" : ""}">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
<td width="32" valign="top" style="padding:2px 12px 0 0;"><div style="width:24px;height:24px;background-color:#1f7a4f;color:#ffffff;border-radius:50%;text-align:center;line-height:24px;font-size:12px;font-weight:700;">${index + 1}</div></td>
<td style="font-size:13px;color:#1a2332;line-height:1.7;">${htmlEscape(strength)}</td>
</tr></table>
</td></tr>`).join("\n")}
</table>
`;
}

function renderImprovements(report: Record<string, unknown>) {
  const improvements = asStringList(report["improvement_points"]);
  return improvements.slice(0, 5).map((point) => `
<div style="background-color:#fdf6f6;border-left:3px solid #b8312f;padding:14px 18px;margin-bottom:10px;border-radius:0 4px 4px 0;">
<div style="font-size:13px;font-weight:700;color:#1a2332;margin-bottom:4px;">${htmlEscape(point)}</div>
</div>`).join("\n");
}

function renderFeedback(report: Record<string, unknown>) {
  const feedback = asReportString(report["learner_feedback"], "フィードバックを取得できませんでした。");
  const paragraphs = feedback.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return `
<div style="background:linear-gradient(135deg,#f7faff,#eef4fd);padding:24px 26px;border-radius:8px;border:1px solid #d8e3f5;">
<div style="font-size:14px;color:#1a2332;line-height:1.85;">
${paragraphs.map((paragraph, index) => `<p style="margin:${index === paragraphs.length - 1 ? "0" : "0 0 14px 0"};">${htmlEscape(paragraph)}</p>`).join("\n")}
</div>
</div>
`;
}

function renderTrainingActions(report: Record<string, unknown>) {
  const actions = asStringList(report["next_training_actions"]);
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
${actions.slice(0, 5).map((action, index, all) => `
<tr><td valign="top" style="padding:12px 0;${index === all.length - 1 ? "" : "border-bottom:1px solid #eef0f4;"}">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
<td width="44" valign="top" style="padding:0 14px 0 0;"><div style="width:32px;height:32px;background:linear-gradient(135deg,#1a3a6b,#3d6bb3);color:#ffffff;border-radius:6px;text-align:center;line-height:32px;font-size:13px;font-weight:700;">${String(index + 1).padStart(2, "0")}</div></td>
<td style="font-size:13px;color:#1a2332;line-height:1.7;">${htmlEscape(action)}</td>
</tr></table>
</td></tr>`).join("\n")}
</table>
`;
}

export function renderDynamicReportHtml(input: {
  template: string;
  report: Record<string, unknown>;
  metadata: ReportMetadata;
}) {
  const summary = asReportObject(input.report["must_capture_summary"]);
  const totalScore = formatPoint(input.report["total_score"]);
  const gradeLabel = asReportString(input.report["grade_label"], "");
  const grade = gradeLabel ? `Grade ${gradeLabel}` : "Grade -";
  const weightedRatio = formatPercent(summary["weighted_capture_ratio"]);
  const countRatio = formatPercent(summary["count_capture_ratio"]);
  const capturedCount = asReportNumber(summary["captured_count"]);
  const partialCount = asReportNumber(summary["partial_count"]);
  const missedCount = asReportNumber(summary["missed_count"]);
  const totalItems = capturedCount + partialCount + missedCount || asReportArray(input.report["must_capture_items"]).length || 18;
  const sessionTime = formatSessionTime(input.metadata.startedAt, input.metadata.endedAt);
  let html = input.template;

  html = replaceFirst(html, "2026-04-27 09:00 - 09:18（18分）", htmlEscape(sessionTime));
  html = replaceFirst(html, "住宅設備メーカー人事課主任", htmlEscape(CLIENT_ROLE));
  html = replaceFirst(html, /<div style="font-size:64px;font-weight:700;color:#0f2649;line-height:1;letter-spacing:-2px;">.*?<span style="font-size:24px;color:#8898ad;font-weight:500;">\/100<\/span><\/div>/s, `<div style="font-size:64px;font-weight:700;color:#0f2649;line-height:1;letter-spacing:-2px;">${totalScore}<span style="font-size:24px;color:#8898ad;font-weight:500;">/100</span></div>`);
  html = replaceFirst(html, /<div style="margin-top:14px;display:inline-block;background-color:#1a3a6b;color:#ffffff;padding:6px 18px;border-radius:20px;font-size:14px;font-weight:600;letter-spacing:1px;">.*?<\/div>/s, `<div style="margin-top:14px;display:inline-block;background-color:#1a3a6b;color:#ffffff;padding:6px 18px;border-radius:20px;font-size:14px;font-weight:600;letter-spacing:1px;">${htmlEscape(grade)}</div>`);
  html = replaceFirst(html, /<span style="color:#0f2649;font-weight:700;">58%<\/span>/, `<span style="color:#0f2649;font-weight:700;">${weightedRatio}%</span>`);
  html = replaceFirst(html, /<div style="background:linear-gradient\(90deg,#1a3a6b,#3d6bb3\);width:58%;height:100%;"><\/div>/, `<div style="background:linear-gradient(90deg,#1a3a6b,#3d6bb3);width:${weightedRatio}%;height:100%;"></div>`);
  html = replaceFirst(html, /<span style="color:#0f2649;font-weight:700;">50%（9\/18）<\/span>/, `<span style="color:#0f2649;font-weight:700;">${countRatio}%（${capturedCount}/${totalItems}）</span>`);
  html = replaceFirst(html, /<div style="background:linear-gradient\(90deg,#1a3a6b,#3d6bb3\);width:50%;height:100%;"><\/div>/, `<div style="background:linear-gradient(90deg,#1a3a6b,#3d6bb3);width:${countRatio}%;height:100%;"></div>`);
  html = replaceFirst(html, /<div style="font-size:18px;font-weight:700;color:#1f7a4f;">9<\/div>/, `<div style="font-size:18px;font-weight:700;color:#1f7a4f;">${capturedCount}</div>`);
  html = replaceFirst(html, /<div style="font-size:18px;font-weight:700;color:#b8761f;">0<\/div>/, `<div style="font-size:18px;font-weight:700;color:#b8761f;">${partialCount}</div>`);
  html = replaceFirst(html, /<div style="font-size:18px;font-weight:700;color:#b8312f;">9<\/div>/, `<div style="font-size:18px;font-weight:700;color:#b8312f;">${missedCount}</div>`);
  html = replaceBetween(
    html,
    '<tr><td style="padding:0 40px;">',
    '<!-- ===== Must Capture 18項目 ===== -->',
    `\n${renderRubricCards(input.report)}\n\n</td></tr>\n\n`
  );
  html = replaceBetween(
    html,
    "<tbody>",
    "</tbody>",
    `\n\n${renderMustCaptureRows(input.report)}\n\n`
  );
  html = html.replace(
    /<!-- ===== 強み ===== -->[\s\S]*?<!-- ===== 改善点 ===== -->/,
    `<!-- ===== 強み ===== -->
<tr><td style="padding:32px 40px 8px 40px;">
<h2 style="margin:0 0 6px 0;font-size:18px;color:#0f2649;font-weight:700;border-left:4px solid #1f7a4f;padding-left:12px;">評価できた点（強み）</h2>
</td></tr>

<tr><td style="padding:8px 40px 0 40px;">
${renderStrengths(input.report)}
</td></tr>

<!-- ===== 改善点 ===== -->`
  );
  html = html.replace(
    /<tr><td style="padding:8px 40px 0 40px;">\s*<div style="background-color:#fdf6f6[\s\S]*?<\/td><\/tr>\s*<!-- ===== 学習者へのフィードバック ===== -->/,
    `<tr><td style="padding:8px 40px 0 40px;">

${renderImprovements(input.report)}

</td></tr>

<!-- ===== 学習者へのフィードバック ===== -->`
  );
  html = html.replace(
    /<tr><td style="padding:8px 40px 0 40px;">\s*<div style="background:linear-gradient\(135deg,#f7faff,#eef4fd\);[\s\S]*?<\/td><\/tr>\s*<!-- ===== 次のトレーニングアクション ===== -->/,
    `<tr><td style="padding:8px 40px 0 40px;">
${renderFeedback(input.report)}
</td></tr>

<!-- ===== 次のトレーニングアクション ===== -->`
  );
  html = html.replace(
    /<tr><td style="padding:8px 40px 36px 40px;">\s*<table role="presentation"[\s\S]*?<\/table>\s*<\/td><\/tr>\s*<\/table>/,
    `<tr><td style="padding:8px 40px 36px 40px;">
${renderTrainingActions(input.report)}
</td></tr>

</table>`
  );

  return html;
}

async function callClaude(input: {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}): Promise<ClaudeResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: input.maxTokens,
      temperature: 0,
      system: input.systemPrompt,
      messages: [{ role: "user", content: input.userPrompt }],
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    throw new Error(
      `Claude API failed: status=${response.status}; body=${JSON.stringify(body)}`
    );
  }

  const content = Array.isArray(body?.["content"]) ? body?.["content"] : [];
  const text = content
    .map((block) => {
      if (typeof block !== "object" || block === null) {
        return "";
      }
      const record = block as Record<string, unknown>;
      return typeof record["text"] === "string" ? record["text"] : "";
    })
    .join("");

  if (!text.trim()) {
    throw new Error("Claude API returned an empty text response.");
  }

  const usage =
    typeof body?.["usage"] === "object" && body["usage"] !== null
      ? (body["usage"] as ClaudeResult["usage"])
      : {};

  return {
    result: text,
    model: typeof body?.["model"] === "string" ? body["model"] : MODEL,
    usage,
  };
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function getGmailAccessToken(serviceAccount: GmailServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const delegatedUser =
    process.env["GMAIL_DELEGATED_USER"] ?? ORIGINAL_TO_ADDRESS;
  const assertionHeader = base64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  );
  const assertionClaim = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/gmail.send",
      aud: tokenUri,
      exp: now + 3600,
      iat: now,
      sub: delegatedUser,
    })
  );
  const unsignedJwt = `${assertionHeader}.${assertionClaim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok || typeof body?.["access_token"] !== "string") {
    throw new Error(
      `Gmail token request failed: status=${response.status}; body=${JSON.stringify(body)}`
    );
  }

  return body["access_token"];
}

function encodeSubject(subject: string) {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function buildMimeMessage(input: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}) {
  if (input.bodyHtml) {
    const boundary = `adecco_eval_${randomUUID().replaceAll("-", "")}`;
    return [
      `From: ${input.from}`,
      `To: ${input.to}`,
      `Subject: ${encodeSubject(input.subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.bodyText,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.bodyHtml,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.bodyText,
  ].join("\r\n");
}

async function sendGmail(input: {
  serviceAccountJson: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}) {
  const serviceAccount = JSON.parse(
    input.serviceAccountJson
  ) as GmailServiceAccount;
  const accessToken = await getGmailAccessToken(serviceAccount);
  const delegatedUser =
    process.env["GMAIL_DELEGATED_USER"] ?? ORIGINAL_TO_ADDRESS;
  const raw = base64Url(
    buildMimeMessage({
      from: delegatedUser,
      to: input.to,
      subject: input.subject,
      bodyText: input.bodyText,
      ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
    })
  );

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );
  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    throw new Error(
      `Gmail send failed: status=${response.status}; body=${JSON.stringify(body)}`
    );
  }

  return typeof body?.["id"] === "string" ? body["id"] : undefined;
}

function buildEmailBody(input: {
  sessionId: string;
  conversationId: string | null;
  startedAt: string;
  endedAt: string;
  validation: ValidationResult;
  claude: ClaudeResult;
  retryNote: string;
  rawResult: string;
}) {
  const totalScore =
    typeof input.validation.parsed === "object" &&
    input.validation.parsed !== null &&
    !Array.isArray(input.validation.parsed)
      ? (input.validation.parsed as Record<string, unknown>)["total_score"]
      : "";

  const lines = [
    "AIロープレ評価 MVP 実行結果",
    "",
    "Validation:",
    `- ok: ${input.validation.ok}`,
    `- status: ${input.validation.status}`,
    "",
    "Model / Usage:",
    `- model: ${input.claude.model}`,
    `- usage.input_tokens: ${input.claude.usage.input_tokens ?? ""}`,
    `- usage.output_tokens: ${input.claude.usage.output_tokens ?? ""}`,
    `- retry_note: ${input.retryNote}`,
    "",
    "Session Metadata:",
    `- session_id: ${input.sessionId}`,
    `- scenario_id: ${SCENARIO_ID}`,
    `- scenario_title: ${SCENARIO_TITLE}`,
    `- learner_name: ${LEARNER_NAME}`,
    `- client_role: ${CLIENT_ROLE}`,
    `- started_at: ${input.startedAt}`,
    `- ended_at: ${input.endedAt}`,
    `- transcript_source: elevenlabs_postcall_webhook`,
    `- asr_quality_note: elevenlabs_postcall`,
    `- eleven_conversation_id: ${input.conversationId ?? ""}`,
    `- total_score: ${totalScore ?? ""}`,
    "",
    "Mail Routing:",
    `- routed_to: ${ORIGINAL_TO_ADDRESS}`,
    "- delivery: direct",
    "- sender: gmail-service-account-delegation",
    "",
    "Claude Scoring JSON:",
    input.validation.jsonText,
  ];

  if (input.rawResult.trim() !== input.validation.jsonText.trim()) {
    lines.push("", "Raw Claude Response:", input.rawResult);
  }

  return lines.join("\n");
}

export async function runAdeccoOrderHearingEvaluation(
  input: AdeccoEvaluationInput
): Promise<AdeccoEvaluationResult> {
  const sessionId =
    input.sessionId ?? `eleven_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const startedAt = input.startedAt ?? new Date().toISOString();
  const endedAt = input.endedAt ?? new Date().toISOString();
  const secretProjectId = getSecretProjectId();
  const { systemPrompt, userTemplate, schemaText } = await loadPromptBundle();
  const userPrompt =
    fillTemplate(userTemplate, {
      session_id: sessionId,
      scenario_id: SCENARIO_ID,
      scenario_title: SCENARIO_TITLE,
      learner_name: LEARNER_NAME,
      client_role: CLIENT_ROLE,
      started_at: startedAt,
      ended_at: endedAt,
      transcript_source:
        input.transcriptSource ?? "elevenlabs_postcall_webhook",
      asr_quality_note: input.asrQualityNote ?? "elevenlabs_postcall",
      conversation_transcript_json: JSON.stringify(input.transcript, null, 2),
      optional_calibration_examples_json_or_empty_array: "[]",
    }) +
    "\n\n<json_output_schema>\n" +
    schemaText +
    "\n</json_output_schema>\n";

  const anthropicApiKey = await accessSecretValue(
    ANTHROPIC_SECRET_NAME,
    secretProjectId
  );
  const gmailServiceAccountJson = await accessSecretValue(
    GMAIL_SERVICE_ACCOUNT_SECRET_NAME,
    secretProjectId
  );

  let claude = await callClaude({
    apiKey: anthropicApiKey,
    systemPrompt,
    userPrompt,
    maxTokens: DEFAULT_MAX_TOKENS,
  });
  let validation = validateResponseText(claude.result);
  let retryNote = "not retried";

  if (
    !validation.ok &&
    (claude.usage.output_tokens ?? 0) >= DEFAULT_MAX_TOKENS &&
    validation.status.includes("json_parse_error")
  ) {
    retryNote = `retried once with max_tokens=${RETRY_MAX_TOKENS} after truncated JSON`;
    claude = await callClaude({
      apiKey: anthropicApiKey,
      systemPrompt,
      userPrompt,
      maxTokens: RETRY_MAX_TOKENS,
    });
    validation = validateResponseText(claude.result);
  }

  const subject = `[SANDBOX] [AIロープレ評価] ${SCENARIO_ID} / ${sessionId}`;
  const bodyText = buildEmailBody({
    sessionId,
    conversationId: input.conversationId,
    startedAt,
    endedAt,
    validation,
    claude,
    retryNote,
    rawResult: claude.result,
  });
  const bodyHtml = renderDynamicReportHtml({
    template: await loadEmailHtmlTemplate(),
    report: asReportObject(validation.parsed),
    metadata: {
      sessionId,
      conversationId: input.conversationId,
      startedAt,
      endedAt,
    },
  });
  const messageId = await sendGmail({
    serviceAccountJson: gmailServiceAccountJson,
    to: ORIGINAL_TO_ADDRESS,
    subject,
    bodyText,
    bodyHtml,
  });

  return {
    sessionId,
    model: claude.model,
    usage: claude.usage,
    validation: {
      ok: validation.ok,
      status: validation.status,
    },
    mail: {
      routed_to: ORIGINAL_TO_ADDRESS,
      delivery: "direct",
      ok: true,
      status: "sent",
      ...(messageId ? { id: messageId } : {}),
    },
    retryNote,
  };
}
