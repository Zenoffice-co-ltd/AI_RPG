import { relative } from "node:path";
import type {
  E2eRow,
  FrontierPoint,
  JudgeScoreRow,
  QualityLatencyRow,
  RuleScoreRow,
} from "./types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function relPath(outputDir: string, file: string): string {
  return relative(outputDir, file).replaceAll("\\", "/");
}

function fmt(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return "—";
  const f = 10 ** digits;
  return String(Math.round(value * f) / f);
}

function fmtMs(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value)} ms`;
}

export type BuildIndexHtmlInput = {
  runId: string;
  outputDir: string;
  generationRows: readonly QualityLatencyRow[];
  ruleRows: readonly RuleScoreRow[];
  judgeRows: readonly JudgeScoreRow[];
  e2eRows: readonly E2eRow[];
  frontier: readonly FrontierPoint[];
};

export function buildQualityLatencyIndexHtml(input: BuildIndexHtmlInput): string {
  const judgeAvgByCandidate = new Map<string, { sum: number; n: number }>();
  for (const j of input.judgeRows) {
    if (j.status !== "success" || j.overallScore === null) continue;
    const key = `${j.candidateProvider}:${j.candidateModel}`;
    const acc = judgeAvgByCandidate.get(key) ?? { sum: 0, n: 0 };
    acc.sum += j.overallScore;
    acc.n += 1;
    judgeAvgByCandidate.set(key, acc);
  }

  const ruleAggByModel = new Map<
    string,
    { total: number; pass: number; knockout: number }
  >();
  for (const r of input.ruleRows) {
    const key = `${r.provider}:${r.model}`;
    const a = ruleAggByModel.get(key) ?? { total: 0, pass: 0, knockout: 0 };
    a.total += 1;
    if (r.rulePass) a.pass += 1;
    if (r.knockout) a.knockout += 1;
    ruleAggByModel.set(key, a);
  }

  const summaryRows: string[] = [];
  for (const [key, judgeAcc] of [...judgeAvgByCandidate.entries()].sort()) {
    const rule = ruleAggByModel.get(key);
    const avg = judgeAcc.n === 0 ? null : judgeAcc.sum / judgeAcc.n;
    const passRate = rule && rule.total > 0 ? rule.pass / rule.total : null;
    const koRate = rule && rule.total > 0 ? rule.knockout / rule.total : null;
    summaryRows.push(
      `<tr><td>${escapeHtml(key)}</td><td>${fmt(avg, 2)}</td><td>${
        passRate === null ? "—" : `${(passRate * 100).toFixed(1)}%`
      }</td><td>${koRate === null ? "—" : `${(koRate * 100).toFixed(1)}%`}</td></tr>`
    );
  }

  const frontierTable = input.frontier
    .slice()
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .map((p) => {
      const tier =
        p.paretoTier === 1 ? "Tier 1" : p.paretoTier === 2 ? "Tier 2" : "dominated";
      return `<tr>
<td>${escapeHtml(p.llmProvider + ":" + p.llmModel)}</td>
<td>${escapeHtml(p.ttsProvider)}</td>
<td>${escapeHtml(p.mode)}</td>
<td>${fmt(p.avgQualityScore, 1)}</td>
<td>${fmtMs(p.p90E2eFirstAudioMs)}</td>
<td>${fmtMs(p.p90E2eDoneMs)}</td>
<td>${fmt(p.rulePassRate * 100, 1)}%</td>
<td>${fmt(p.successRate * 100, 1)}%</td>
<td>${fmt(p.compositeScore, 4)}</td>
<td><span class="tier tier-${p.paretoTier}">${tier}</span></td>
</tr>`;
    })
    .join("\n");

  const byCase = new Map<string, QualityLatencyRow[]>();
  for (const row of input.generationRows) {
    const list = byCase.get(row.caseId) ?? [];
    list.push(row);
    byCase.set(row.caseId, list);
  }
  const caseSections = [...byCase.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 24)
    .map(([caseId, caseRows]) => {
      const head = caseRows[0]!;
      const sortedRows = [...caseRows].sort((a, b) => {
        if (a.model !== b.model) return a.model.localeCompare(b.model);
        return a.repeatIndex - b.repeatIndex;
      });
      const lines = sortedRows
        .slice(0, 30)
        .map(
          (row) => `<tr>
<td>${escapeHtml(row.provider + ":" + row.model)}</td>
<td>r${row.repeatIndex}</td>
<td>${fmtMs(row.llmRequestToFirstSentenceMs)}</td>
<td>${fmtMs(row.llmRequestToDoneMs)}</td>
<td class="response-cell">${escapeHtml(row.responseText.slice(0, 120))}${
            row.responseText.length > 120 ? "…" : ""
          }</td>
</tr>`
        )
        .join("\n");
      return `<section class="case">
<h2>${escapeHtml(caseId)} <span>${escapeHtml(head.caseCategory)}</span></h2>
<p class="user-input"><strong>userInput:</strong> ${escapeHtml(head.userInput)}</p>
<table>
<thead><tr><th>Model</th><th>Repeat</th><th>LLM 1st sent</th><th>LLM done</th><th>Response (first 120)</th></tr></thead>
<tbody>${lines}</tbody>
</table>
</section>`;
    })
    .join("\n");

  // E2E audio sample (first row per llm × tts × mode for one case)
  const e2eByKey = new Map<string, E2eRow>();
  for (const r of input.e2eRows) {
    if (r.status !== "success" || !r.outputFile) continue;
    const k = `${r.llmModel}|${r.ttsProvider}|${r.mode}`;
    if (!e2eByKey.has(k)) e2eByKey.set(k, r);
  }
  const audioRows = [...e2eByKey.values()]
    .map(
      (r) => `<tr>
<td>${escapeHtml(r.llmProvider + ":" + r.llmModel)}</td>
<td>${escapeHtml(String(r.ttsProvider))}</td>
<td>${escapeHtml(r.mode)}</td>
<td>${escapeHtml(r.caseId)}</td>
<td>${fmtMs(r.e2eFirstAudioMs)}</td>
<td>${fmtMs(r.e2eDoneMs)}</td>
<td>${
        r.outputFile
          ? `<audio controls preload="none" src="${escapeHtml(
              relPath(input.outputDir, r.outputFile)
            )}"></audio>`
          : "—"
      }</td>
</tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quality-Latency Pareto — ${escapeHtml(input.runId)}</title>
<style>
body { font-family: "Segoe UI", "Hiragino Sans", sans-serif; margin: 24px; background: #f6f5ef; color: #1f2937; }
h1 { margin-bottom: 8px; }
section.summary, section.case, section.frontier, section.audio { background: white; border-radius: 16px; padding: 20px; margin-top: 20px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
h2 span { font-size: 0.8em; color: #6b7280; margin-left: 8px; }
.user-input { background: #f1f5f9; padding: 8px 12px; border-radius: 8px; margin: 6px 0; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { text-align: left; padding: 8px; border-top: 1px solid #e5e7eb; vertical-align: top; font-size: 13px; }
.response-cell { color: #475569; max-width: 500px; }
.tier { padding: 2px 8px; border-radius: 8px; font-size: 12px; font-weight: 600; }
.tier-1 { background: #dcfce7; color: #166534; }
.tier-2 { background: #fef9c3; color: #713f12; }
.tier-dominated { background: #fee2e2; color: #991b1b; }
audio { width: 220px; }
</style>
</head>
<body>
<h1>Quality-Latency Pareto Benchmark</h1>
<p>runId: <code>${escapeHtml(input.runId)}</code></p>

<section class="summary">
<h2>Quality summary (per candidate model)</h2>
<table>
<thead><tr><th>Candidate</th><th>Avg quality</th><th>Rule pass</th><th>Knockout</th></tr></thead>
<tbody>${summaryRows.join("\n")}</tbody>
</table>
</section>

<section class="frontier">
<h2>Pareto frontier (LLM × TTS × mode)</h2>
<table>
<thead><tr><th>LLM</th><th>TTS</th><th>Mode</th><th>Quality</th><th>p90 E2E first</th><th>p90 E2E done</th><th>Rule pass</th><th>Success</th><th>Composite</th><th>Tier</th></tr></thead>
<tbody>${frontierTable}</tbody>
</table>
</section>

<section class="audio">
<h2>Audio sample (first per LLM×TTS×mode)</h2>
<table>
<thead><tr><th>LLM</th><th>TTS</th><th>Mode</th><th>Case</th><th>p E2E first</th><th>p E2E done</th><th>Audio</th></tr></thead>
<tbody>${audioRows}</tbody>
</table>
</section>

${caseSections}
</body>
</html>`;
}
