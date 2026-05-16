#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const RUNS = numberArg(args.runs, 20);
const MODE = stringArg(args.mode, "voice");
const ORIGIN = stringArg(
  args.origin,
  "https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app"
);
const OUT_DIR = resolve(
  stringArg(
    args.out,
    `out/grok_first_vfinal_latency/${new Date().toISOString().replace(/[:.]/g, "-")}`
  )
);

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

async function main() {
  if (!["text", "voice"].includes(MODE)) {
    throw new Error(`Unsupported latency mode: ${MODE}`);
  }
  if (RUNS < 1) throw new Error("--runs must be >= 1");
  await mkdir(OUT_DIR, { recursive: true });

  const results = [];
  for (let index = 1; index <= RUNS; index += 1) {
    const runDir = resolve(OUT_DIR, `run-${String(index).padStart(2, "0")}`);
    await mkdir(runDir, { recursive: true });
    const child = spawnSync(
      process.execPath,
      [
        "scripts/grok-first-vfinal-browser-e2e.mjs",
        "--mode",
        MODE,
        "--origin",
        ORIGIN,
        "--out",
        runDir,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 16,
      }
    );
    await writeFile(resolve(runDir, "stdout.log"), child.stdout ?? "");
    await writeFile(resolve(runDir, "stderr.log"), child.stderr ?? "");

    const evidence = await readEvidence(runDir).catch((error) => ({
      pass: false,
      failures: [error instanceof Error ? error.message : String(error)],
    }));
    const metric = Array.isArray(evidence.metrics) ? evidence.metrics[0] : null;
    const row = {
      index,
      pass: Boolean(evidence.pass),
      exitCode: child.status,
      startedAt: evidence.startedAt ?? null,
      completedAt: evidence.completedAt ?? null,
      sessionStatus: evidence.sessionResponse?.status ?? null,
      sessionApiMs: evidence.sessionApiMs ?? null,
      firstAudioDeltaMs: metric?.firstAudioDeltaMs ?? null,
      firstAudibleAudioMs: metric?.firstAudibleAudioMs ?? null,
      doneMs: metric?.doneMs ?? null,
      websocketReconnectCount: metric?.websocketReconnectCount ?? null,
      directApiXaiConnectionCount: evidence.directApiXaiConnectionCount ?? null,
      websocketUrls: evidence.websocketUrls ?? [],
      failures: evidence.failures ?? [],
      evidencePath: resolve(runDir, "evidence.json"),
    };
    results.push(row);
    console.log(
      `[${index}/${RUNS}] pass=${row.pass} session=${fmt(row.sessionApiMs)} firstDelta=${fmt(row.firstAudioDeltaMs)} firstAudible=${fmt(row.firstAudibleAudioMs)} done=${fmt(row.doneMs)}`
    );
  }

  const passing = results.filter((row) => row.pass);
  const summary = {
    mode: MODE,
    origin: ORIGIN,
    outDir: OUT_DIR,
    runCount: results.length,
    passCount: passing.length,
    failCount: results.length - passing.length,
    sessionApiMs: percentileSummary(passing.map((row) => row.sessionApiMs).filter(isNumber)),
    firstAudioDeltaMs: percentileSummary(
      passing.map((row) => row.firstAudioDeltaMs).filter(isNumber)
    ),
    firstAudibleAudioMs: percentileSummary(
      passing.map((row) => row.firstAudibleAudioMs).filter(isNumber)
    ),
    doneMs: percentileSummary(passing.map((row) => row.doneMs).filter(isNumber)),
    directApiXaiConnectionCount: sum(results.map((row) => row.directApiXaiConnectionCount)),
    websocketReconnectCount: sum(results.map((row) => row.websocketReconnectCount)),
    unexpectedWebsocketUrlCount: results.filter((row) =>
      row.websocketUrls.some((url) => url !== "wss://voice.mendan.biz/api/v3/realtime-relay")
    ).length,
    results,
  };
  await writeFile(resolve(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(omitResults(summary), null, 2));
  process.exit(summary.failCount === 0 ? 0 : 1);
}

async function readEvidence(runDir) {
  return JSON.parse(await readFile(resolve(runDir, "evidence.json"), "utf8"));
}

function percentileSummary(values) {
  if (values.length === 0) return { count: 0, p50: null, p95: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[Math.max(0, index)];
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sum(values) {
  return values.filter(isNumber).reduce((total, value) => total + value, 0);
}

function omitResults(summary) {
  const { results: _results, ...rest } = summary;
  return rest;
}

function fmt(value) {
  return isNumber(value) ? `${value}ms` : "n/a";
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const next = argv[index + 1];
    parsed[key.slice(2)] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) index += 1;
  }
  return parsed;
}

function stringArg(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberArg(value, fallback) {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
