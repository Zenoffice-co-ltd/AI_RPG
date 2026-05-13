#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const paths = {
  browserV50: arg("--browser-v50"),
  baseline: arg("--baseline"),
  live5: arg("--live5"),
  cloud: arg("--cloud"),
};

for (const [key, value] of Object.entries(paths)) {
  if (!value) {
    console.error(
      "Usage: node scripts/grok-first-v50-dod-audit.mjs --browser-v50 <summary.json> --baseline <summary.json> --live5 <summary.json> --cloud <cloud-summary.json>"
    );
    console.error(`Missing required argument: --${toKebab(key)}`);
    process.exit(2);
  }
}

const browserV50 = await readJson(paths.browserV50);
const baseline = await readJson(paths.baseline);
const live5 = await readJson(paths.live5);
const cloud = await readJson(paths.cloud);

const checks = [
  check("structure: isolated v50 route/API evidence", browserV50.demoSlug === "adecco-roleplay-v50"),
  check("quality: live xAI 7 cases x 5 rounds", live5.cases?.length === 35),
  check("quality: live xAI overall pass", live5.overallPass === true),
  check("quality: five-run variance pass", live5.variance?.pass === true),
  check("browser audio: v50 turn.completed 7/7", browserV50.turnCount === 7),
  check("browser audio: v50 failures empty", Array.isArray(browserV50.failures) && browserV50.failures.length === 0),
  check("browser audio: no runtime/replacement TTS fetch attempts", Array.isArray(browserV50.ttsFetchAttempts) && browserV50.ttsFetchAttempts.length === 0),
  check("browser audio: no console errors", Array.isArray(browserV50.consoleErrors) && browserV50.consoleErrors.length === 0),
  check("browser audio: no websocket errors", countWebsocketErrors(browserV50) === 0),
  check("browser audio: unexpected reconnect <= 1/session", maxReconnect(browserV50) <= 1),
  check("production logs: turn.completed 7/7", cloud.turnCompletedCount === 7),
  check("production logs: runtime TTS 0", Number(cloud.runtimeTtsCount) === 0),
  check("production logs: tool calls 0", Number(cloud.toolCallCount) === 0),
  check("production logs: full-turn buffer 0", Number(cloud.fullTurnBufferCount) === 0),
  check("production logs: fixed-answer hits 0", fixedAnswerTotal(cloud) === 0),
  check("production logs: audible forbidden suffix 0", Number(cloud.audibleForbiddenSuffixCount) === 0),
  check("production logs: closing question leak 0", Number(cloud.closingQuestionLeakCount) === 0),
  ...latencyChecks(baseline, browserV50),
];

const overallPass = checks.every((item) => item.pass);
const summary = {
  overallPass,
  evidence: paths,
  checks,
};

if (arg("--out") === "markdown") {
  console.log(renderMarkdown(summary));
} else {
  console.log(JSON.stringify(summary, null, 2));
}

process.exit(overallPass ? 0 : 1);

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function check(name, pass, note = "") {
  return { name, pass: Boolean(pass), note };
}

function latencyChecks(baseline, v50) {
  return [
    latencyCheck(
      "latency: firstAudibleAudioMs p50 <= baseline + 300ms",
      baseline.firstAudibleAudioMs?.p50,
      v50.firstAudibleAudioMs?.p50,
      300
    ),
    latencyCheck(
      "latency: firstAudibleAudioMs p95 <= baseline + 600ms",
      baseline.firstAudibleAudioMs?.p95,
      v50.firstAudibleAudioMs?.p95,
      600
    ),
    latencyCheck(
      "latency: firstAudioDeltaMs p50 <= baseline + 200ms",
      baseline.firstAudioDeltaMs?.p50,
      v50.firstAudioDeltaMs?.p50,
      200
    ),
  ];
}

function latencyCheck(name, baseline, v50, maxDeltaMs) {
  if (typeof baseline !== "number" || typeof v50 !== "number") {
    return check(name, false, `OPEN: baseline=${formatMs(baseline)}, v50=${formatMs(v50)}`);
  }
  const delta = v50 - baseline;
  return check(
    name,
    delta <= maxDeltaMs,
    `baseline=${baseline}ms, v50=${v50}ms, delta=${delta >= 0 ? "+" : ""}${delta}ms, threshold=+${maxDeltaMs}ms`
  );
}

function countWebsocketErrors(summary) {
  return (summary.websocketEvents ?? []).reduce(
    (sum, event) => sum + (Array.isArray(event.errors) ? event.errors.length : 0),
    0
  );
}

function maxReconnect(summary) {
  return Math.max(
    0,
    ...(summary.results ?? []).map((result) =>
      typeof result.websocketReconnectCount === "number"
        ? result.websocketReconnectCount
        : 0
    )
  );
}

function fixedAnswerTotal(cloud) {
  return (
    Number(cloud.businessRegisteredSpeechHitCount) +
    Number(cloud.businessPr60LockHitCount) +
    Number(cloud.fixedFallbackBusinessHitCount)
  );
}

function formatMs(value) {
  return typeof value === "number" ? `${value}ms` : "n/a";
}

function renderMarkdown(summary) {
  return [
    "| DOD check | result | note |",
    "|---|---|---|",
    ...summary.checks.map(
      (item) =>
        `| ${item.name} | ${item.pass ? "PASS" : "FAIL"} | ${item.note || ""} |`
    ),
    "",
    `overallPass: **${summary.overallPass ? "PASS" : "FAIL"}**`,
    `browser-v50: \`${summary.evidence.browserV50}\``,
    `baseline: \`${summary.evidence.baseline}\``,
    `live5: \`${summary.evidence.live5}\``,
    `cloud: \`${summary.evidence.cloud}\``,
  ].join("\n");
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
