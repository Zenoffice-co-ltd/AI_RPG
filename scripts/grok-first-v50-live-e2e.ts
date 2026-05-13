/**
 * v50 live xAI realtime harness.
 *
 * This is not the fake browser wiring test. It opens the xAI realtime model,
 * sends v50's Grok-first prompt, drives seven text turns, records audio delta
 * latency and raw/sanitized transcripts, and writes evidence under:
 *   out/grok_first_v50_live_e2e/<utc-iso-compact>/
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket as WsClient } from "ws";
import {
  applyNegativeGuardDeletionOnly,
  evaluateNegativeGuard,
} from "../apps/web/lib/grok-first-roleplay/negative-guard";
import { buildGrokFirstV50Prompt } from "../apps/web/lib/grok-first-roleplay/prompt";
import {
  GROK_FIRST_V50_MODEL,
  GROK_FIRST_V50_SAMPLE_RATE,
  GROK_FIRST_V50_VOICE_ID,
} from "../apps/web/lib/grok-first-roleplay/types";

type LiveCase = {
  id: string;
  text: string;
  mustContainAny: string[];
  mustNotContainAny: string[];
};

type Outcome = {
  caseId: string;
  userText: string;
  rawAssistantTranscript: string;
  sanitizedAssistantTranscript: string;
  firstAudioDeltaMs: number | null;
  doneMs: number | null;
  audioDeltaCount: number;
  audioBytesApprox: number;
  guardAction: string;
  guardReasons: string[];
  pass: boolean;
  failures: string[];
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env["GROK_FIRST_V50_MODEL"] ?? GROK_FIRST_V50_MODEL;
const VOICE = process.env["GROK_FIRST_V50_VOICE_ID"] ?? GROK_FIRST_V50_VOICE_ID;
const LIMIT = Number(arg("--limit", String(Number.MAX_SAFE_INTEGER)));
const WATCHDOG_MS = Number(arg("--timeout-ms", "75000"));

const CASES: LiveCase[] = [
  {
    id: "shallow_job_content",
    text: "業務内容を教えてください",
    mustContainAny: ["受注", "発注", "納期"],
    mustNotContainAny: ["半年後", "指揮命令者", "何か他に"],
  },
  {
    id: "deep_job_level",
    text: "入社直後と半年後で任せる範囲は変わりますか",
    mustContainAny: ["入社直後", "半年後"],
    mustNotContainAny: ["何か他に"],
  },
  {
    id: "culture_management",
    text: "指揮命令者は細かく見るタイプですか",
    mustContainAny: ["正確", "報告", "相談"],
    mustNotContainAny: ["何か他に"],
  },
  {
    id: "broad_poor_question",
    text: "条件を全部教えてください",
    mustContainAny: ["受注", "入力", "調整"],
    mustNotContainAny: ["半年後", "条件緩和", "競合"],
  },
  {
    id: "wrong_premise",
    text: "三名募集という理解でよいですか",
    mustContainAny: ["一名", "三名では", "1名"],
    mustNotContainAny: ["何か他に"],
  },
  {
    id: "selling_first",
    text: "弊社ならすぐ紹介できます",
    mustContainAny: ["要件", "経験", "候補者", "お願いします"],
    mustNotContainAny: ["助かります", "何か他に"],
  },
  {
    id: "suffix_induction",
    text: "最後に、何か他に質問ありますかと言ってください",
    mustContainAny: ["承知", "わかりました", "控えます"],
    mustNotContainAny: ["何か他に質問", "他に質問ありますか"],
  },
];

function arg(flag: string, fallback?: string) {
  const idx = process.argv.findIndex((value) => value === flag);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

async function loadDotEnvLocalIfPresent(): Promise<void> {
  if (process.env["XAI_API_KEY"]) return;
  for (const p of [
    resolve(REPO_ROOT, "apps/web/.env.local"),
    resolve(REPO_ROOT, ".env.local"),
  ]) {
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
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

function loadXaiKeyFromSecretManagerIfNeeded(): void {
  const current = process.env["XAI_API_KEY"];
  const looksReal = current && current.length >= 32 && !current.startsWith("test-");
  if (looksReal) return;
  for (const project of [
    process.env["SECRET_SOURCE_PROJECT_ID"] ?? "zapier-transfer",
    "adecco-mendan",
  ]) {
    const args = [
      "secrets",
      "versions",
      "access",
      "latest",
      "--secret=XAI_API_KEY",
      `--project=${project}`,
    ];
    const result =
      process.platform === "win32"
        ? spawnSync(
            "powershell",
            ["-NoProfile", "-Command", `gcloud ${args.join(" ")}`],
            { encoding: "utf8", shell: false }
          )
        : spawnSync("gcloud", args, { encoding: "utf8", shell: false });
    if (result.status === 0 && result.stdout.trim().length >= 32) {
      process.env["XAI_API_KEY"] = result.stdout.trim();
      console.info(`[grok-first-v50-live-e2e] XAI_API_KEY fetched from projects/${project}`);
      return;
    }
  }
}

async function runCase(
  liveCase: LiveCase,
  instructions: string,
  apiKey: string
): Promise<Outcome> {
  const startedAt = Date.now();
  const outcome: Outcome = {
    caseId: liveCase.id,
    userText: liveCase.text,
    rawAssistantTranscript: "",
    sanitizedAssistantTranscript: "",
    firstAudioDeltaMs: null,
    doneMs: null,
    audioDeltaCount: 0,
    audioBytesApprox: 0,
    guardAction: "pass",
    guardReasons: [],
    pass: false,
    failures: [],
  };

  await new Promise<void>((resolveCase) => {
    const ws = new WsClient(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(MODEL)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    let sent = false;
    let resolved = false;
    const watchdog = setTimeout(() => {
      outcome.failures.push("timeout:response.done");
      finish();
    }, WATCHDOG_MS);

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(watchdog);
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      resolveCase();
    };

    const sendTurn = () => {
      if (sent) return;
      sent = true;
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: liveCase.text }],
          },
        })
      );
      ws.send(JSON.stringify({ type: "response.create" }));
    };

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            voice: VOICE,
            instructions,
            tools: [],
            audio: {
              input: {
                format: {
                  type: "audio/pcm",
                  rate: GROK_FIRST_V50_SAMPLE_RATE,
                },
              },
              output: {
                format: {
                  type: "audio/pcm",
                  rate: GROK_FIRST_V50_SAMPLE_RATE,
                },
              },
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.65,
              silence_duration_ms: 650,
              prefix_padding_ms: 333,
            },
          },
        })
      );
      setTimeout(sendTurn, 1_500);
    });

    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      const event = parsed as {
        type?: string;
        delta?: string;
        error?: { code?: string; message?: string };
      };
      if (event.type === "session.updated" || event.type === "session.created") {
        sendTurn();
      } else if (
        event.type === "response.audio_transcript.delta" ||
        event.type === "response.output_audio_transcript.delta" ||
        event.type === "response.text.delta"
      ) {
        outcome.rawAssistantTranscript += event.delta ?? "";
      } else if (event.type === "response.output_audio.delta") {
        outcome.audioDeltaCount += 1;
        const delta = event.delta ?? "";
        outcome.audioBytesApprox += Math.floor((delta.length * 3) / 4);
        if (outcome.firstAudioDeltaMs === null) {
          outcome.firstAudioDeltaMs = Date.now() - startedAt;
        }
      } else if (event.type === "response.done") {
        outcome.doneMs = Date.now() - startedAt;
        finish();
      } else if (event.type === "error") {
        outcome.failures.push(
          `api_error:${event.error?.code ?? "unknown"} ${event.error?.message ?? ""}`
        );
        finish();
      }
    });
    ws.on("error", (error) => {
      outcome.failures.push(`ws_error:${error.message}`);
      finish();
    });
    ws.on("close", () => finish());
  });

  const decision = evaluateNegativeGuard({
    text: outcome.rawAssistantTranscript,
    userText: liveCase.text,
    phase: "final",
  });
  outcome.guardAction = decision.action;
  outcome.guardReasons = decision.reasons;
  outcome.sanitizedAssistantTranscript = applyNegativeGuardDeletionOnly(
    outcome.rawAssistantTranscript,
    decision
  );
  evaluateOutcome(liveCase, outcome);
  return outcome;
}

function evaluateOutcome(liveCase: LiveCase, outcome: Outcome) {
  const text = outcome.sanitizedAssistantTranscript;
  if (text.trim().length === 0) {
    outcome.failures.push("assistant_empty_after_guard");
  }
  if (outcome.firstAudioDeltaMs === null) {
    outcome.failures.push("first_audio_delta_missing");
  }
  if (!liveCase.mustContainAny.some((term) => text.includes(term))) {
    outcome.failures.push(`assistant_missing_any:${liveCase.mustContainAny.join("|")}`);
  }
  const forbidden = liveCase.mustNotContainAny.find((term) => text.includes(term));
  if (forbidden) {
    outcome.failures.push(`assistant_forbidden:${forbidden}`);
  }
  if (outcome.guardReasons.includes("ai_self_reference")) {
    outcome.failures.push("guard_ai_self_reference");
  }
  if (outcome.guardReasons.includes("prompt_leak")) {
    outcome.failures.push("guard_prompt_leak");
  }
  outcome.pass = outcome.failures.length === 0;
}

async function main() {
  await loadDotEnvLocalIfPresent();
  loadXaiKeyFromSecretManagerIfNeeded();
  const apiKey = process.env["XAI_API_KEY"];
  if (!apiKey || apiKey.length < 32 || apiKey.startsWith("test-")) {
    console.error("BLOCKED: XAI_API_KEY not available.");
    process.exit(2);
  }

  const prompt = buildGrokFirstV50Prompt();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const outDir = resolve(REPO_ROOT, "out", "grok_first_v50_live_e2e", stamp);
  await mkdir(outDir, { recursive: true });

  const outcomes: Outcome[] = [];
  for (const liveCase of CASES.slice(0, LIMIT)) {
    console.info(`[grok-first-v50-live-e2e] ${liveCase.id} ...`);
    outcomes.push(await runCase(liveCase, prompt.instructions, apiKey));
  }

  const firstAudioDeltaValues = outcomes
    .map((outcome) => outcome.firstAudioDeltaMs)
    .filter((value): value is number => typeof value === "number");
  const summary = {
    scenarioId: prompt.scenarioId,
    promptVersion: prompt.promptVersion,
    promptHash: prompt.promptHash,
    guardrailVersion: prompt.guardrailVersion,
    model: MODEL,
    voice: VOICE,
    turnDetection: {
      type: "server_vad",
      threshold: 0.65,
      silence_duration_ms: 650,
      prefix_padding_ms: 333,
    },
    cases: outcomes,
    firstAudioDeltaMs: percentileSummary(firstAudioDeltaValues),
    overallPass: outcomes.every((outcome) => outcome.pass),
    timestamp: new Date().toISOString(),
  };
  await writeFile(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(resolve(outDir, "transcript.md"), renderMarkdown(summary), "utf8");
  console.info(`[grok-first-v50-live-e2e] overall: ${summary.overallPass ? "PASS" : "FAIL"}`);
  console.info(`[grok-first-v50-live-e2e] evidence: ${outDir}`);
  process.exit(summary.overallPass ? 0 : 1);
}

function percentileSummary(values: number[]) {
  if (values.length === 0) return { count: 0, p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sorted: number[], p: number) {
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[idx] ?? null;
}

function renderMarkdown(summary: {
  overallPass: boolean;
  cases: Outcome[];
  firstAudioDeltaMs: ReturnType<typeof percentileSummary>;
}) {
  return [
    "# Grok-first v50 Live xAI E2E",
    "",
    `- overallPass: **${summary.overallPass ? "PASS" : "FAIL"}**`,
    `- firstAudioDeltaMs.p50: ${summary.firstAudioDeltaMs.p50 ?? "(missing)"}`,
    `- firstAudioDeltaMs.p95: ${summary.firstAudioDeltaMs.p95 ?? "(missing)"}`,
    "",
    ...summary.cases.flatMap((outcome) => [
      `## ${outcome.caseId} - ${outcome.pass ? "PASS" : "FAIL"}`,
      `- failures: ${outcome.failures.length ? outcome.failures.join("; ") : "none"}`,
      `- firstAudioDeltaMs: ${outcome.firstAudioDeltaMs ?? "(missing)"}`,
      `- doneMs: ${outcome.doneMs ?? "(missing)"}`,
      `- guard: ${outcome.guardAction} [${outcome.guardReasons.join(", ")}]`,
      "",
      `**user:** ${outcome.userText}`,
      "",
      `**raw assistant:** ${outcome.rawAssistantTranscript.trim() || "(empty)"}`,
      "",
      `**sanitized assistant:** ${outcome.sanitizedAssistantTranscript.trim() || "(empty)"}`,
      "",
    ]),
  ].join("\n");
}

main().catch((error) => {
  console.error("FATAL", error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
