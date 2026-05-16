#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const roots = listArgs("root");
const expected = valueArg("expect") ?? "blocked";
const minRuns = numberArg("min-runs", 20);
const maxFiles = numberArg("max-files", 5000);

if (hasFlag("self-test")) {
  runSelfTest();
  process.exit(0);
}

const scanRoots =
  roots.length > 0 ? roots : ["out/grok_first_vfinal_latency"].filter((path) => existsSync(path));
const failures = [];
const artifacts = [];
let visitedFiles = 0;

for (const root of scanRoots) {
  scanRoot(resolve(root));
}

const strictMetricCandidates = artifacts.filter((artifact) => artifact.hasRequiredMetrics);
const strictDenominatorCandidates = strictMetricCandidates.filter(
  (artifact) => artifact.runCount >= minRuns && artifact.failCount === 0
);
const explicitPreVFinalCandidates = strictDenominatorCandidates.filter(
  (artifact) => artifact.preVFinalMarker
);
const currentVFinalOnlyCandidates = strictDenominatorCandidates.filter(
  (artifact) => artifact.currentVFinalMarker && !artifact.preVFinalMarker
);

if (expected === "blocked" && explicitPreVFinalCandidates.length > 0) {
  failures.push(
    "expected BLOCKED inventory but found at least one artifact with an explicit pre-vFinal marker"
  );
}
if (expected === "pass" && explicitPreVFinalCandidates.length === 0) {
  failures.push("expected PASS inventory but found no explicit pre-vFinal baseline candidate");
}

const output = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  expected,
  minRuns,
  roots: scanRoots.map((root) => resolve(root)),
  visitedFiles,
  artifactCount: artifacts.length,
  strictMetricCandidateCount: strictMetricCandidates.length,
  strictDenominatorCandidateCount: strictDenominatorCandidates.length,
  explicitPreVFinalCandidateCount: explicitPreVFinalCandidates.length,
  currentVFinalOnlyCandidateCount: currentVFinalOnlyCandidates.length,
  artifacts: artifacts.map((artifact) => ({
    path: artifact.path,
    runCount: artifact.runCount,
    passCount: artifact.passCount,
    failCount: artifact.failCount,
    hasRequiredMetrics: artifact.hasRequiredMetrics,
    missingMetrics: artifact.missingMetrics,
    preVFinalMarker: artifact.preVFinalMarker,
    currentVFinalMarker: artifact.currentVFinalMarker,
    sessionApiMsP95: artifact.sessionApiMsP95,
    firstAudioDeltaMsP95: artifact.firstAudioDeltaMsP95,
    firstAudibleAudioMsP95: artifact.firstAudibleAudioMsP95,
    closeCode1006Count: artifact.closeCode1006Count,
    relayErrorCount: artifact.relayErrorCount,
    assessment: artifact.assessment,
  })),
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length > 0) {
  process.exitCode = 1;
}

function scanRoot(root) {
  if (!existsSync(root)) {
    failures.push(`root does not exist: ${root}`);
    return;
  }
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      failures.push(`cannot read directory ${dir}: ${messageOf(error)}`);
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.name !== "summary.json") continue;
      visitedFiles += 1;
      if (visitedFiles > maxFiles) {
        failures.push(`summary.json scan exceeded --max-files=${maxFiles}`);
        return;
      }
      artifacts.push(inspectSummary(fullPath));
    }
  }
}

function inspectSummary(path) {
  let summary;
  try {
    summary = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(`cannot parse summary JSON ${path}: ${messageOf(error)}`);
    return failedArtifact(path);
  }
  const requiredMetrics = ["sessionApiMs", "firstAudioDeltaMs", "firstAudibleAudioMs"];
  const missingMetrics = requiredMetrics.filter((metric) => !metricHasP95(summary?.[metric]));
  const runCount = numberOr(summary?.runCount, 0);
  const passCount = numberOr(summary?.passCount, 0);
  const failCount = numberOr(summary?.failCount, null);
  const text = `${path}\n${JSON.stringify(summary).slice(0, 20000)}`;
  const preVFinalMarker =
    /\bpre[-_ ]?vfinal\b|\bbaseline\b|before vfinal|before-vfinal/iu.test(text) &&
    !/\bcurrent[-_ ]?vfinal\b/iu.test(text);
  const currentVFinalMarker =
    /grok-first-vfinal|adecco-roleplay-vFinal|grok_first_vfinal|current[-_ ]?vfinal/iu.test(text);
  return {
    path: resolve(path),
    runCount,
    passCount,
    failCount,
    hasRequiredMetrics: missingMetrics.length === 0,
    missingMetrics,
    preVFinalMarker,
    currentVFinalMarker,
    sessionApiMsP95: numberOr(summary?.sessionApiMs?.p95, null),
    firstAudioDeltaMsP95: numberOr(summary?.firstAudioDeltaMs?.p95, null),
    firstAudibleAudioMsP95: numberOr(summary?.firstAudibleAudioMs?.p95, null),
    closeCode1006Count: countValue(summary, [
      "closeCode1006",
      "closeCode1006Count",
      "wssCloseCode1006",
    ]),
    relayErrorCount: countValue(summary, ["relayError", "relayErrorCount", "relay.error"]),
    assessment: assessmentFor({ runCount, failCount, missingMetrics, preVFinalMarker }),
  };
}

function failedArtifact(path) {
  return {
    path: resolve(path),
    runCount: 0,
    passCount: 0,
    failCount: null,
    hasRequiredMetrics: false,
    missingMetrics: ["sessionApiMs", "firstAudioDeltaMs", "firstAudibleAudioMs"],
    preVFinalMarker: false,
    currentVFinalMarker: false,
    sessionApiMsP95: null,
    firstAudioDeltaMsP95: null,
    firstAudibleAudioMsP95: null,
    closeCode1006Count: null,
    relayErrorCount: null,
    assessment: "Unreadable summary.",
  };
}

function assessmentFor({ runCount, failCount, missingMetrics, preVFinalMarker }) {
  if (missingMetrics.length > 0) {
    return `Missing required metrics: ${missingMetrics.join(", ")}.`;
  }
  if (runCount < minRuns) {
    return `Denominator below ${minRuns}.`;
  }
  if (failCount !== 0) {
    return "Contains failed runs.";
  }
  if (!preVFinalMarker) {
    return "Strict metric candidate, but no explicit pre-vFinal baseline marker.";
  }
  return "Explicit pre-vFinal baseline candidate.";
}

function metricHasP95(value) {
  return isNumber(value?.p95) && isNumber(value?.count);
}

function countValue(summary, keys) {
  for (const key of keys) {
    const value = summary?.[key];
    if (isNumber(value)) return value;
    if (isNumber(value?.count)) return value.count;
  }
  return null;
}

function numberOr(value, fallback) {
  return isNumber(value) ? value : fallback;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function numberArg(name, fallback) {
  const value = valueArg(name);
  if (value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`--${name} must be a number`);
  }
  return number;
}

function listArgs(name) {
  const prefix = `--${name}=`;
  const values = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
    } else if (arg === `--${name}` && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function valueArg(name) {
  const prefix = `--${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${name}` && process.argv[index + 1]) {
      return process.argv[index + 1];
    }
  }
  return null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function runSelfTest() {
  const current = inspectSummaryFromObject("current-summary.json", {
    runCount: 20,
    passCount: 20,
    failCount: 0,
    sessionApiMs: { count: 20, p95: 300 },
    firstAudioDeltaMs: { count: 20, p95: 5500 },
    firstAudibleAudioMs: { count: 20, p95: 5700 },
    origin: "https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app",
  });
  if (!current.hasRequiredMetrics || !current.currentVFinalMarker || current.preVFinalMarker) {
    throw new Error("current-vFinal fixture classification failed");
  }
  const baseline = inspectSummaryFromObject("pre-vFinal-baseline-summary.json", {
    runCount: 20,
    passCount: 20,
    failCount: 0,
    sessionApiMs: { count: 20, p95: 280 },
    firstAudioDeltaMs: { count: 20, p95: 5400 },
    firstAudibleAudioMs: { count: 20, p95: 5600 },
  });
  if (!baseline.hasRequiredMetrics || !baseline.preVFinalMarker) {
    throw new Error("pre-vFinal baseline fixture classification failed");
  }
  console.log("vFinal latency artifact inventory self-test PASS");
}

function inspectSummaryFromObject(path, summary) {
  const requiredMetrics = ["sessionApiMs", "firstAudioDeltaMs", "firstAudibleAudioMs"];
  const missingMetrics = requiredMetrics.filter((metric) => !metricHasP95(summary?.[metric]));
  const runCount = numberOr(summary?.runCount, 0);
  const failCount = numberOr(summary?.failCount, null);
  const text = `${path}\n${JSON.stringify(summary)}`;
  const preVFinalMarker =
    /\bpre[-_ ]?vfinal\b|\bbaseline\b|before vfinal|before-vfinal/iu.test(text) &&
    !/\bcurrent[-_ ]?vfinal\b/iu.test(text);
  const currentVFinalMarker =
    /grok-first-vfinal|adecco-roleplay-vFinal|grok_first_vfinal|current[-_ ]?vfinal/iu.test(text);
  return {
    hasRequiredMetrics: missingMetrics.length === 0,
    currentVFinalMarker,
    preVFinalMarker,
    assessment: assessmentFor({ runCount, failCount, missingMetrics, preVFinalMarker }),
  };
}
