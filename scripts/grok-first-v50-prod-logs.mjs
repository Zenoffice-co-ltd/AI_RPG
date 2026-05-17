// Fetch and summarize Grok-first v50 production logs from Cloud Logging.
//
// Usage:
//   node scripts/grok-first-v50-prod-logs.mjs --minutes 30
//   node scripts/grok-first-v50-prod-logs.mjs --session gfv50_...
//   node scripts/grok-first-v50-prod-logs.mjs --from-smoke out/.../evidence.json
//   node scripts/grok-first-v50-prod-logs.mjs --input out/logs.json

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const project = stringArg(args.project, "adecco-mendan");
const minutes = numberArg(args.minutes, 30);
const limit = numberArg(args.limit, 1000);
const fromSmokeArg = stringArg(args["from-smoke"], "");
const smokeEvidence = fromSmokeArg ? JSON.parse(readFileSync(fromSmokeArg, "utf8")) : null;
const sessionArg = stringArg(args.session, smokeEvidence?.sessionId ?? "latest");
const expectMode = stringArg(
  args.expect,
  smokeEvidence?.mode === "session" ? "summary-only" : smokeEvidence?.mode ?? "summary-only"
);
const inputArg = stringArg(args.input, "");
const outRoot = stringArg(args.out, "");
const sinceArg = stringArg(args.since, "");
const since = sinceArg
  ? new Date(sinceArg)
  : smokeEvidence?.startedAt
    ? new Date(smokeEvidence.startedAt)
    : new Date(Date.now() - minutes * 60_000);

if (Number.isNaN(since.getTime())) {
  console.error(`Invalid --since value: ${sinceArg}`);
  process.exit(2);
}

const filter = [
  'resource.type="cloud_run_revision"',
  'resource.labels.service_name="adecco-roleplay"',
  'jsonPayload.scope="grokFirstV50"',
].join(" AND ");
const freshnessMinutes = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 60_000));
const entries = inputArg
  ? JSON.parse(readFileSync(inputArg, "utf8"))
  : readCloudLogs({ project, filter, limit, freshnessMinutes });

const payloadEntries = entries
  .map(toPayloadEntry)
  .filter((entry) => !entry.timestamp || new Date(entry.timestamp) >= since)
  .filter((entry) => entry.payload.scope === "grokFirstV50");
const sessions = summarizeSessions(payloadEntries);

if (sessions.length === 0) {
  console.error("[grok-first-v50-prod-logs] No grokFirstV50 log sessions found.");
  console.error(`[grok-first-v50-prod-logs] project=${project}`);
  console.error(`[grok-first-v50-prod-logs] since=${since.toISOString()}`);
  process.exit(1);
}

const selected =
  sessionArg === "latest"
    ? sessions.find((session) => session.turnCompleted > 0) ?? sessions[0]
    : sessions.find((session) => session.sessionId === sessionArg);

if (!selected) {
  console.error(`[grok-first-v50-prod-logs] Session not found: ${sessionArg}`);
  for (const session of sessions.slice(0, 20)) {
    console.error(
      `  - ${session.sessionId} ${session.firstTimestamp}..${session.lastTimestamp} turn.completed=${session.turnCompleted} stt=${session.sttCompleted}`
    );
  }
  process.exit(1);
}

const selectedEntries = payloadEntries
  .filter((entry) => entry.payload.sessionId === selected.sessionId)
  .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
const report = buildReport(selectedEntries);
const missingTurns = report.turns.filter((turn) => turn.sttCompleted && !turn.turnCompleted);
const expectation = evaluateExpectation(report, expectMode);
const stamp = compactTimestamp(new Date());
const outDir =
  outRoot ||
  resolve("out", "grok_first_v50_prod_logs", `${stamp}_${selected.sessionId}`);
mkdirSync(outDir, { recursive: true });

const summary = {
  generatedAt: new Date().toISOString(),
  project,
  filter,
  sessionId: selected.sessionId,
  selectedSession: selected,
  sessions,
  report,
  expectation: {
    mode: expectMode,
    pass: expectation.pass,
    reasons: expectation.reasons,
    missingTurnCompleted: missingTurns.length,
  },
};

writeFileSync(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(resolve(outDir, "events.json"), JSON.stringify(selectedEntries, null, 2) + "\n");
writeFileSync(resolve(outDir, "report.md"), renderMarkdown(summary));

console.log(`[grok-first-v50-prod-logs] ${expectation.pass ? "PASS" : "FAIL"}`);
console.log(`[grok-first-v50-prod-logs] sessionId: ${selected.sessionId}`);
console.log(`[grok-first-v50-prod-logs] expect: ${expectMode}`);
console.log(`[grok-first-v50-prod-logs] turns: ${report.turns.length}`);
console.log(`[grok-first-v50-prod-logs] missing turn.completed: ${missingTurns.length}`);
for (const reason of expectation.reasons) {
  console.log(`[grok-first-v50-prod-logs] ${reason}`);
}
console.log(`[grok-first-v50-prod-logs] out: ${outDir}`);
process.exitCode = expectation.pass ? 0 : 1;

function readCloudLogs({ project, filter, limit, freshnessMinutes }) {
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            [
              "gcloud",
              "logging",
              "read",
              psQuote(filter),
              `--project=${psQuote(project)}`,
              "--format=json",
              `--limit=${limit}`,
              `--freshness=${freshnessMinutes}m`,
              "--order=desc",
            ].join(" "),
          ],
          { encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 }
        )
      : spawnSync(
          "gcloud",
          [
            "logging",
            "read",
            filter,
            `--project=${project}`,
            "--format=json",
            `--limit=${limit}`,
            `--freshness=${freshnessMinutes}m`,
            "--order=desc",
          ],
          { encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 }
        );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || result.error?.message);
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout || "[]");
  } catch (error) {
    console.error("[grok-first-v50-prod-logs] Failed to parse gcloud JSON output.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function toPayloadEntry(entry) {
  const payload = entry.jsonPayload ?? parseJson(entry.textPayload) ?? {};
  return {
    timestamp: entry.timestamp ?? "",
    insertId: entry.insertId ?? "",
    resource: entry.resource ?? null,
    payload,
  };
}

function summarizeSessions(entries) {
  const bySession = new Map();
  for (const entry of entries) {
    const sessionId = typeof entry.payload.sessionId === "string" ? entry.payload.sessionId : null;
    if (!sessionId) continue;
    const details = entry.payload.details ?? {};
    const current =
      bySession.get(sessionId) ?? {
        sessionId,
        firstTimestamp: entry.timestamp,
        lastTimestamp: entry.timestamp,
        events: 0,
        sttCompleted: 0,
        turnCompleted: 0,
        fixedGuardCompleted: 0,
        guardDetected: 0,
        promptVersion: "",
        guardrailVersion: "",
        demoSlug: "",
        backend: "",
      };
    current.events += 1;
    current.firstTimestamp = minTimestamp(current.firstTimestamp, entry.timestamp);
    current.lastTimestamp = maxTimestamp(current.lastTimestamp, entry.timestamp);
    if (entry.payload.kind === "stt.completed") current.sttCompleted += 1;
    if (entry.payload.kind === "turn.completed") current.turnCompleted += 1;
    if (entry.payload.kind === "fixed_guard.playback.completed") current.fixedGuardCompleted += 1;
    if (entry.payload.kind === "guard.detected") current.guardDetected += 1;
    current.promptVersion ||= stringOr(details.promptVersion, "");
    current.guardrailVersion ||= stringOr(details.guardrailVersion, "");
    current.demoSlug ||= stringOr(details.demoSlug, "");
    current.backend ||= stringOr(details.backend, "");
    bySession.set(sessionId, current);
  }
  return [...bySession.values()].sort((a, b) =>
    String(b.lastTimestamp).localeCompare(String(a.lastTimestamp))
  );
}

function buildReport(entries) {
  const turns = new Map();
  const eventCounts = {};
  const timeline = [];
  for (const entry of entries) {
    const payload = entry.payload;
    const kind = payload.kind ?? "unknown";
    const details = payload.details ?? {};
    const turnIndex = numberOr(details.turnIndex, null);
    eventCounts[kind] = (eventCounts[kind] ?? 0) + 1;
    timeline.push({ timestamp: entry.timestamp, kind, turnIndex });
    if (turnIndex === null) continue;
    const turn = ensureTurn(turns, turnIndex);
    turn.events.push({ timestamp: entry.timestamp, kind, details });
    if (kind === "stt.completed") {
      turn.sttCompleted = true;
      turn.textLen = numberOr(details.textLen, turn.textLen);
      turn.guardAction ||= stringOr(details.guardAction, "");
    }
    if (kind === "guard.detected") {
      turn.guardDetected = true;
      turn.guardAction ||= stringOr(details.action, "");
      turn.guardReasons = Array.isArray(details.reasons) ? details.reasons : turn.guardReasons;
    }
    if (kind === "fixed_guard.playback.started") turn.fixedPlaybackStarted = true;
    if (kind === "fixed_guard.playback.completed") turn.fixedPlaybackCompleted = true;
    if (kind === "turn.completed") {
      turn.turnCompleted = true;
      turn.routePath = stringOr(details.routePath, "");
      turn.guardAction = stringOr(details.guardAction, turn.guardAction);
      turn.firstAudioDeltaMs = numberOr(details.firstAudioDeltaMs, null);
      turn.firstAudibleAudioMs = numberOr(details.firstAudibleAudioMs, null);
      turn.doneMs = numberOr(details.doneMs, null);
      turn.audioBytes = numberOr(details.audioBytes, null);
      turn.error = details.error ?? null;
      turn.fullTurnBufferCount = numberOr(details.fullTurnBufferCount, null);
      turn.tailAudioDroppedBytes = numberOr(details.tailAudioDroppedBytes, null);
      turn.runtimeGuardrailsEnabled = details.runtimeGuardrailsEnabled ?? null;
      turn.promptVersion = stringOr(details.promptVersion, "");
      turn.guardrailVersion = stringOr(details.guardrailVersion, "");
    }
  }
  return {
    eventCounts,
    turns: [...turns.values()].sort((a, b) => a.turnIndex - b.turnIndex),
    timeline,
  };
}

function ensureTurn(turns, turnIndex) {
  const existing = turns.get(turnIndex);
  if (existing) return existing;
  const next = {
    turnIndex,
    events: [],
    sttCompleted: false,
    turnCompleted: false,
    guardDetected: false,
    fixedPlaybackStarted: false,
    fixedPlaybackCompleted: false,
    textLen: null,
    routePath: "",
    guardAction: "",
    guardReasons: [],
    firstAudioDeltaMs: null,
    firstAudibleAudioMs: null,
    doneMs: null,
    audioBytes: null,
    error: null,
    fullTurnBufferCount: null,
    tailAudioDroppedBytes: null,
    runtimeGuardrailsEnabled: null,
    promptVersion: "",
    guardrailVersion: "",
  };
  turns.set(turnIndex, next);
  return next;
}

function evaluateExpectation(report, mode) {
  const reasons = [];
  if (mode === "summary-only") return { pass: true, reasons };
  if (mode === "start") {
    for (const required of ["session.created", "ws.connected", "session.ready"]) {
      if (!report.eventCounts[required]) reasons.push(`missing ${required}`);
    }
    return { pass: reasons.length === 0, reasons };
  }
  if (mode === "voice-turn") {
    const completed = report.turns.filter((turn) => turn.turnCompleted);
    if (!report.eventCounts["stt.completed"]) reasons.push("missing stt.completed");
    if (completed.length === 0) reasons.push("missing turn.completed");
    if (
      !completed.some(
        (turn) => turn.audioBytes > 0 && turn.error === null
      )
    ) {
      reasons.push("missing successful audible turn");
    }
    return { pass: reasons.length === 0, reasons };
  }
  if (mode === "fixed-guard") {
    for (const required of [
      "guard.detected",
      "fixed_guard.playback.started",
      "fixed_guard.playback.completed",
      "turn.completed",
    ]) {
      if (!report.eventCounts[required]) reasons.push(`missing ${required}`);
    }
    if (!report.turns.some((turn) => turn.routePath === "fixed_guard")) {
      reasons.push("missing fixed_guard routePath");
    }
    return { pass: reasons.length === 0, reasons };
  }
  return {
    pass: false,
    reasons: [`unsupported --expect ${mode}`],
  };
}

function renderMarkdown(summary) {
  const lines = [];
  lines.push("# Grok-first v50 Production Logs");
  lines.push("");
  lines.push(`- Generated: ${summary.generatedAt}`);
  lines.push(`- Session: ${summary.sessionId}`);
  lines.push(`- Events: ${summary.selectedSession.events}`);
  lines.push(`- STT completed: ${summary.selectedSession.sttCompleted}`);
  lines.push(`- Turn completed: ${summary.selectedSession.turnCompleted}`);
  lines.push(`- Fixed guard completed: ${summary.selectedSession.fixedGuardCompleted}`);
  lines.push(`- Expectation: ${summary.expectation.mode}`);
  lines.push(`- Pass: ${summary.expectation.pass ? "yes" : "no"}`);
  if (summary.expectation.reasons.length > 0) {
    lines.push(`- Reasons: ${summary.expectation.reasons.join(", ")}`);
  }
  lines.push("");
  lines.push("## Turns");
  lines.push("");
  lines.push("| Turn | STT | Completed | Route | Guard | First audible | Done | Audio bytes | Error |");
  lines.push("|---:|---|---|---|---|---:|---:|---:|---|");
  for (const turn of summary.report.turns) {
    lines.push(
      `| ${turn.turnIndex} | ${yesNo(turn.sttCompleted)} | ${yesNo(turn.turnCompleted)} | ${turn.routePath || "-"} | ${turn.guardAction || "-"} | ${fmt(turn.firstAudibleAudioMs)} | ${fmt(turn.doneMs)} | ${fmt(turn.audioBytes)} | ${turn.error ?? ""} |`
    );
  }
  lines.push("");
  lines.push("## Event Counts");
  lines.push("");
  for (const [kind, count] of Object.entries(summary.report.eventCounts).sort()) {
    lines.push(`- \`${kind}\`: ${count}`);
  }
  return `${lines.join("\n")}\n`;
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

function parseJson(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArg(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function minTimestamp(a, b) {
  if (!a) return b;
  if (!b) return a;
  return String(a) <= String(b) ? a : b;
}

function maxTimestamp(a, b) {
  if (!a) return b;
  if (!b) return a;
  return String(a) >= String(b) ? a : b;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function fmt(value) {
  return value === null || value === undefined || value === "" ? "" : String(value);
}
