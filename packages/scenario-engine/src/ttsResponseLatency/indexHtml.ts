import { relative } from "node:path";
import type { ResponseLatencyRow } from "./types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function relativeAudioPath(outputDir: string, file: string): string {
  return relative(outputDir, file).replaceAll("\\", "/");
}

function fmtMs(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

export function buildResponseLatencyIndexHtml(args: {
  runId: string;
  outputDir: string;
  rows: ResponseLatencyRow[];
}): string {
  const byCase = new Map<string, ResponseLatencyRow[]>();
  for (const row of args.rows) {
    const list = byCase.get(row.caseId) ?? [];
    list.push(row);
    byCase.set(row.caseId, list);
  }

  const sections = [...byCase.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([caseId, caseRows]) => {
      const head = caseRows[0]!;
      const sample = caseRows.find((r) => r.responseText.length > 0);
      const responsePreview = sample?.responseText ?? "";

      const modeSections = (["llm-only", "full-text", "first-sentence"] as const)
        .map((mode) => {
          const modeRows = caseRows.filter((r) => r.mode === mode);
          if (modeRows.length === 0) return "";
          const sortedRows = [...modeRows].sort((a, b) => {
            if (a.ttsProvider !== b.ttsProvider) {
              return a.ttsProvider.localeCompare(b.ttsProvider);
            }
            return a.repeatIndex - b.repeatIndex;
          });

          const tableRows = sortedRows
            .map((row) => {
              const audioCell =
                row.status === "success" && row.outputFile
                  ? `<audio controls preload="none" src="${escapeHtml(
                      relativeAudioPath(args.outputDir, row.outputFile)
                    )}"></audio>`
                  : row.mode === "llm-only"
                  ? "—"
                  : `<span class="error">${escapeHtml(row.errorMessage || row.errorCode || "no audio")}</span>`;

              const providerLabel = row.ttsProvider || "(llm-only)";
              return `<tr>
<td class="provider-cell" data-provider="${escapeHtml(providerLabel)}">
  <span class="provider-name">${escapeHtml(providerLabel)}</span>
  <span class="provider-hidden">${escapeHtml(
    row.llmCacheKey.slice(0, 8) + ":" + row.repeatIndex
  )}</span>
</td>
<td>${escapeHtml(row.voiceId)}</td>
<td>r${row.repeatIndex}</td>
<td>${fmtMs(row.llmRequestToFirstTokenMs)}</td>
<td>${fmtMs(row.llmRequestToFirstSentenceMs)}</td>
<td>${fmtMs(row.llmRequestToDoneMs)}</td>
<td>${fmtMs(row.ttsRequestToFirstAudioMs)}</td>
<td>${fmtMs(row.e2eFirstAudioMs)}</td>
<td>${fmtMs(row.e2eDoneMs)}</td>
<td>${fmtMs(row.overlapGainMs)}</td>
<td>${row.llmCacheHit ? "cached" : "fresh"}</td>
<td>${audioCell}</td>
</tr>`;
            })
            .join("\n");

          return `<div class="mode-block">
<h3>${escapeHtml(mode)}</h3>
<table>
<thead>
<tr>
  <th>Provider</th><th>Voice</th><th>Repeat</th>
  <th>LLM 1st token</th><th>LLM 1st sent</th><th>LLM done</th>
  <th>TTS 1st audio</th><th>E2E 1st audio</th><th>E2E done</th><th>Overlap gain</th>
  <th>LLM</th><th>Audio</th>
</tr>
</thead>
<tbody>
${tableRows}
</tbody>
</table>
</div>`;
        })
        .filter((html) => html.length > 0)
        .join("\n");

      return `<section class="case">
<h2>${escapeHtml(caseId)} <span>${escapeHtml(head.category)}</span></h2>
<p class="user-input"><strong>userInput:</strong> ${escapeHtml(head.userInput)}</p>
${responsePreview ? `<p class="response-preview"><strong>responseText:</strong> ${escapeHtml(responsePreview)}</p>` : ""}
${modeSections}
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TTS Response Latency Benchmark — ${escapeHtml(args.runId)}</title>
<style>
body { font-family: "Segoe UI", "Hiragino Sans", sans-serif; margin: 24px; background: #f6f5ef; color: #1f2937; }
h1 { margin-bottom: 8px; }
.toolbar { margin: 12px 0 24px; }
.toolbar button { padding: 8px 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: white; cursor: pointer; font-size: 14px; }
.toolbar button:hover { background: #f1f5f9; }
section.case { background: white; border-radius: 16px; padding: 20px; margin-top: 20px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
h2 span { font-size: 0.8em; color: #6b7280; margin-left: 8px; }
.user-input, .response-preview { background: #f1f5f9; padding: 8px 12px; border-radius: 8px; margin: 6px 0; }
.mode-block { margin-top: 16px; }
.mode-block h3 { color: #475569; margin: 12px 0 6px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px; border-top: 1px solid #e5e7eb; vertical-align: top; font-size: 13px; }
audio { width: 220px; }
.error { color: #b91c1c; font-weight: 600; }
.provider-hidden { display: none; font-family: monospace; color: #475569; }
body.blind .provider-name { display: none; }
body.blind .provider-hidden { display: inline; }
</style>
</head>
<body>
<h1>TTS Response Latency Benchmark</h1>
<p>runId: <code>${escapeHtml(args.runId)}</code></p>
<div class="toolbar">
  <button type="button" id="toggle-blind">Toggle blind mode</button>
</div>
${sections}
<script>
document.getElementById("toggle-blind").addEventListener("click", function () {
  document.body.classList.toggle("blind");
});
</script>
</body>
</html>`;
}
