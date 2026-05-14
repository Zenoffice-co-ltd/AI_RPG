#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const baselinePath = arg("--baseline");
const v50Path = arg("--v50");
const out = arg("--out");

if (!baselinePath || !v50Path) {
  console.error(
    "Usage: node scripts/grok-first-v50-latency-dod.mjs --baseline <summary.json> --v50 <summary.json> [--out markdown]"
  );
  process.exit(2);
}

const baseline = await readSummary(baselinePath);
const v50 = await readSummary(v50Path);

const rows = [
  compareMetric({
    name: "firstAudibleAudioMs p50",
    baseline: baseline.firstAudibleAudioMs?.p50,
    v50: v50.firstAudibleAudioMs?.p50,
    maxDeltaMs: 300,
  }),
  compareMetric({
    name: "firstAudibleAudioMs p95",
    baseline: baseline.firstAudibleAudioMs?.p95,
    v50: v50.firstAudibleAudioMs?.p95,
    maxDeltaMs: 600,
  }),
  compareMetric({
    name: "firstAudioDeltaMs p50",
    baseline: baseline.firstAudioDeltaMs?.p50,
    v50: v50.firstAudioDeltaMs?.p50,
    maxDeltaMs: 200,
  }),
];

const summary = {
  baseline: {
    path: baselinePath,
    demoSlug: baseline.demoSlug,
    turnCount: baseline.turnCount,
  },
  v50: {
    path: v50Path,
    demoSlug: v50.demoSlug,
    turnCount: v50.turnCount,
  },
  rows,
  overallPass: rows.every((row) => row.result === "PASS"),
};

const markdown = renderMarkdown(summary);
if (out === "markdown") {
  console.log(markdown);
} else {
  console.log(JSON.stringify(summary, null, 2));
}
process.exit(summary.overallPass ? 0 : 1);

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readSummary(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function compareMetric({ name, baseline, v50, maxDeltaMs }) {
  if (typeof baseline !== "number" || typeof v50 !== "number") {
    return {
      metric: name,
      baseline: formatMs(baseline),
      v50: formatMs(v50),
      delta: "n/a",
      threshold: `<= +${maxDeltaMs}ms`,
      result: "OPEN",
    };
  }
  const delta = v50 - baseline;
  return {
    metric: name,
    baseline: formatMs(baseline),
    v50: formatMs(v50),
    delta: `${delta >= 0 ? "+" : ""}${delta}ms`,
    threshold: `<= +${maxDeltaMs}ms`,
    result: delta <= maxDeltaMs ? "PASS" : "FAIL",
  };
}

function formatMs(value) {
  return typeof value === "number" ? `${value}ms` : "n/a";
}

function renderMarkdown(summary) {
  const lines = [
    "| metric | baseline | v50 | delta | threshold | result |",
    "|---|---:|---:|---:|---:|---|",
    ...summary.rows.map(
      (row) =>
        `| ${row.metric} | ${row.baseline} | ${row.v50} | ${row.delta} | ${row.threshold} | ${row.result} |`
    ),
    "",
    `overallPass: **${summary.overallPass ? "PASS" : "FAIL"}**`,
    `baseline: \`${summary.baseline.path}\``,
    `v50: \`${summary.v50.path}\``,
  ];
  return lines.join("\n");
}
