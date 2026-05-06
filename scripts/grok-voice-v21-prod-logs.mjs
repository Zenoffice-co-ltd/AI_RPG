// Fetch and reconstruct recent Grok Voice v2.1 production demo transcripts
// from Cloud Logging structured logs.
//
// Usage:
//   node scripts/grok-voice-v21-prod-logs.mjs
//   node scripts/grok-voice-v21-prod-logs.mjs --minutes 10
//   node scripts/grok-voice-v21-prod-logs.mjs --session gv_sess_...
//   node scripts/grok-voice-v21-prod-logs.mjs --input fixtures/cloud-logs.json

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_PROJECT = "adecco-mendan";
const DEFAULT_MINUTES = 30;
const DEFAULT_LIMIT = 1000;
const VOICE_PROFILE = resolve(
  "config",
  "voice-profiles",
  "staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2.json"
);

const args = parseArgs(process.argv.slice(2));
const project = stringArg(args.project, DEFAULT_PROJECT);
const minutes = numberArg(args.minutes, DEFAULT_MINUTES);
const limit = numberArg(args.limit, DEFAULT_LIMIT);
const sessionArg = stringArg(args.session, "latest");
const outRoot = stringArg(args.out, "");
const sinceArg = stringArg(args.since, "");
const inputArg = stringArg(args.input, "");
const since = sinceArg ? new Date(sinceArg) : new Date(Date.now() - minutes * 60_000);

if (Number.isNaN(since.getTime())) {
  console.error(`Invalid --since value: ${sinceArg}`);
  process.exit(2);
}

const filter = [
  "resource.type=cloud_run_revision",
  "resource.labels.service_name=adecco-roleplay",
  "jsonPayload.scope:grokVoice",
].join(" AND ");

const freshnessMinutes = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 60_000));
const entries = inputArg
  ? JSON.parse(readFileSync(inputArg, "utf8"))
  : readCloudLogs({ project, filter, limit, freshnessMinutes });
const payloadEntries = entries
  .map(toPayloadEntry)
  .filter((entry) => !entry.timestamp || new Date(entry.timestamp) >= since)
  .filter((entry) => entry.payload.scope?.startsWith("grokVoice."));

const sessions = summarizeSessions(payloadEntries);
if (sessions.length === 0) {
  console.error("[grok-voice-prod-logs] No Grok Voice log sessions found.");
  console.error(`[grok-voice-prod-logs] project=${project}`);
  console.error(`[grok-voice-prod-logs] since=${since.toISOString()}`);
  process.exit(1);
}

const selected =
  sessionArg === "latest"
    ? sessions.find((session) => session.turns > 0) ?? sessions[0]
    : sessions.find((session) => session.sessionId === sessionArg);

if (!selected) {
  console.error(`[grok-voice-prod-logs] Session not found: ${sessionArg}`);
  console.error("[grok-voice-prod-logs] Available sessions:");
  for (const session of sessions.slice(0, 20)) {
    console.error(
      `  - ${session.sessionId} ${session.firstTimestamp}..${session.lastTimestamp} turns=${session.turns}`
    );
  }
  process.exit(1);
}

const selectedEntries = payloadEntries
  .filter((entry) => entry.payload.sessionId === selected.sessionId)
  .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
const transcript = buildTranscript(selectedEntries);
const textAvailable = transcript.turns.some((turn) => turn.user || turn.agent);
const stamp = compactTimestamp(new Date());
const outDir =
  outRoot ||
  resolve("out", "grok_voice_v21_prod_logs", `${stamp}_${selected.sessionId}`);
mkdirSync(outDir, { recursive: true });

const summary = {
  generatedAt: new Date().toISOString(),
  project,
  filter,
  sessionId: selected.sessionId,
  selectedSession: selected,
  sessions,
  textAvailable,
  transcriptTextSource: transcript.textSource,
  notes: textAvailable
    ? transcript.textSource === "utf8_base64"
      ? [
          "Transcript text was decoded from UTF-8 Base64 structured-log fields to avoid Cloud Logging Unicode display loss.",
        ]
      : []
    : [
        "Transcript text was not present in a recoverable form. Ensure GROK_VOICE_DEBUG_TRANSCRIPT_PREVIEW_ENABLED=true is deployed and the UTF-8 Base64 preview fields are present before the demo run.",
      ],
};

writeFileSync(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(resolve(outDir, "events.json"), JSON.stringify(selectedEntries, null, 2) + "\n");
writeFileSync(resolve(outDir, "transcript.md"), renderTranscriptMarkdown(transcript, summary));

console.log("[grok-voice-prod-logs] PASS");
console.log(`[grok-voice-prod-logs] sessionId: ${selected.sessionId}`);
console.log(`[grok-voice-prod-logs] transcript text: ${textAvailable ? "available" : "missing"}`);
console.log(`[grok-voice-prod-logs] out: ${outDir}`);

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
          {
            encoding: "utf8",
            shell: false,
            maxBuffer: 64 * 1024 * 1024,
          }
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
          {
            encoding: "utf8",
            shell: false,
            maxBuffer: 64 * 1024 * 1024,
          }
        );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || result.error?.message);
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout || "[]");
  } catch (error) {
    console.error("[grok-voice-prod-logs] Failed to parse gcloud JSON output.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function toPayloadEntry(entry) {
  const payload = entry.jsonPayload ?? parseTextPayload(entry.textPayload);
  return {
    timestamp: entry.timestamp ?? "",
    insertId: entry.insertId ?? "",
    logName: entry.logName ?? "",
    resource: entry.resource ?? null,
    payload,
  };
}

function parseTextPayload(value) {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function summarizeSessions(entries) {
  const bySession = new Map();
  for (const entry of entries) {
    const sessionId = typeof entry.payload.sessionId === "string" ? entry.payload.sessionId : null;
    if (!sessionId) continue;
    const current =
      bySession.get(sessionId) ??
      {
        sessionId,
        firstTimestamp: entry.timestamp,
        lastTimestamp: entry.timestamp,
        events: 0,
        turns: 0,
        stt: 0,
        promptVersion: "",
        guardrailVersion: "",
      };
    current.events += 1;
    current.firstTimestamp = minTimestamp(current.firstTimestamp, entry.timestamp);
    current.lastTimestamp = maxTimestamp(current.lastTimestamp, entry.timestamp);
    if (entry.payload.scope === "grokVoice.turnMetrics") current.turns += 1;
    if (entry.payload.scope === "grokVoice.stt") current.stt += 1;
    current.promptVersion ||= stringOr(entry.payload.promptVersion, "");
    current.guardrailVersion ||= stringOr(entry.payload.guardrailVersion, "");
    bySession.set(sessionId, current);
  }
  return [...bySession.values()].sort((a, b) =>
    String(b.lastTimestamp).localeCompare(String(a.lastTimestamp))
  );
}

function buildTranscript(entries) {
  const turns = new Map();
  const timeline = [];
  let decodedPreviewCount = 0;
  let rawPreviewCount = 0;
  for (const entry of entries) {
    const payload = entry.payload;
    timeline.push({
      timestamp: entry.timestamp,
      scope: payload.scope,
      kind: payload.kind ?? null,
      turnIndex: payload.turnIndex ?? payload.details?.turnIndex ?? null,
    });
    if (payload.scope === "grokVoice.stt") {
      const turnIndex = numberOr(payload.turnIndex, null);
      if (turnIndex !== null) {
        const turn = ensureTurn(turns, turnIndex);
        const preview = readTranscriptPreview(payload, "sttTextPreview");
        decodedPreviewCount += preview.source === "utf8_base64" ? 1 : 0;
        rawPreviewCount += preview.source === "raw" ? 1 : 0;
        turn.user ||= preview.text;
        turn.userTimestamp ||= entry.timestamp;
      }
    }
    if (payload.scope === "grokVoice.turnMetrics") {
      const turnIndex = numberOr(payload.turnIndex, null);
      if (turnIndex !== null) {
        const turn = ensureTurn(turns, turnIndex);
        const userPreview = readTranscriptPreview(payload, "userTextPreview");
        const agentPreview = readTranscriptPreview(payload, "agentTextPreview");
        const agentSpokenPreview = readTranscriptPreview(
          payload,
          "agentSpokenTextPreview"
        );
        decodedPreviewCount +=
          (userPreview.source === "utf8_base64" ? 1 : 0) +
          (agentPreview.source === "utf8_base64" ? 1 : 0) +
          (agentSpokenPreview.source === "utf8_base64" ? 1 : 0);
        rawPreviewCount +=
          (userPreview.source === "raw" ? 1 : 0) +
          (agentPreview.source === "raw" ? 1 : 0) +
          (agentSpokenPreview.source === "raw" ? 1 : 0);
        turn.user ||= userPreview.text;
        turn.agent ||= agentPreview.text;
        turn.agentSpoken ||= agentSpokenPreview.text;
        turn.agentTimestamp ||= entry.timestamp;
        turn.metrics = {
          firstAudioMs: payload.firstAudioMs ?? null,
          doneMs: payload.doneMs ?? null,
          audioBytes: payload.audioBytes ?? null,
          error: payload.error ?? null,
        };
      }
    }
  }

  return {
    firstMessage: readFirstMessage(),
    turns: [...turns.values()].sort((a, b) => a.turnIndex - b.turnIndex),
    timeline,
    textSource:
      decodedPreviewCount > 0
        ? "utf8_base64"
        : rawPreviewCount > 0
          ? "raw"
          : "missing",
  };
}

function readTranscriptPreview(payload, rawKey) {
  const decoded = decodeUtf8Base64Preview(payload[`${rawKey}Utf8Base64`]);
  if (decoded) return { text: decoded, source: "utf8_base64" };
  const raw = stringOr(payload[rawKey], "");
  if (raw && !isQuestionMarkPlaceholder(raw)) {
    return { text: raw, source: "raw" };
  }
  return { text: "", source: "missing" };
}

function decodeUtf8Base64Preview(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded || isQuestionMarkPlaceholder(decoded)) return "";
    return decoded;
  } catch {
    return "";
  }
}

function isQuestionMarkPlaceholder(value) {
  const compact = String(value).replace(/\s+/g, "");
  return compact.length > 0 && /^\?+$/.test(compact);
}

function ensureTurn(turns, turnIndex) {
  const existing = turns.get(turnIndex);
  if (existing) return existing;
  const next = {
    turnIndex,
    user: "",
    agent: "",
    agentSpoken: "",
    userTimestamp: "",
    agentTimestamp: "",
    metrics: null,
  };
  turns.set(turnIndex, next);
  return next;
}

function readFirstMessage() {
  try {
    const voiceProfile = JSON.parse(readFileSync(VOICE_PROFILE, "utf8"));
    return typeof voiceProfile.firstMessageJa === "string"
      ? voiceProfile.firstMessageJa
      : "";
  } catch {
    return "";
  }
}

function renderTranscriptMarkdown(transcript, summary) {
  const lines = [
    "# Grok Voice v2.1 Production Transcript",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- project: ${summary.project}`,
    `- sessionId: ${summary.sessionId}`,
    `- firstTimestamp: ${summary.selectedSession.firstTimestamp}`,
    `- lastTimestamp: ${summary.selectedSession.lastTimestamp}`,
    `- textAvailable: ${summary.textAvailable}`,
    `- transcriptTextSource: ${summary.transcriptTextSource}`,
    "",
  ];
  if (!summary.textAvailable) {
    lines.push(
      "> Transcript text was not present in these logs. Deploy with transcript preview logging enabled, then rerun this script.",
      ""
    );
  }
  if (transcript.firstMessage) {
    lines.push("## Opening", "", `Agent: ${transcript.firstMessage}`, "");
  }
  lines.push("## Turns", "");
  for (const turn of transcript.turns) {
    lines.push(`### Turn ${turn.turnIndex}`, "");
    lines.push(`User: ${turn.user || "(text not logged)"}`, "");
    lines.push(`Agent: ${turn.agent || "(text not logged)"}`, "");
    if (turn.agentSpoken && turn.agentSpoken !== turn.agent) {
      lines.push(`Agent spoken: ${turn.agentSpoken}`, "");
    }
  }
  lines.push("## Timeline", "");
  for (const event of transcript.timeline) {
    const turn = event.turnIndex === null ? "" : ` turn=${event.turnIndex}`;
    const kind = event.kind ? ` kind=${event.kind}` : "";
    lines.push(`- ${event.timestamp} ${event.scope}${kind}${turn}`);
  }
  return lines.join("\n") + "\n";
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function stringArg(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberArg(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function minTimestamp(a, b) {
  return String(a).localeCompare(String(b)) <= 0 ? a : b;
}

function maxTimestamp(a, b) {
  return String(a).localeCompare(String(b)) >= 0 ? a : b;
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
