#!/usr/bin/env node
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));

if (boolArg("self-test")) {
  runSelfTest().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
} else {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}

async function main() {
  const baselinePath = requiredStringArg("baseline");
  const currentPath = requiredStringArg("current");
  const comparison = compareSummaries({
    baseline: await readSummary(baselinePath),
    current: await readSummary(currentPath),
    baselinePath: resolve(baselinePath),
    currentPath: resolve(currentPath),
    minRuns: numberArg("min-runs", 20),
    counts: {
      baselineCloseCode1006: optionalNumberArg("baseline-close-code1006"),
      currentCloseCode1006: optionalNumberArg("current-close-code1006"),
      baselineRelayError: optionalNumberArg("baseline-relay-error"),
      currentRelayError: optionalNumberArg("current-relay-error"),
    },
  });

  const out = stringArg("out", null);
  if (out) {
    await writeFile(resolve(out), `${JSON.stringify(comparison, null, 2)}\n`);
  }
  console.log(JSON.stringify(comparison, null, 2));
  process.exit(comparison.status === "PASS" ? 0 : 1);
}

async function readSummary(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function compareSummaries({ baseline, current, baselinePath, currentPath, minRuns, counts }) {
  const checks = [];
  const metricThresholds = [
    ["sessionApiMs", 50],
    ["firstAudioDeltaMs", 100],
    ["firstAudibleAudioMs", 100],
  ];

  pushCheck(checks, "baseline runCount", baseline.runCount >= minRuns, {
    actual: baseline.runCount ?? null,
    required: `>=${minRuns}`,
  });
  pushCheck(checks, "current runCount", current.runCount >= minRuns, {
    actual: current.runCount ?? null,
    required: `>=${minRuns}`,
  });
  pushCheck(checks, "baseline failCount", baseline.failCount === 0, {
    actual: baseline.failCount ?? null,
    required: 0,
  });
  pushCheck(checks, "current failCount", current.failCount === 0, {
    actual: current.failCount ?? null,
    required: 0,
  });
  pushCheck(checks, "baseline identity", hasBaselineIdentityMarker(baseline, baselinePath), {
    baselinePath,
    required: "baseline artifact must identify itself as pre-vFinal/baseline evidence",
  });
  pushCheck(checks, "current identity", hasCurrentVFinalIdentityMarker(current, currentPath), {
    currentPath,
    required: "current artifact must identify itself as current vFinal evidence",
  });

  for (const [metric, thresholdMs] of metricThresholds) {
    const baselineMetric = metricSummary(baseline, metric);
    const currentMetric = metricSummary(current, metric);
    const expected = isNumber(baselineMetric.p95) ? baselineMetric.p95 + thresholdMs : null;
    pushCheck(
      checks,
      `${metric} p95`,
      isNumber(baselineMetric.p95) &&
        isNumber(currentMetric.p95) &&
        baselineMetric.count >= minRuns &&
        currentMetric.count >= minRuns &&
        currentMetric.p95 <= expected,
      {
        baselineP95: baselineMetric.p95,
        currentP95: currentMetric.p95,
        threshold: expected,
        thresholdDeltaMs: thresholdMs,
        baselineCount: baselineMetric.count,
        currentCount: currentMetric.count,
      }
    );
  }

  const baselineCloseCode1006 = countValue(
    baseline,
    counts.baselineCloseCode1006,
    ["closeCode1006", "closeCode1006Count", "wssCloseCode1006"]
  );
  const currentCloseCode1006 = countValue(current, counts.currentCloseCode1006, [
    "closeCode1006",
    "closeCode1006Count",
    "wssCloseCode1006",
  ]);
  pushCheck(
    checks,
    "closeCode1006 increase",
    isNumber(baselineCloseCode1006) &&
      isNumber(currentCloseCode1006) &&
      currentCloseCode1006 <= baselineCloseCode1006,
    {
      baseline: baselineCloseCode1006,
      current: currentCloseCode1006,
      required: "current <= baseline",
    }
  );

  const baselineRelayError = countValue(baseline, counts.baselineRelayError, [
    "relayError",
    "relayErrorCount",
    "relay.error",
  ]);
  const currentRelayError = countValue(current, counts.currentRelayError, [
    "relayError",
    "relayErrorCount",
    "relay.error",
  ]);
  pushCheck(
    checks,
    "relay.error increase",
    isNumber(baselineRelayError) &&
      isNumber(currentRelayError) &&
      currentRelayError <= baselineRelayError,
    {
      baseline: baselineRelayError,
      current: currentRelayError,
      required: "current <= baseline",
    }
  );
  pushCheck(checks, "baseline/current artifact identity", baselinePath !== currentPath, {
    baselinePath,
    currentPath,
    required: "different summary artifacts",
  });

  return {
    status: checks.every((check) => check.pass) ? "PASS" : "FAIL",
    baselinePath,
    currentPath,
    minRuns,
    checks,
  };
}

function metricSummary(summary, metric) {
  const value = summary?.[metric] ?? {};
  return {
    count: isNumber(value.count) ? value.count : 0,
    p95: isNumber(value.p95) ? value.p95 : null,
  };
}

function countValue(summary, explicitValue, keys) {
  if (isNumber(explicitValue)) return explicitValue;
  for (const key of keys) {
    const value = summary?.[key];
    if (isNumber(value)) return value;
    if (isNumber(value?.count)) return value.count;
  }
  return null;
}

function hasBaselineIdentityMarker(summary, path) {
  const text = `${path}\n${JSON.stringify(summary)}`;
  return /\bpre[-_ ]?vfinal\b|\bbaseline\b|before vfinal|before-vfinal/iu.test(text);
}

function hasCurrentVFinalIdentityMarker(summary, path) {
  const text = `${path}\n${JSON.stringify(summary)}`;
  return /\bcurrent[-_ ]?vfinal\b|adecco-roleplay-vfinal|grok[-_ ]first[-_ ]vfinal|\bvfinal\b/iu.test(text);
}

function pushCheck(checks, name, pass, details) {
  checks.push({ name, pass: Boolean(pass), ...details });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) index += 1;
  }
  return parsed;
}

function requiredStringArg(name) {
  const value = stringArg(name, null);
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function stringArg(name, fallback) {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberArg(name, fallback) {
  const value = optionalNumberArg(name);
  return isNumber(value) ? value : fallback;
}

function optionalNumberArg(name) {
  const value = args[name];
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

function boolArg(name) {
  return args[name] === "true";
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

async function runSelfTest() {
  const dir = await mkdtemp(join(tmpdir(), "vfinal-latency-compare-"));
  const baseline = {
    runCount: 20,
    failCount: 0,
    sessionApiMs: { count: 20, p95: 300 },
    firstAudioDeltaMs: { count: 20, p95: 5000 },
    firstAudibleAudioMs: { count: 20, p95: 5200 },
    closeCode1006Count: 0,
    relayErrorCount: 0,
  };
  const passingCurrent = {
    runCount: 20,
    failCount: 0,
    sessionApiMs: { count: 20, p95: 350 },
    firstAudioDeltaMs: { count: 20, p95: 5100 },
    firstAudibleAudioMs: { count: 20, p95: 5299 },
    closeCode1006Count: 0,
    relayErrorCount: 0,
  };
  const failingCurrent = {
    ...passingCurrent,
    firstAudioDeltaMs: { count: 20, p95: 5101 },
  };

  const pass = compareSummaries({
    baseline,
    current: passingCurrent,
    baselinePath: "pre-vFinal-baseline-summary.json",
    currentPath: "current-vFinal-summary.json",
    minRuns: 20,
    counts: {},
  });
  const fail = compareSummaries({
    baseline,
    current: failingCurrent,
    baselinePath: "pre-vFinal-baseline-summary.json",
    currentPath: "current-vFinal-summary.json",
    minRuns: 20,
    counts: {},
  });
  const missingOperationalCounts = compareSummaries({
    baseline: { ...baseline, closeCode1006Count: undefined, relayErrorCount: undefined },
    current: { ...passingCurrent, closeCode1006Count: undefined, relayErrorCount: undefined },
    baselinePath: "pre-vFinal-baseline-summary.json",
    currentPath: "current-vFinal-summary.json",
    minRuns: 20,
    counts: {},
  });
  const weakDenominator = compareSummaries({
    baseline: { ...baseline, runCount: 19, sessionApiMs: { count: 19, p95: 300 } },
    current: passingCurrent,
    baselinePath: "pre-vFinal-baseline-summary.json",
    currentPath: "current-vFinal-summary.json",
    minRuns: 20,
    counts: {},
  });
  const sameArtifact = compareSummaries({
    baseline,
    current: passingCurrent,
    baselinePath: "pre-vFinal-baseline-summary.json",
    currentPath: "pre-vFinal-baseline-summary.json",
    minRuns: 20,
    counts: {},
  });
  const missingBaselineIdentity = compareSummaries({
    baseline,
    current: passingCurrent,
    baselinePath: "renamed-current-copy.json",
    currentPath: "current-vFinal-summary.json",
    minRuns: 20,
    counts: {},
  });
  const missingCurrentIdentity = compareSummaries({
    baseline,
    current: passingCurrent,
    baselinePath: "pre-vFinal-baseline-summary.json",
    currentPath: "renamed-baseline-copy.json",
    minRuns: 20,
    counts: {},
  });

  const failures = [];
  if (pass.status !== "PASS") failures.push("expected passing comparison to PASS");
  if (fail.status !== "FAIL") failures.push("expected threshold regression to FAIL");
  if (missingOperationalCounts.status !== "FAIL") {
    failures.push("expected missing closeCode1006/relay.error counts to FAIL");
  }
  if (weakDenominator.status !== "FAIL") failures.push("expected weak denominator to FAIL");
  if (sameArtifact.status !== "FAIL") failures.push("expected same artifact to FAIL");
  if (missingBaselineIdentity.status !== "FAIL") {
    failures.push("expected missing baseline identity marker to FAIL");
  }
  if (missingCurrentIdentity.status !== "FAIL") {
    failures.push("expected missing current identity marker to FAIL");
  }
  if (failures.length > 0) {
    await writeFile(
      join(dir, "debug.json"),
      JSON.stringify(
        {
          pass,
          fail,
          missingOperationalCounts,
          weakDenominator,
          sameArtifact,
          missingBaselineIdentity,
          missingCurrentIdentity,
        },
        null,
        2
      )
    );
    throw new Error(`vFinal latency comparison self-test failed: ${failures.join("; ")}`);
  }
  console.log("vFinal latency comparison self-test PASS");
}
