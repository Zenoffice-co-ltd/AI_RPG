/**
 * Grok Voice v2.1 voice-input E2E harness.
 *
 * Sends fixed 24kHz PCM16 mono WAV fixtures through
 * input_audio_buffer.append + input_audio_buffer.commit, records STT and
 * assistant transcripts, and writes evidence to:
 *   out/grok_voice_v21_voice_e2e/<utc-iso-compact>/
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { WebSocket as WsClient } from "ws";
import { buildLivePronunciationGuide } from "../packages/scenario-engine/src/tts/livePronunciationGuide";
import { buildGrokVoiceSystemPrompt } from "../apps/web/server/grokVoice/promptBuilder";
import type { GrokVoiceScenarioBundle } from "../apps/web/server/grokVoice/scenarioLoader";
import { normalizePr60AssistantText } from "../apps/web/lib/roleplay/grok-voice-pr60-output";

function getArg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.findIndex((v) => v === flag);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const LIMIT = Number(getArg("--limit", "5"));
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = resolve(REPO_ROOT, "test/fixtures/audio/grok-voice-v21");
const SCENARIO_ID =
  "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21";
const SCENARIOS_DIR = resolve(REPO_ROOT, "data/generated/scenarios");
const VOICE_PROFILE_PATH = resolve(
  REPO_ROOT,
  "config/voice-profiles/staffing_order_hearing_adecco_manufacturer_ja_v3_candidate_v2.json"
);

let XAI_API_KEY = "";
let MODEL = "grok-voice-think-fast-1.0";
let VOICE = "rex";
let VAD = { threshold: 0.72, silence_duration_ms: 650, prefix_padding_ms: 333 };

type VoiceCase = {
  id: string;
  label: string;
  fixture: string;
  sttTerms?: string[];
  mustContainAny: string[];
  mustNotContainAny: string[];
};

const VOICE_CASES: VoiceCase[] = [
  {
    id: "voice_case1_shallow_background",
    label: "募集背景を教えてください",
    fixture: "voice_case1_shallow_background.wav",
    mustContainAny: ["増員", "受注", "処理"],
    mustNotContainAny: ["現行ベンダー", "供給不足", "レスポンス", "競合"],
  },
  {
    id: "voice_case2_domain_hypothesis",
    label: "住宅設備メーカー仮説",
    fixture: "voice_case2_domain_hypothesis.wav",
    sttTerms: ["品番", "在庫", "施工日"],
    mustContainAny: ["よくご存じ", "その理解で近い", "納期", "品番"],
    mustNotContainAny: ["お答えできません"],
  },
  {
    id: "voice_case3_headcount",
    label: "人数は何名ですか",
    fixture: "voice_case3_headcount.wav",
    mustContainAny: ["一名", "1名", "ひと名"],
    mustNotContainAny: ["他に確認", "ご質問があれば", "気になる点"],
  },
  {
    id: "voice_case4_rate",
    label: "単価はどのくらいですか",
    fixture: "voice_case4_rate.wav",
    mustContainAny: ["千七百五十", "千九百", "時給"],
    mustNotContainAny: ["他に確認", "ご質問があれば", "気になる点"],
  },
  {
    id: "voice_case5_order_entry_requirement",
    label: "受発注入力の経験は必須ですか",
    fixture: "voice_case5_order_entry_requirement.wav",
    sttTerms: ["受発注"],
    mustContainAny: ["優先", "必須では", "第一"],
    mustNotContainAny: ["必須です", "その理解でよい", "問題ありません"],
  },
];

type Outcome = {
  caseId: string;
  label: string;
  fixture: string;
  sttTranscript: string;
  assistantTranscript: string;
  latencyMs: number;
  pass: boolean;
  failures: string[];
};

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

async function runVoiceCase(
  voiceCase: VoiceCase,
  instructions: string
): Promise<Outcome> {
  const fixturePath = resolve(FIXTURE_DIR, voiceCase.fixture);
  const startedAt = Date.now();
  const outcome: Outcome = {
    caseId: voiceCase.id,
    label: voiceCase.label,
    fixture: fixturePath,
    sttTranscript: "",
    assistantTranscript: "",
    latencyMs: 0,
    pass: false,
    failures: [],
  };
  if (!existsSync(fixturePath)) {
    outcome.failures.push(`missing_fixture:${fixturePath}`);
    return outcome;
  }
  const pcm = parsePcm16Mono24k(await readFile(fixturePath));

  await new Promise<void>((resolveOuter) => {
    const ws = new WsClient(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(MODEL)}`,
      { headers: { Authorization: `Bearer ${XAI_API_KEY}` } }
    );
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let readyFallback: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    let audioSent = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (watchdog) clearTimeout(watchdog);
      if (readyFallback) clearTimeout(readyFallback);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolveOuter();
    };
    watchdog = setTimeout(() => {
      outcome.failures.push("timeout:response.done");
      finish();
    }, 75_000);
    const sendAudioTurn = () => {
      if (audioSent) return;
      audioSent = true;
      for (const chunk of chunkBuffer(pcm, 4_800)) {
        ws.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: chunk.toString("base64"),
          })
        );
      }
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({ type: "response.create" }));
    };
    ws.on("open", () => {
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
      readyFallback = setTimeout(sendAudioTurn, 1_500);
    });
    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      const event = msg as {
        type?: string;
        transcript?: string;
        delta?: string;
        error?: { code?: string; message?: string };
      };
      if (event.type === "session.updated" || event.type === "session.created") {
        sendAudioTurn();
      } else if (event.type === "conversation.item.input_audio_transcription.completed") {
        outcome.sttTranscript = event.transcript ?? "";
      } else if (
        event.type === "response.audio_transcript.delta" ||
        event.type === "response.output_audio_transcript.delta" ||
        event.type === "response.text.delta"
      ) {
        outcome.assistantTranscript += event.delta ?? "";
      } else if (event.type === "response.done") {
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

  outcome.latencyMs = Date.now() - startedAt;
  outcome.assistantTranscript = normalizePr60AssistantText(
    outcome.sttTranscript,
    outcome.assistantTranscript
  );
  evaluateVoiceCase(voiceCase, outcome);
  return outcome;
}

function evaluateVoiceCase(voiceCase: VoiceCase, outcome: Outcome) {
  if (outcome.sttTranscript.trim().length === 0) {
    outcome.failures.push("stt_empty");
  }
  for (const term of voiceCase.sttTerms ?? []) {
    if (!outcome.sttTranscript.includes(term)) {
      outcome.failures.push(`stt_missing:${term}`);
    }
  }
  if (!voiceCase.mustContainAny.some((term) => outcome.assistantTranscript.includes(term))) {
    outcome.failures.push(`assistant_missing_any:${voiceCase.mustContainAny.join("|")}`);
  }
  const forbidden = voiceCase.mustNotContainAny.find((term) =>
    outcome.assistantTranscript.includes(term)
  );
  if (forbidden) {
    outcome.failures.push(`assistant_forbidden:${forbidden}`);
  }
  outcome.pass = outcome.failures.length === 0;
}

function parsePcm16Mono24k(wav: Buffer) {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("fixture is not a RIFF/WAVE file");
  }
  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      audioFormat = wav.readUInt16LE(start);
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
      bitsPerSample = wav.readUInt16LE(start + 14);
    } else if (id === "data") {
      data = wav.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (audioFormat !== 1 || channels !== 1 || sampleRate !== 24_000 || bitsPerSample !== 16) {
    throw new Error(
      `fixture must be PCM16 mono 24kHz (format=${audioFormat}, channels=${channels}, rate=${sampleRate}, bits=${bitsPerSample})`
    );
  }
  if (!data || data.length === 0) throw new Error("fixture has no data chunk");
  return data;
}

function* chunkBuffer(buffer: Buffer, chunkSize: number) {
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    yield buffer.subarray(offset, Math.min(buffer.length, offset + chunkSize));
  }
}

async function loadDotEnvLocalIfPresent(): Promise<void> {
  if (process.env["XAI_API_KEY"]) return;
  for (const p of [resolve(REPO_ROOT, "apps/web/.env.local"), resolve(REPO_ROOT, ".env.local")]) {
    if (!existsSync(p)) continue;
    const txt = await readFile(p, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!;
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
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
  for (const project of [process.env["SECRET_SOURCE_PROJECT_ID"] ?? "zapier-transfer", "adecco-mendan"]) {
    const r = spawnSync(
      "gcloud",
      ["secrets", "versions", "access", "latest", "--secret=XAI_API_KEY", `--project=${project}`],
      { encoding: "utf8", shell: process.platform === "win32" }
    );
    if (r.status === 0 && r.stdout && r.stdout.trim().length >= 32) {
      process.env["XAI_API_KEY"] = r.stdout.trim();
      console.info(`[grok-voice-v21-voice-e2e] XAI_API_KEY fetched from projects/${project}`);
      return;
    }
  }
}

async function main() {
  await loadDotEnvLocalIfPresent();
  loadXaiKeyFromSecretManagerIfNeeded();
  const apiKey = process.env["XAI_API_KEY"];
  if (!apiKey || apiKey.length < 32 || apiKey.startsWith("test-")) {
    console.error("BLOCKED: XAI_API_KEY not available.");
    process.exit(2);
  }
  XAI_API_KEY = apiKey;
  MODEL = process.env["GROK_VOICE_MODEL"] ?? MODEL;
  VOICE = process.env["GROK_VOICE_VOICE_ID"] ?? VOICE;
  VAD = {
    threshold: Number(process.env["GROK_VOICE_TURN_DETECTION_THRESHOLD"] ?? "0.72"),
    silence_duration_ms: Number(process.env["GROK_VOICE_TURN_DETECTION_SILENCE_MS"] ?? "650"),
    prefix_padding_ms: Number(process.env["GROK_VOICE_TURN_DETECTION_PREFIX_PADDING_MS"] ?? "333"),
  };

  const bundle = await loadBundle();
  const instructions = buildGrokVoiceSystemPrompt(bundle);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const outDir = resolve(REPO_ROOT, "out", "grok_voice_v21_voice_e2e", stamp);
  await mkdir(outDir, { recursive: true });

  const outcomes: Outcome[] = [];
  for (const voiceCase of VOICE_CASES.slice(0, LIMIT)) {
    console.info(`[grok-voice-v21-voice-e2e] ${voiceCase.id} ...`);
    outcomes.push(await runVoiceCase(voiceCase, instructions));
  }
  const summary = {
    scenarioId: bundle.scenarioId,
    promptVersion: bundle.promptVersion,
    model: MODEL,
    voice: VOICE,
    turnDetection: VAD,
    cases: outcomes,
    overallPass: outcomes.every((o) => o.pass),
    timestamp: new Date().toISOString(),
  };
  await writeFile(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  const md = [
    "# Grok Voice v2.1 Voice E2E",
    "",
    `- overallPass: **${summary.overallPass ? "PASS" : "FAIL"}**`,
    `- evidence: \`${outDir}\``,
    "",
    ...outcomes.flatMap((o) => [
      `## ${o.caseId} - ${o.pass ? "PASS" : "FAIL"} (${o.latencyMs}ms)`,
      o.failures.length ? `- failures: ${o.failures.join("; ")}` : "- failures: none",
      `- fixture: \`${o.fixture}\``,
      "",
      `**STT:** ${o.sttTranscript.trim() || "(empty)"}`,
      "",
      `**assistant:** ${o.assistantTranscript.trim() || "(empty)"}`,
      "",
    ]),
  ];
  await writeFile(resolve(outDir, "transcript.md"), md.join("\n"), "utf8");
  console.info(`[grok-voice-v21-voice-e2e] overall: ${summary.overallPass ? "PASS" : "FAIL"}`);
  console.info(`[grok-voice-v21-voice-e2e] evidence: ${outDir}`);
  process.exit(summary.overallPass ? 0 : 1);
}

main().catch((error) => {
  console.error("FATAL", error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
