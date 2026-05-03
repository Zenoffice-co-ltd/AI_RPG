import { summarizeRows } from "./csvWriters";
import type { LlmMatrixRow } from "./types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtMs(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function fmtNum(value: number | null, digits = 1): string {
  if (value === null) return "—";
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

export function buildLlmMatrixIndexHtml(args: {
  runId: string;
  rows: LlmMatrixRow[];
}): string {
  const summaries = summarizeRows(args.rows);
  const summaryRows = summaries
    .map(
      (s) => `<tr>
<td>${escapeHtml(s.provider)}</td>
<td>${escapeHtml(s.model)}</td>
<td>${escapeHtml(s.modelCategory)}</td>
<td>${escapeHtml(s.reasoningEffort)}</td>
<td>${s.success}/${s.total}</td>
<td>${fmtMs(s.p50FirstTokenMs)}</td>
<td>${fmtMs(s.p90FirstTokenMs)}</td>
<td>${fmtMs(s.p50FirstSentenceMs)}</td>
<td>${fmtMs(s.p90FirstSentenceMs)}</td>
<td>${fmtMs(s.p50DoneMs)}</td>
<td>${fmtMs(s.p90DoneMs)}</td>
<td>${fmtNum(s.p50CharsPerSec, 1)}</td>
<td>${fmtNum(s.p90CharsPerSec, 1)}</td>
</tr>`
    )
    .join("\n");

  const byCase = new Map<string, LlmMatrixRow[]>();
  for (const row of args.rows) {
    const list = byCase.get(row.caseId) ?? [];
    list.push(row);
    byCase.set(row.caseId, list);
  }
  const caseSections = [...byCase.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([caseId, caseRows]) => {
      const head = caseRows[0]!;
      const sortedRows = [...caseRows].sort((a, b) => {
        const providerCmp = String(a.provider).localeCompare(String(b.provider));
        if (providerCmp !== 0) return providerCmp;
        if (a.model !== b.model) return a.model.localeCompare(b.model);
        return a.repeatIndex - b.repeatIndex;
      });
      const tableRows = sortedRows
        .map(
          (row) => `<tr>
<td>${escapeHtml(row.model)}</td>
<td>${escapeHtml(row.reasoningEffort)}</td>
<td>r${row.repeatIndex}</td>
<td>${fmtMs(row.llmRequestToFirstTokenMs)}</td>
<td>${fmtMs(row.llmRequestToFirstSentenceMs)}</td>
<td>${fmtMs(row.llmRequestToDoneMs)}</td>
<td>${fmtNum(row.llmOutputCharsPerSec, 1)}</td>
<td class="response-cell">${escapeHtml(row.responseText.slice(0, 120))}${row.responseText.length > 120 ? "…" : ""}</td>
</tr>`
        )
        .join("\n");
      return `<section class="case">
<h2>${escapeHtml(caseId)} <span>${escapeHtml(head.category)}</span></h2>
<p class="user-input"><strong>userInput:</strong> ${escapeHtml(head.userInput)}</p>
<table>
<thead>
<tr><th>Model</th><th>Effort</th><th>Repeat</th><th>1st token</th><th>1st sent</th><th>Done</th><th>chars/s</th><th>Response (first 120)</th></tr>
</thead>
<tbody>
${tableRows}
</tbody>
</table>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LLM Model Latency Matrix — ${escapeHtml(args.runId)}</title>
<style>
body { font-family: "Segoe UI", "Hiragino Sans", sans-serif; margin: 24px; background: #f6f5ef; color: #1f2937; }
h1 { margin-bottom: 8px; }
section.summary, section.case { background: white; border-radius: 16px; padding: 20px; margin-top: 20px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
h2 span { font-size: 0.8em; color: #6b7280; margin-left: 8px; }
.user-input { background: #f1f5f9; padding: 8px 12px; border-radius: 8px; margin: 6px 0; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { text-align: left; padding: 8px; border-top: 1px solid #e5e7eb; vertical-align: top; font-size: 13px; }
.response-cell { color: #475569; max-width: 480px; }
</style>
</head>
<body>
<h1>LLM Model Latency Matrix</h1>
<p>runId: <code>${escapeHtml(args.runId)}</code></p>
<section class="summary">
<h2>Summary (per provider × model × reasoningEffort)</h2>
<table>
<thead>
<tr><th>Provider</th><th>Model</th><th>Category</th><th>Effort</th><th>Success</th>
<th>p50 1st token</th><th>p90 1st token</th>
<th>p50 1st sent</th><th>p90 1st sent</th>
<th>p50 done</th><th>p90 done</th>
<th>p50 chars/s</th><th>p90 chars/s</th></tr>
</thead>
<tbody>
${summaryRows}
</tbody>
</table>
</section>
${caseSections}
</body>
</html>`;
}
