#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const expected = valueArg("expect") ?? "blocked";
const project = valueArg("project") ?? "adecco-mendan";
const freshness = valueArg("freshness") ?? "7d";
const limit = numberArg("limit", 1000);
const failures = [];

if (hasFlag("self-test")) {
  runSelfTest();
  process.exit(0);
}

if (!["blocked", "pass"].includes(expected)) {
  failures.push(`invalid --expect value: ${expected}; use blocked or pass`);
}

const result = inspectCloudLogs({ project, freshness, limit });
if (!result.ok) {
  failures.push(...result.failures);
}

const report = result.ok
  ? result.report
  : {
      project,
      freshness,
      limit,
      vFinalTurnLog: null,
      vFinalRelayLog: null,
      comparisonReadyPreVFinalBaselineCandidateCount: 0,
    };

if (expected === "blocked" && report.comparisonReadyPreVFinalBaselineCandidateCount > 0) {
  failures.push("expected BLOCKED but found a comparison-ready pre-vFinal baseline candidate");
}

if (expected === "pass" && report.comparisonReadyPreVFinalBaselineCandidateCount === 0) {
  failures.push("expected PASS but found no comparison-ready pre-vFinal baseline candidate");
}

console.log(
  JSON.stringify(
    {
      status: failures.length === 0 ? "PASS" : "FAIL",
      expected,
      ...report,
      failures,
    },
    null,
    2
  )
);

if (failures.length > 0) {
  process.exitCode = 1;
}

function inspectCloudLogs({ project, freshness, limit }) {
  const turnFilter = 'jsonPayload.scope="grokFirstVFinal" AND jsonPayload.kind="turn.completed"';
  const relayFilter =
    'jsonPayload.scope="grokVoice.realtimeRelay" AND jsonPayload.backend="grok-first-vFinal" AND (jsonPayload.phase="client.closed" OR jsonPayload.phase="relay.error")';

  const turnRead = readLogs({ filter: turnFilter, project, freshness, limit });
  const relayRead = readLogs({ filter: relayFilter, project, freshness, limit });
  const readFailures = [turnRead, relayRead]
    .filter((item) => !item.ok)
    .map((item) => item.error);
  if (readFailures.length > 0) {
    return {
      ok: false,
      failures: readFailures,
    };
  }

  const turnLog = summarizeVFinalTurns(turnRead.entries);
  const relayLog = summarizeRelay(relayRead.entries);
  return {
    ok: true,
    report: {
      note:
        "Read-only Cloud Logging inventory. Raw log JSON is not printed or persisted. This cannot satisfy #140 PASS by itself because Cloud Logging turn metadata lacks sessionApiMs and all observed grokFirstVFinal entries are current-vFinal service logs.",
      project,
      freshness,
      limit,
      officialDocsRechecked: [
        "https://cloud.google.com/sdk/gcloud/reference/logging/read",
        "https://cloud.google.com/logging/docs/view/logging-query-language",
      ],
      queries: {
        vFinalTurnCompleted: turnFilter,
        vFinalRelayCounters: relayFilter,
      },
      vFinalTurnLog: turnLog,
      vFinalRelayLog: relayLog,
      comparisonReadyPreVFinalBaselineCandidateCount: 0,
      blockedReasons: [
        "Cloud Logging turn.completed entries do not include sessionApiMs.",
        "Observed grokFirstVFinal entries are emitted by the current dedicated adecco-roleplay-vfinal service, not explicit pre-vFinal baseline evidence.",
        "The strict #140 gate still requires an approved >=20-session pre-vFinal summary and the reusable latency comparator PASS.",
      ],
    },
  };
}

function readLogs({ filter, project, freshness, limit }) {
  const args = [
    "logging",
    "read",
    filter,
    `--project=${project}`,
    `--freshness=${freshness}`,
    `--limit=${limit}`,
    "--format=json",
  ];
  const result = runGcloud(args);
  if (!result.ok) return result;
  try {
    return {
      ok: true,
      entries: JSON.parse(result.stdout || "[]"),
    };
  } catch (error) {
    return {
      ok: false,
      error: `failed to parse gcloud logging output: ${messageOf(error)}`,
    };
  }
}

function summarizeVFinalTurns(entries) {
  const details = entries.map((entry) => entry?.jsonPayload?.details ?? {});
  const firstAudioDeltaValues = details
    .map((detail) => numberOrNull(detail.firstAudioDeltaMs))
    .filter(isNumber);
  const firstAudibleValues = details
    .map((detail) => numberOrNull(detail.firstAudibleAudioMs))
    .filter(isNumber);
  const sessionHashes = new Set(
    entries.map((entry) => entry?.jsonPayload?.sessionIdHash).filter((value) => value)
  );
  return {
    entryCount: entries.length,
    uniqueSessionHashCount: sessionHashes.size,
    firstTimestamp: minTimestamp(entries),
    lastTimestamp: maxTimestamp(entries),
    serviceNames: countedValues(entries, (entry) => entry?.resource?.labels?.service_name),
    revisionNames: countedValues(entries, (entry) => entry?.resource?.labels?.revision_name),
    promptVersions: countedValues(entries, (entry) => entry?.jsonPayload?.details?.promptVersion),
    guardrailVersions: countedValues(
      entries,
      (entry) => entry?.jsonPayload?.details?.guardrailVersion
    ),
    models: countedValues(entries, (entry) => entry?.jsonPayload?.details?.model),
    sessionApiMsAvailable: false,
    firstAudioDeltaMs: percentileSummary(firstAudioDeltaValues),
    firstAudibleAudioMs: percentileSummary(firstAudibleValues),
  };
}

function summarizeRelay(entries) {
  const relayErrors = entries.filter((entry) => entry?.jsonPayload?.phase === "relay.error");
  const closeCode1006 = entries.filter(
    (entry) => entry?.jsonPayload?.phase === "client.closed" && entry?.jsonPayload?.closeCode === 1006
  );
  return {
    entryCount: entries.length,
    firstTimestamp: minTimestamp(entries),
    lastTimestamp: maxTimestamp(entries),
    closeCode1006Count: closeCode1006.length,
    relayErrorCount: relayErrors.length,
    phases: countedValues(entries, (entry) => entry?.jsonPayload?.phase),
    serviceNames: countedValues(entries, (entry) => entry?.resource?.labels?.service_name),
  };
}

function runGcloud(args) {
  for (const command of gcloudCommands()) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 24,
    });
    if (result.status === 0) {
      return {
        ok: true,
        stdout: result.stdout.trim(),
      };
    }
    if (result.error?.code && !["ENOENT", "EINVAL"].includes(result.error.code)) {
      return {
        ok: false,
        error: sanitizeGcloudError(result.stderr || result.error.message || `${command} failed`),
      };
    }
  }
  const psResult = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      ["gcloud", ...args.map(psQuote)].join(" "),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 24,
    }
  );
  if (psResult.status === 0) {
    return {
      ok: true,
      stdout: psResult.stdout.trim(),
    };
  }
  return {
    ok: false,
    error: sanitizeGcloudError(psResult.stderr || psResult.error?.message || "gcloud not available"),
  };
}

function gcloudCommands() {
  return process.platform === "win32" ? ["gcloud.cmd", "gcloud"] : ["gcloud"];
}

function psQuote(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function sanitizeGcloudError(value) {
  return String(value)
    .split(/\r?\n/u)
    .filter((line) => !/token|secret|credential|authorization/iu.test(line))
    .join("\n")
    .trim();
}

function countedValues(entries, getter) {
  const counts = new Map();
  for (const entry of entries) {
    const value = getter(entry);
    if (typeof value !== "string" || value.length === 0) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
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

function minTimestamp(entries) {
  return timestampExtreme(entries, (a, b) => (a < b ? a : b));
}

function maxTimestamp(entries) {
  return timestampExtreme(entries, (a, b) => (a > b ? a : b));
}

function timestampExtreme(entries, choose) {
  let selected = null;
  for (const entry of entries) {
    const value = entry?.timestamp ?? entry?.jsonPayload?.timestamp ?? null;
    if (typeof value !== "string") continue;
    selected = selected === null ? value : choose(selected, value);
  }
  return selected;
}

function numberOrNull(value) {
  return isNumber(value) ? value : null;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function valueArg(name) {
  const prefix = `--${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}` && process.argv[index + 1]) return process.argv[index + 1];
  }
  return null;
}

function numberArg(name, fallback) {
  const value = valueArg(name);
  if (value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`--${name} must be a number`);
  return number;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function runSelfTest() {
  const report = {
    vFinalTurnLog: summarizeVFinalTurns([
      fixtureTurn({ firstAudioDeltaMs: 5100, firstAudibleAudioMs: 5300, sessionIdHash: "a" }),
      fixtureTurn({ firstAudioDeltaMs: 5200, firstAudibleAudioMs: 5400, sessionIdHash: "b" }),
    ]),
    vFinalRelayLog: summarizeRelay([
      fixtureRelay({ phase: "client.closed", closeCode: 1000 }),
      fixtureRelay({ phase: "client.closed", closeCode: 1006 }),
      fixtureRelay({ phase: "relay.error" }),
    ]),
  };
  if (report.vFinalTurnLog.firstAudioDeltaMs.p95 !== 5200) {
    throw new Error("turn percentile self-test failed");
  }
  if (report.vFinalTurnLog.uniqueSessionHashCount !== 2) {
    throw new Error("session hash self-test failed");
  }
  if (report.vFinalRelayLog.closeCode1006Count !== 1) {
    throw new Error("closeCode1006 self-test failed");
  }
  if (report.vFinalRelayLog.relayErrorCount !== 1) {
    throw new Error("relay.error self-test failed");
  }
  console.log("vFinal Cloud Logging latency inventory self-test PASS");
}

function fixtureTurn({ firstAudioDeltaMs, firstAudibleAudioMs, sessionIdHash }) {
  return {
    timestamp: "2026-05-16T00:00:00Z",
    jsonPayload: {
      scope: "grokFirstVFinal",
      kind: "turn.completed",
      sessionIdHash,
      details: {
        firstAudioDeltaMs,
        firstAudibleAudioMs,
        promptVersion: "grok-first-v50.6-2026-05-15",
        guardrailVersion: "grok-first-vfinal-guard-2026-05-16",
        model: "grok-voice-think-fast-1.0",
      },
    },
    resource: {
      labels: {
        service_name: "adecco-roleplay-vfinal",
        revision_name: "adecco-roleplay-vfinal-build-2026-05-16-005",
      },
    },
  };
}

function fixtureRelay({ phase, closeCode }) {
  return {
    timestamp: "2026-05-16T00:00:00Z",
    jsonPayload: {
      scope: "grokVoice.realtimeRelay",
      phase,
      closeCode,
    },
    resource: {
      labels: {
        service_name: "xai-realtime-relay",
      },
    },
  };
}
