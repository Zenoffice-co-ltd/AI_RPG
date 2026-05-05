/**
 * Grok Voice v2.1 scenario-accuracy E2E harness.
 *
 * DOD: validate that the live xAI Grok Voice realtime model — given the
 * exact instructions our v3 session route compiles for the v2.1 housing-
 * equipment-manufacturer scenario — replies in line with the eight cases
 * Adecco signed off on. UI and scoring are intentionally OUT of scope.
 *
 * Each case opens a fresh WebSocket session, sends `session.update` with
 * the v2.1 instructions, posts the user line as `input_text`, waits for
 * `response.done`, and runs pass-conditions on the assistant transcript.
 *
 * Evidence (summary.json + transcript.md) is written to
 *   out/grok_voice_v21_e2e/<utc-iso-compact>/
 *
 * Usage:
 *   pnpm exec tsx scripts/grok-voice-v21-scenario-e2e.ts \
 *     [--rounds 2] [--critical-rounds 3] [--limit 8] [--cases 1,3,4,5,7]
 *
 * Required env:
 *   XAI_API_KEY    — server-side key. Loaded from apps/web/.env.local if not
 *                    already set in the shell.
 *
 * Optional env:
 *   GROK_VOICE_MODEL                          (default grok-voice-think-fast-1.0)
 *   GROK_VOICE_VOICE_ID                       (default rex)
 *   GROK_VOICE_TURN_DETECTION_THRESHOLD       (default 0.72 — max_speed)
 *   GROK_VOICE_TURN_DETECTION_SILENCE_MS      (default 650)
 *   GROK_VOICE_TURN_DETECTION_PREFIX_PADDING_MS (default 333)
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { WebSocket as WsClient } from "ws";
import { buildLivePronunciationGuide } from "../packages/scenario-engine/src/tts/livePronunciationGuide";
import {
  GROK_VOICE_RUNTIME_GUARDRAIL,
  buildGrokVoiceSystemPrompt,
} from "../apps/web/server/grokVoice/promptBuilder";
import type { GrokVoiceScenarioBundle } from "../apps/web/server/grokVoice/scenarioLoader";
import { createHash } from "node:crypto";
import { CASES, type CaseDef } from "./grok-voice-v21-e2e-cases";

// ---------------- Args & env ----------------

function getArg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.findIndex((v) => v === flag);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const ROUNDS = Number(getArg("--rounds", "2"));
const CRITICAL_ROUNDS = Number(getArg("--critical-rounds", "3"));
const LIMIT = getArg("--limit") ? Number(getArg("--limit")) : Number.POSITIVE_INFINITY;
const ONLY_CASES = (getArg("--cases") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENARIO_ID =
  "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21";
const SCENARIOS_DIR = resolve(REPO_ROOT, "data/generated/scenarios");
const VOICE_PROFILE_PATH = resolve(
  REPO_ROOT,
  "config/voice-profiles/staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2.json"
);

// Env values are resolved inside main() after loadDotEnvLocalIfPresent().
let XAI_API_KEY = "";
let MODEL = "grok-voice-think-fast-1.0";
let VOICE = "rex";
let VAD = { threshold: 0.72, silence_duration_ms: 650, prefix_padding_ms: 333 };

// (env values resolved in main)

// ---------------- Bundle + instructions ----------------

async function loadBundle(): Promise<GrokVoiceScenarioBundle> {
  const assetsRaw = await readFile(
    resolve(SCENARIOS_DIR, `${SCENARIO_ID}.assets.json`),
    "utf8"
  );
  const voiceProfileRaw = await readFile(VOICE_PROFILE_PATH, "utf8");
  const assets = JSON.parse(assetsRaw) as {
    scenarioId: string;
    promptVersion: string;
    agentSystemPrompt: string;
    knowledgeBaseText: string;
    promptSections?: unknown;
  };
  const voiceProfile = JSON.parse(voiceProfileRaw) as { firstMessageJa: string };
  const pronunciationGuide = await buildLivePronunciationGuide({
    scenarioId: assets.scenarioId,
    textNormalisationType: "system_prompt",
    referenceTexts: [assets.agentSystemPrompt, assets.knowledgeBaseText],
    // Match production scenarioLoader.ts cap (v2.1 quality patch).
    maxEntries: 80,
  });
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  return {
    scenarioId: assets.scenarioId,
    promptVersion: assets.promptVersion,
    agentSystemPrompt: assets.agentSystemPrompt,
    knowledgeBaseText: assets.knowledgeBaseText,
    firstMessage: voiceProfile.firstMessageJa,
    pronunciationGuide,
    agentSystemPromptHash: sha(assets.agentSystemPrompt),
    knowledgeBaseTextHash: sha(assets.knowledgeBaseText),
    promptSectionsHash: sha(JSON.stringify(assets.promptSections ?? null)),
  };
}

// ---------------- WebSocket round ----------------

type TurnTranscript = { user: string; assistant: string };
type RunOutcome = {
  caseId: string;
  round: number;
  transcripts: TurnTranscript[];
  totalMs: number;
  errorCode: string;
  errorMessage: string;
  pass: boolean;
  failures: string[];
};

async function runOneRound(
  caseDef: CaseDef,
  round: number,
  instructions: string
): Promise<RunOutcome> {
  const transcripts: TurnTranscript[] = caseDef.turns.map((t) => ({
    user: t.text,
    assistant: "",
  }));
  const outcome: RunOutcome = {
    caseId: caseDef.id,
    round,
    transcripts,
    totalMs: 0,
    errorCode: "",
    errorMessage: "",
    pass: false,
    failures: [],
  };
  const startedAt = Date.now();

  return new Promise<RunOutcome>((resolveOuter) => {
    const ws = new WsClient(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(MODEL)}`,
      { headers: { Authorization: `Bearer ${XAI_API_KEY}` } }
    );
    let turnIdx = 0;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    const finish = (reason: string) => {
      if (resolved) return;
      resolved = true;
      if (watchdog) clearTimeout(watchdog);
      try {
        ws.close();
      } catch {
        // ignore
      }
      outcome.totalMs = Date.now() - startedAt;
      if (
        !outcome.errorCode &&
        transcripts.some((t) => t.assistant.length === 0)
      ) {
        outcome.errorCode = "EMPTY_RESPONSE";
        outcome.errorMessage = `${reason}: at least one assistant turn empty`;
      }
      resolveOuter(outcome);
    };
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => finish("watchdog"), 60_000);
    };

    const sendNextUser = () => {
      if (turnIdx >= caseDef.turns.length) return;
      const turn = caseDef.turns[turnIdx]!;
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: turn.text }],
          },
        })
      );
      ws.send(JSON.stringify({ type: "response.create" }));
      armWatchdog();
    };

    ws.on("open", () => {
      // The xAI realtime endpoint accepts the older "modalities" + flat
      // input/output_audio_format style as well as the newer
      // audio.{input,output} object style. Use the older form here for
      // compatibility with grok-voice-batch.ts (already validated).
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions,
            voice: VOICE,
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            turn_detection: {
              type: "server_vad",
              threshold: VAD.threshold,
              silence_duration_ms: VAD.silence_duration_ms,
              prefix_padding_ms: VAD.prefix_padding_ms,
            },
          },
        })
      );
      sendNextUser();
    });

    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      const obj = msg as { type?: string; delta?: string; error?: { code?: string; message?: string } };
      const t = obj.type ?? "";
      if (
        t === "response.audio_transcript.delta" ||
        t === "response.output_audio_transcript.delta" ||
        t === "response.text.delta"
      ) {
        if (turnIdx < transcripts.length && typeof obj.delta === "string") {
          transcripts[turnIdx]!.assistant += obj.delta;
        }
      } else if (t === "response.done") {
        turnIdx += 1;
        if (turnIdx >= caseDef.turns.length) {
          finish("response.done.last");
        } else {
          sendNextUser();
        }
      } else if (t === "error") {
        outcome.errorCode = obj.error?.code ?? "API_ERROR";
        outcome.errorMessage = obj.error?.message ?? "";
        finish("error_event");
      }
    });
    ws.on("close", () => {
      if (!resolved) finish("ws_closed");
    });
    ws.on("error", (err) => {
      outcome.errorCode = outcome.errorCode || "WS_ERROR";
      outcome.errorMessage = outcome.errorMessage || err.message;
      finish("ws_error");
    });
  });
}

// ---------------- Pass evaluation ----------------

function countSentences(text: string): number {
  // Japanese sentence splitter — counts strong terminators.
  const matches = text.match(/[。．！？!?]/g);
  return matches ? matches.length : text.trim().length > 0 ? 1 : 0;
}

function evaluateOutcome(caseDef: CaseDef, outcome: RunOutcome): void {
  if (outcome.errorCode) {
    outcome.pass = false;
    outcome.failures.push(`error:${outcome.errorCode} ${outcome.errorMessage}`);
    return;
  }
  const last = outcome.transcripts[outcome.transcripts.length - 1]?.assistant ?? "";
  const failures: string[] = [];
  for (const cond of caseDef.passConditions) {
    if (cond.kind === "must_contain_any") {
      const hit = cond.terms.some((t) => last.includes(t));
      if (!hit) failures.push(`missing_any[${cond.terms.join("|")}] (${cond.reason})`);
    } else if (cond.kind === "must_not_contain_any") {
      const bad = cond.terms.find((t) => last.includes(t));
      if (bad) failures.push(`forbidden:${bad} (${cond.reason})`);
    } else if (cond.kind === "max_sentences") {
      const n = countSentences(last);
      if (n > cond.max) failures.push(`too_long:${n}>${cond.max} (${cond.reason})`);
    } else if (cond.kind === "must_contain_at_least") {
      const hits = cond.terms.filter((t) => last.includes(t)).length;
      if (hits < cond.n) {
        failures.push(
          `only_${hits}_of_${cond.n}[${cond.terms.join("|")}] (${cond.reason})`
        );
      }
    } else if (cond.kind === "must_contain_in_turn") {
      const turn = outcome.transcripts[cond.turnIndex]?.assistant ?? "";
      const hit = cond.terms.some((t) => turn.includes(t));
      if (!hit)
        failures.push(
          `turn${cond.turnIndex}_missing[${cond.terms.join("|")}] (${cond.reason})`
        );
    } else if (cond.kind === "must_not_contain_in_turn") {
      const turn = outcome.transcripts[cond.turnIndex]?.assistant ?? "";
      const bad = cond.terms.find((t) => turn.includes(t));
      if (bad)
        failures.push(
          `turn${cond.turnIndex}_forbidden:${bad} (${cond.reason})`
        );
    }
  }
  if (failures.length > 0) {
    failures.push(`actual:${last.trim().slice(0, 240) || "(empty)"}`);
  }
  outcome.failures = failures;
  outcome.pass = failures.length === 0;
}

// ---------------- Main ----------------

async function loadDotEnvLocalIfPresent(): Promise<void> {
  if (process.env["XAI_API_KEY"]) return;
  const candidates = [
    resolve(REPO_ROOT, "apps/web/.env.local"),
    resolve(REPO_ROOT, ".env.local"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const txt = await readFile(p, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!;
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

// Per AGENTS.md, secrets must always come from Secret Manager. If the key
// is still missing after the .env.local pass, or if the value looks like a
// placeholder ("test-..." / shorter than 32 chars), shell out to gcloud and
// pull XAI_API_KEY from zapier-transfer (default secret-source project) —
// then adecco-mendan as a fallback.
function loadXaiKeyFromSecretManagerIfNeeded(): void {
  const current = process.env["XAI_API_KEY"];
  const looksReal = current && current.length >= 32 && !current.startsWith("test-");
  if (looksReal) return;

  const projects = [
    process.env["SECRET_SOURCE_PROJECT_ID"] ?? "zapier-transfer",
    "adecco-mendan",
  ];
  for (const project of projects) {
    // Windows: spawnSync('gcloud.cmd', ...) returns EINVAL on Node 22+ unless
    // shell:true is set, because gcloud.cmd is a batch wrapper. Using shell
    // mode is safe here — all arguments are literals known at write time.
    const r = spawnSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        "--secret=XAI_API_KEY",
        `--project=${project}`,
      ],
      { encoding: "utf8", shell: process.platform === "win32" }
    );
    if (r.status === 0 && r.stdout && r.stdout.trim().length >= 32) {
      process.env["XAI_API_KEY"] = r.stdout.trim();
      console.info(
        `[grok-voice-v21-e2e] XAI_API_KEY fetched from projects/${project}/secrets/XAI_API_KEY (len=${r.stdout.trim().length})`
      );
      return;
    }
  }
}

async function main(): Promise<void> {
  await loadDotEnvLocalIfPresent();
  loadXaiKeyFromSecretManagerIfNeeded();
  const apiKey = process.env["XAI_API_KEY"];
  if (!apiKey || apiKey.length < 32 || apiKey.startsWith("test-")) {
    console.error(
      "BLOCKED: XAI_API_KEY not available. Tried .env.local + gcloud Secret Manager (zapier-transfer, adecco-mendan)."
    );
    process.exit(2);
  }
  XAI_API_KEY = apiKey;
  MODEL = process.env["GROK_VOICE_MODEL"] ?? "grok-voice-think-fast-1.0";
  VOICE = process.env["GROK_VOICE_VOICE_ID"] ?? "rex";
  VAD = {
    threshold: Number(process.env["GROK_VOICE_TURN_DETECTION_THRESHOLD"] ?? "0.72"),
    silence_duration_ms: Number(
      process.env["GROK_VOICE_TURN_DETECTION_SILENCE_MS"] ?? "650"
    ),
    prefix_padding_ms: Number(
      process.env["GROK_VOICE_TURN_DETECTION_PREFIX_PADDING_MS"] ?? "333"
    ),
  };

  const bundle = await loadBundle();
  const instructions = buildGrokVoiceSystemPrompt(bundle);

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const outDir = resolve(REPO_ROOT, "out", "grok_voice_v21_e2e", stamp);
  await mkdir(outDir, { recursive: true });

  const filtered = CASES.filter((c) => {
    if (ONLY_CASES.length === 0) return true;
    // Match against either "case<id>_..." (legacy "1", "7") or the
    // mid-id token directly ("3b", "9", "11"). The previous startsWith
    // form skipped Case 3b because "case3b_" doesn't match "case3_".
    return ONLY_CASES.some((s) => {
      const prefix = `case${s}_`;
      return c.id.startsWith(prefix) || c.id === `case${s}`;
    });
  }).slice(0, LIMIT);

  console.info(`[grok-voice-v21-e2e] model=${MODEL} voice=${VOICE}`);
  console.info(`[grok-voice-v21-e2e] cases=${filtered.length} rounds=${ROUNDS} criticalRounds=${CRITICAL_ROUNDS}`);
  console.info(`[grok-voice-v21-e2e] out=${outDir}`);
  console.info("");

  const summaryCases: Array<{
    caseId: string;
    label: string;
    critical: boolean;
    rounds: RunOutcome[];
    pass: boolean;
    consecutivePass: number;
  }> = [];

  // xAI realtime endpoint enforces a per-minute connection limit. With
  // 12 cases × ~3 rounds × 1 WS each, bursts can hit 429. Sleep briefly
  // between rounds to keep the pacing under the rate cap.
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  for (const c of filtered) {
    const target = c.critical ? Math.max(ROUNDS, CRITICAL_ROUNDS) : ROUNDS;
    const rounds: RunOutcome[] = [];
    for (let i = 1; i <= target; i += 1) {
      process.stdout.write(`  [${c.id}] round ${i}/${target} ... `);
      const outcome = await runOneRound(c, i, instructions);
      evaluateOutcome(c, outcome);
      rounds.push(outcome);
      // Throttle: 2.5s between successful rounds. If we hit a 429, back off
      // for 30s before continuing — gives the per-minute window time to
      // reset. (Other errors fall through with the default delay.)
      if (outcome.errorCode === "WS_ERROR" && /429/.test(outcome.errorMessage)) {
        process.stdout.write("  …rate-limited, backing off 30s…\n");
        await sleep(30_000);
      } else {
        await sleep(2_500);
      }
      console.info(
        outcome.pass
          ? `PASS (${outcome.totalMs}ms)`
          : `FAIL ${outcome.failures.join("; ")}`
      );
    }
    const consecutivePass = countTrailingTrue(rounds.map((r) => r.pass));
    summaryCases.push({
      caseId: c.id,
      label: c.label,
      critical: c.critical,
      rounds,
      pass: rounds.every((r) => r.pass),
      consecutivePass,
    });
  }

  const summary = {
    scenarioId: bundle.scenarioId,
    promptVersion: bundle.promptVersion,
    guardrailVersion: extractGuardrailVersion(GROK_VOICE_RUNTIME_GUARDRAIL),
    model: MODEL,
    voice: VOICE,
    turnDetection: {
      threshold: VAD.threshold,
      silence_duration_ms: VAD.silence_duration_ms,
      prefix_padding_ms: VAD.prefix_padding_ms,
    },
    instructionsBytes: instructions.length,
    instructionsSha256: createHash("sha256").update(instructions).digest("hex"),
    rounds: ROUNDS,
    criticalRounds: CRITICAL_ROUNDS,
    cases: summaryCases,
    overallPass:
      summaryCases.every((c) => c.pass) &&
      summaryCases
        .filter((c) => c.critical)
        .every((c) => c.consecutivePass >= CRITICAL_ROUNDS),
    timestamp: new Date().toISOString(),
  };
  await writeFile(
    resolve(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  const md: string[] = [
    `# Grok Voice v2.1 Scenario Accuracy E2E`,
    ``,
    `- scenarioId: \`${bundle.scenarioId}\``,
    `- promptVersion: \`${bundle.promptVersion}\``,
    `- model: \`${MODEL}\` voice: \`${VOICE}\``,
    `- VAD: threshold=${VAD.threshold} silence=${VAD.silence_duration_ms}ms prefix_padding=${VAD.prefix_padding_ms}ms`,
    `- rounds: ${ROUNDS} (critical: ${CRITICAL_ROUNDS})`,
    `- overallPass: **${summary.overallPass ? "PASS" : "FAIL"}**`,
    ``,
  ];
  for (const c of summaryCases) {
    md.push(
      `## ${c.caseId} ${c.critical ? "(critical)" : ""} — ${c.label} — ${c.pass ? "PASS" : "FAIL"} (${c.consecutivePass} consecutive)`
    );
    for (const r of c.rounds) {
      md.push(``);
      md.push(`### round ${r.round} — ${r.pass ? "PASS" : "FAIL"} (${r.totalMs}ms)`);
      if (r.errorCode) md.push(`- error: ${r.errorCode} ${r.errorMessage}`);
      if (r.failures.length) md.push(`- failures: ${r.failures.join("; ")}`);
      r.transcripts.forEach((t, i) => {
        md.push(``);
        md.push(`**user[${i}]:** ${t.user}`);
        md.push(``);
        md.push(`**assistant[${i}]:** ${t.assistant.trim() || "(empty)"}`);
      });
    }
    md.push(``);
  }
  await writeFile(resolve(outDir, "transcript.md"), md.join("\n"), "utf8");

  console.info("");
  console.info(
    `[grok-voice-v21-e2e] overall: ${summary.overallPass ? "PASS" : "FAIL"}`
  );
  console.info(`[grok-voice-v21-e2e] evidence: ${outDir}`);
  process.exit(summary.overallPass ? 0 : 1);
}

function countTrailingTrue(bools: boolean[]): number {
  let n = 0;
  for (let i = bools.length - 1; i >= 0; i -= 1) {
    if (bools[i]) n += 1;
    else break;
  }
  return n;
}

function extractGuardrailVersion(guardrail: string): string {
  const m = guardrail.match(/Runtime Guardrails \(([^)]+)\)/);
  return m ? m[1]! : "unknown";
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
