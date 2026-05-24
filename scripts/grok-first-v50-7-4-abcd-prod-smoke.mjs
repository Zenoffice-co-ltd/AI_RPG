// Run the v50-7-4 base plus A/B/C/D production smoke as one evidence batch.
//
// Usage:
//   node scripts/grok-first-v50-7-4-abcd-prod-smoke.mjs --mode start
//   node scripts/grok-first-v50-7-4-abcd-prod-smoke.mjs --mode voice-turn

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const mode = stringArg(args.mode, "start");
const origin = stringArg(args.origin, "https://roleplay.mendan.biz");
const runs = numberArg(args.runs, 1);
const project = stringArg(args.project, "adecco-mendan");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(
  stringArg(args.out, path.join("out", "grok_first_v50_7_4_abcd_prod_smoke", timestamp))
);
const variants = ["v50-7-4", "v50-7-4-a", "v50-7-4-b", "v50-7-4-c", "v50-7-4-d"];

mkdirSync(outDir, { recursive: true });

const results = [];
for (const variant of variants) {
  const variantOut = path.join(outDir, variant);
  const childArgs = [
    "scripts/grok-first-v50-prod-smoke.mjs",
    "--variant",
    variant,
    "--mode",
    mode,
    "--origin",
    origin,
    "--project",
    project,
    "--runs",
    String(runs),
    "--out",
    variantOut,
    "--require-opening-playback",
    mode === "session" ? "false" : "true",
  ];
  const child = spawnSync(process.execPath, childArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  const evidencePath = path.join(variantOut, "evidence.json");
  const evidence = existsSync(evidencePath)
    ? JSON.parse(readFileSync(evidencePath, "utf8"))
    : null;
  results.push({
    variant,
    outDir: variantOut,
    exitCode: child.status,
    pass: child.status === 0 && evidence?.pass === true,
    sessionId: evidence?.sessionId ?? null,
    promptVersion: evidence?.sessionPayload?.promptVersion ?? null,
    guardrailVersion: evidence?.sessionPayload?.guardrailVersion ?? null,
    eventKinds: evidence?.eventKinds ?? [],
    errorTextVisible: evidence?.errorTextVisible ?? null,
  });
}

const summary = {
  mode,
  origin,
  runs,
  variants,
  startedAt: timestamp,
  completedAt: new Date().toISOString(),
  pass: results.every((result) => result.pass),
  results,
};

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(summary, null, 2));
writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(summary, null, 2));
writeFileSync(path.join(outDir, "report.md"), renderReport(summary));
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.pass ? 0 : 1;

function renderReport(summaryData) {
  return [
    "# v50-7-4 A/B/C/D Production Smoke",
    "",
    `Mode: ${summaryData.mode}`,
    `Origin: ${summaryData.origin}`,
    `Runs: ${summaryData.runs}`,
    `Final result: ${summaryData.pass ? "PASS" : "FAIL"}`,
    "",
    "| Variant | Pass | Prompt Version | Session ID | Opening Events | Evidence |",
    "|---|---:|---|---|---|---|",
    ...summaryData.results.map((result) => {
      const openingEvents = result.eventKinds
        .filter((kind) => String(kind).startsWith("opening.playback."))
        .join(", ");
      return `| ${result.variant} | ${result.pass ? "yes" : "no"} | ${result.promptVersion ?? ""} | ${result.sessionId ?? ""} | ${openingEvents || ""} | ${result.outDir} |`;
    }),
    "",
    "Success requires each child smoke to pass; for `start` and `voice-turn`, `session.ready` alone is insufficient and `opening.playback.started` plus `opening.playback.completed` is required.",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    if (inlineValue !== undefined) {
      out[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function stringArg(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
