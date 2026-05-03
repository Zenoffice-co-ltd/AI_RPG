import { relative } from "node:path";
import type { BenchmarkRow } from "./types";

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

export function buildProviderBenchmarkIndexHtml(args: {
  runId: string;
  outputDir: string;
  rows: BenchmarkRow[];
}): string {
  const byUtterance = new Map<string, BenchmarkRow[]>();
  for (const row of args.rows) {
    const list = byUtterance.get(row.utteranceId) ?? [];
    list.push(row);
    byUtterance.set(row.utteranceId, list);
  }

  const sections = [...byUtterance.values()]
    .sort((a, b) => a[0]!.utteranceId.localeCompare(b[0]!.utteranceId))
    .map((rows) => {
      const head = rows[0]!;
      const tableRows = rows
        .sort((a, b) => {
          if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
          if (a.voiceId !== b.voiceId) return a.voiceId.localeCompare(b.voiceId);
          return a.repeatIndex - b.repeatIndex;
        })
        .map((row) => {
          const audioCell =
            row.status === "success" && row.outputFile
              ? `<audio controls preload="none" src="${escapeHtml(
                  relativeAudioPath(args.outputDir, row.outputFile)
                )}"></audio>`
              : `<span class="error">${escapeHtml(row.errorMessage || row.errorCode || "render failed")}</span>`;

          const firstAudio =
            row.requestToFirstAudioMs === null ? "—" : `${row.requestToFirstAudioMs} ms`;
          const total =
            row.requestToLastAudioMs === null ? "—" : `${row.requestToLastAudioMs} ms`;

          return `<tr>
<td class="provider-cell" data-provider="${escapeHtml(row.provider)}">
  <span class="provider-name">${escapeHtml(row.provider)}</span>
  <span class="provider-hidden">${escapeHtml(row.providerHiddenId)}</span>
</td>
<td>${escapeHtml(row.model)}</td>
<td>${escapeHtml(row.voiceId)}</td>
<td>r${row.repeatIndex}</td>
<td>${firstAudio}</td>
<td>${total}</td>
<td>${audioCell}</td>
</tr>`;
        })
        .join("\n");

      return `<section class="utterance">
<h2>${escapeHtml(head.utteranceId)} <span>${escapeHtml(head.category)}</span></h2>
<p>${escapeHtml(head.utterance)}</p>
<table>
<thead>
<tr><th>Provider</th><th>Model</th><th>Voice</th><th>Repeat</th><th>First audio</th><th>Total</th><th>Audio</th></tr>
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
<title>TTS Provider Benchmark — ${escapeHtml(args.runId)}</title>
<style>
body { font-family: "Segoe UI", "Hiragino Sans", sans-serif; margin: 24px; background: #f6f5ef; color: #1f2937; }
h1 { margin-bottom: 8px; }
.toolbar { margin: 12px 0 24px; }
.toolbar button { padding: 8px 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: white; cursor: pointer; font-size: 14px; }
.toolbar button:hover { background: #f1f5f9; }
section { background: white; border-radius: 16px; padding: 20px; margin-top: 20px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
h2 span { font-size: 0.8em; color: #6b7280; margin-left: 8px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { text-align: left; padding: 10px; border-top: 1px solid #e5e7eb; vertical-align: top; }
audio { width: 260px; }
.error { color: #b91c1c; font-weight: 600; }
.provider-hidden { display: none; font-family: monospace; color: #475569; }
body.blind .provider-name { display: none; }
body.blind .provider-hidden { display: inline; }
</style>
</head>
<body>
<h1>TTS Provider Benchmark</h1>
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
