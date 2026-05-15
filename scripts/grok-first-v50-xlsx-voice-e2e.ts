import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket as WsClient } from "ws";

type CaseDef = {
  caseId: string;
  scenarioId: string;
  runTier: string;
  priority: string;
  turnNo: number;
  phase: string;
  inputText: string;
  expectedPolicy: string;
  mustIncludeAll: string[];
  mustIncludeAny: string[];
  mustNotInclude: string[];
  forbiddenPhrases: string[];
  maxSentences: number;
};

type ScenarioDef = {
  scenarioId: string;
  runTier: string;
  priority: string;
  name: string;
  turnCount: number;
  order: number;
};

type CasesFile = {
  source: string;
  scenarios: ScenarioDef[];
  cases: CaseDef[];
};

type GrokSession = {
  sessionId: string;
  demoSlug: string;
  backend: string;
  scenarioId: string;
  promptVersion: string;
  model: string;
  voiceId: string;
  wsUrl: string;
  realtimeAuth: { protocol: string; ticket: string; mode: string };
  audio: { inputFormat: string; outputFormat: string; sampleRate: number };
  turnDetection: { type: string; threshold: number; silence_duration_ms: number; prefix_padding_ms: number };
  instructions: string;
  firstMessage: string;
  ephemeralToken?: string;
  registeredSpeech?: unknown;
  lockedResponseAudioBundle?: unknown;
};

type TurnOutcome = {
  caseId: string;
  scenarioId: string;
  turnNo: number;
  priority: string;
  userInputText: string;
  sttTranscript: string;
  assistantTranscript: string;
  firstAudioDeltaMs: number | null;
  doneMs: number | null;
  audioDeltaCount: number;
  audioBytesApprox: number;
  sentenceCount: number;
  pass: boolean;
  failures: string[];
};

type ScenarioOutcome = {
  scenarioId: string;
  name: string;
  runTier: string;
  priority: string;
  session: Pick<GrokSession, "sessionId" | "demoSlug" | "backend" | "scenarioId" | "promptVersion" | "model" | "voiceId">;
  turns: TurnOutcome[];
  pass: boolean;
  failures: string[];
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE_URL = "https://roleplay.mendan.biz";
const BASE_URL = process.env["V50_4_E2E_BASE_URL"] ?? DEFAULT_BASE_URL;
const OUT_DIR =
  arg("--out-dir") ??
  resolve(
    REPO_ROOT,
    "out",
    "v50_4_voice_e2e",
    new Date().toISOString().replace(/[:.]/g, "-")
  );
const TIER = (arg("--tier") ?? "smoke").toLowerCase();
const LIMIT = arg("--limit") ? Number(arg("--limit")) : Number.POSITIVE_INFINITY;
const ONLY_SCENARIOS = new Set(
  (arg("--scenarios") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const WATCHDOG_MS = Number(arg("--timeout-ms", "90000"));
const AUDIO_DIR = resolve(OUT_DIR, "audio");

const GLOBAL_FORBIDDEN = [
  "よろしくお願いします",
  "お願いします",
  "助かります",
  "何か他に",
  "ご質問があれば",
  "具体的に知りたい部分があれば",
  "そこまで詳しく聞きたいですか",
  "このあたりで大丈夫でしょうか",
  "進めていただけますか",
  "はい、それでお願いします",
  "即決",
  "プロンプト",
  "システム",
  "できません",
  "指示にないので",
  "お気軽に",
  "整理します",
  "整理させてください",
  "採点",
  "総合評価",
];

const PY_XLSX_EXPORT = String.raw`
from pathlib import Path
import json
import re
import sys

try:
    import openpyxl
except Exception as exc:
    print(f"openpyxl import failed: {exc}", file=sys.stderr)
    sys.exit(2)

xlsx = Path(sys.argv[1])
out_path = Path(sys.argv[2])
out_path.parent.mkdir(parents=True, exist_ok=True)
wb = openpyxl.load_workbook(xlsx, data_only=True)

def split_field(value):
    if value is None:
        return []
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return []
    return [item.strip() for item in re.split(r"\s*\|\s*|\r?\n", text) if item.strip()]

turn_ws = wb["02_Turn_Cases"]
headers = [cell.value for cell in turn_ws[1]]
cases = []
for row in turn_ws.iter_rows(min_row=2, values_only=True):
    if not any(row):
        continue
    data = {headers[i]: row[i] for i in range(len(headers))}
    text = str(data.get("営業発話") or "").strip()
    stt = str(data.get("STT揺れ例") or "").strip()
    cases.append({
        "caseId": str(data.get("Case_ID") or "").strip(),
        "scenarioId": str(data.get("Scenario_ID") or "").strip(),
        "runTier": str(data.get("Run_Tier") or "").strip(),
        "priority": str(data.get("Priority") or "").strip(),
        "turnNo": int(data.get("Turn_No") or 0),
        "phase": str(data.get("Phase") or "").strip(),
        "inputText": stt if stt and stt.lower() != "none" else text,
        "expectedPolicy": str(data.get("期待応答方針") or "").strip(),
        "mustIncludeAll": split_field(data.get("Must_Include_All")),
        "mustIncludeAny": split_field(data.get("Must_Include_Any")),
        "mustNotInclude": split_field(data.get("Must_Not_Include")),
        "forbiddenPhrases": split_field(data.get("Forbidden_Phrases")),
        "maxSentences": int(data.get("Max_Sentences") or 2),
    })

scenario_ws = wb["01_E2E_Scenarios"]
headers = [cell.value for cell in scenario_ws[1]]
scenarios = []
for row in scenario_ws.iter_rows(min_row=2, values_only=True):
    if not any(row):
        continue
    data = {headers[i]: row[i] for i in range(len(headers))}
    scenarios.append({
        "scenarioId": str(data.get("Scenario_ID") or "").strip(),
        "runTier": str(data.get("Run_Tier") or "").strip(),
        "priority": str(data.get("Priority") or "").strip(),
        "name": str(data.get("Scenario_Name") or "").strip(),
        "turnCount": int(data.get("Turn_Count") or 0),
        "order": int(data.get("推奨実行順") or 0),
    })

payload = {
    "source": str(xlsx),
    "scenarioCount": len(scenarios),
    "caseCount": len(cases),
    "p0Count": sum(1 for item in cases if item["priority"] == "P0"),
    "smokeCount": sum(1 for item in cases if "Smoke" in item["runTier"]),
    "scenarios": scenarios,
    "cases": cases,
}
out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(out_path)
`;

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(AUDIO_DIR, { recursive: true });
  const casesJson = await resolveCasesJson();
  const casesFile = JSON.parse(await readFile(casesJson, "utf8")) as CasesFile;
  if (process.argv.includes("--export-only")) {
    console.info(`[v50.4-voice-e2e] exported cases: ${casesJson}`);
    console.info(
      `[v50.4-voice-e2e] scenarios=${casesFile.scenarios.length} cases=${casesFile.cases.length}`
    );
    return;
  }
  const selectedScenarios = selectScenarios(casesFile);
  const selectedCases = casesFile.cases.filter((item) =>
    selectedScenarios.some((scenario) => scenario.scenarioId === item.scenarioId)
  );
  await writeFile(resolve(OUT_DIR, "selected-cases.json"), JSON.stringify(selectedCases, null, 2), "utf8");
  await ensureAudioFixtures(selectedCases);

  const demoToken = resolveDemoToken();
  if (!demoToken) {
    throw new Error("BLOCKED: DEMO_ACCESS_TOKEN not available.");
  }

  const outcomes: ScenarioOutcome[] = [];
  for (const scenario of selectedScenarios) {
    const turns = selectedCases
      .filter((item) => item.scenarioId === scenario.scenarioId)
      .sort((a, b) => a.turnNo - b.turnNo);
    console.info(`[v50.4-voice-e2e] ${scenario.scenarioId} ${scenario.name} (${turns.length} turns)`);
    const session = await fetchSession(demoToken);
    validateSession(session);
    const outcome = await runScenario({ scenario, turns, session });
    outcomes.push(outcome);
    await writeFile(resolve(OUT_DIR, `${scenario.scenarioId}.json`), JSON.stringify(outcome, null, 2), "utf8");
  }

  const allTurns = outcomes.flatMap((scenario) => scenario.turns);
  const failedTurns = allTurns.filter((turn) => !turn.pass);
  const p0Turns = allTurns.filter((turn) => turn.priority === "P0");
  const p0Failed = p0Turns.filter((turn) => !turn.pass);
  const forbiddenHits = allTurns.flatMap((turn) =>
    turn.failures.filter((failure) => failure.startsWith("forbidden:")).map((failure) => `${turn.caseId}:${failure}`)
  );
  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    tier: TIER,
    sourceWorkbook: casesFile.source,
    scenarioCount: outcomes.length,
    turnCount: allTurns.length,
    passedTurnCount: allTurns.length - failedTurns.length,
    failedTurnCount: failedTurns.length,
    passRate: ratio(allTurns.length - failedTurns.length, allTurns.length),
    p0TurnCount: p0Turns.length,
    p0FailedTurnCount: p0Failed.length,
    p0PassRate: ratio(p0Turns.length - p0Failed.length, p0Turns.length),
    forbiddenHitCount: forbiddenHits.length,
    forbiddenHits,
    firstAudioDeltaMs: percentileSummary(allTurns.map((turn) => turn.firstAudioDeltaMs).filter(isNumber)),
    doneMs: percentileSummary(allTurns.map((turn) => turn.doneMs).filter(isNumber)),
    sessionIdentity: outcomes[0]?.session ?? null,
    productionContract: {
      demoSlug: outcomes[0]?.session.demoSlug ?? null,
      backend: outcomes[0]?.session.backend ?? null,
      promptVersion: outcomes[0]?.session.promptVersion ?? null,
      model: outcomes[0]?.session.model ?? null,
      voiceId: outcomes[0]?.session.voiceId ?? null,
      browserTokenExposed: false,
      ephemeralTokenOmitted: true,
      registeredSpeechOmitted: true,
      lockedResponseAudioBundleOmitted: true,
    },
    pass: failedTurns.length === 0 && outcomes.every((scenario) => scenario.pass),
    scenarios: outcomes.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      name: scenario.name,
      pass: scenario.pass,
      turnCount: scenario.turns.length,
      failedTurnCount: scenario.turns.filter((turn) => !turn.pass).length,
      failures: scenario.failures,
    })),
    failedTurns,
  };
  await writeFile(resolve(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(resolve(OUT_DIR, "report.md"), renderReport(summary, outcomes), "utf8");
  console.info(`[v50.4-voice-e2e] out: ${OUT_DIR}`);
  console.info(`[v50.4-voice-e2e] ${summary.pass ? "PASS" : "FAIL"} ${summary.passedTurnCount}/${summary.turnCount}`);
  process.exit(summary.pass ? 0 : 1);
}

async function resolveCasesJson() {
  const explicitJson = arg("--cases-json");
  if (explicitJson) return explicitJson;
  const xlsxPath = arg("--xlsx");
  if (!xlsxPath) {
    throw new Error(
      "Usage: pnpm grok-first:v50:xlsx-voice-e2e -- --xlsx <test-cases.xlsx> [--tier smoke|core|full|p0]"
    );
  }
  const exportDir = resolve(OUT_DIR, "case-export");
  await mkdir(exportDir, { recursive: true });
  const outPath = resolve(exportDir, "cases.json");
  const py = process.env["PYTHON"] ?? "python";
  const result = spawnSync(py, ["-c", PY_XLSX_EXPORT, xlsxPath, outPath], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  await writeFile(resolve(OUT_DIR, "xlsx-export.stdout.txt"), result.stdout ?? "", "utf8");
  await writeFile(resolve(OUT_DIR, "xlsx-export.stderr.txt"), result.stderr ?? "", "utf8");
  if (result.status !== 0) {
    throw new Error(
      `BLOCKED: xlsx export failed. Ensure Python with openpyxl is available, or pass --cases-json. stderr=${result.stderr}`
    );
  }
  return outPath;
}

function selectScenarios(casesFile: CasesFile): ScenarioDef[] {
  let scenarios = [...casesFile.scenarios].sort((a, b) => a.order - b.order);
  if (ONLY_SCENARIOS.size > 0) {
    scenarios = scenarios.filter((scenario) => ONLY_SCENARIOS.has(scenario.scenarioId));
  } else if (TIER === "smoke") {
    const smokeScenarioIds = new Set(
      casesFile.cases.filter((item) => item.runTier.includes("Smoke")).map((item) => item.scenarioId)
    );
    scenarios = scenarios.filter((scenario) => smokeScenarioIds.has(scenario.scenarioId));
  } else if (TIER === "core") {
    const coreScenarioIds = new Set(
      casesFile.cases.filter((item) => item.runTier.includes("Core")).map((item) => item.scenarioId)
    );
    scenarios = scenarios.filter((scenario) => coreScenarioIds.has(scenario.scenarioId));
  } else if (TIER === "p0") {
    const p0ScenarioIds = new Set(
      casesFile.cases.filter((item) => item.priority === "P0").map((item) => item.scenarioId)
    );
    scenarios = scenarios.filter((scenario) => p0ScenarioIds.has(scenario.scenarioId));
  }
  return scenarios.slice(0, LIMIT);
}

async function ensureAudioFixtures(cases: CaseDef[]) {
  const missing = cases.filter((item) => !existsSync(audioPath(item)));
  if (missing.length === 0) return;
  const payloadPath = resolve(OUT_DIR, "tts-input.json");
  await writeFile(
    payloadPath,
    JSON.stringify(
      missing.map((item) => ({ id: item.caseId, text: item.inputText, path: audioPath(item) })),
      null,
      2
    ),
    "utf8"
  );
  const script = `
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 -LiteralPath '${escapePs(payloadPath)}' | ConvertFrom-Json
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 24000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($item in $items) {
  $dir = Split-Path -Parent $item.path
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice('Microsoft Haruka Desktop')
  $synth.Rate = 0
  $synth.Volume = 100
  $synth.SetOutputToWaveFile($item.path, $format)
  $synth.Speak($item.text)
  $synth.Dispose()
  Write-Output $item.id
}`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync("powershell", ["-NoProfile", "-EncodedCommand", encoded], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  await writeFile(resolve(OUT_DIR, "tts-generation.stdout.txt"), result.stdout ?? "", "utf8");
  await writeFile(resolve(OUT_DIR, "tts-generation.stderr.txt"), result.stderr ?? "", "utf8");
  if (result.status !== 0) {
    throw new Error(`SAPI TTS generation failed: ${result.stderr || result.stdout}`);
  }
}

async function fetchSession(demoToken: string): Promise<GrokSession> {
  const url = `${BASE_URL}/api/grok-first-v50-4/session`;
  const signature = createHmac("sha256", demoToken).update(demoToken).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      cookie: `roleplay_access=${signature}; roleplay_api_access=${signature}`,
      "content-type": "application/json",
      origin: BASE_URL,
      referer: `${BASE_URL}/demo/adecco-roleplay-v50-4`,
    },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`session fetch failed ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as GrokSession;
}

function validateSession(session: GrokSession) {
  const failures = [];
  if (session.demoSlug !== "adecco-roleplay-v50-4") failures.push(`demoSlug=${session.demoSlug}`);
  if (session.backend !== "grok-first-v50-4") failures.push(`backend=${session.backend}`);
  if (session.promptVersion !== "grok-first-v50.4-2026-05-15") failures.push(`promptVersion=${session.promptVersion}`);
  if (session.model !== "grok-voice-think-fast-1.0") failures.push(`model=${session.model}`);
  if (session.voiceId !== "99c95cc8a177") failures.push(`voiceId=${session.voiceId}`);
  if (session.ephemeralToken) failures.push("ephemeralToken_exposed");
  if (session.registeredSpeech) failures.push("registeredSpeech_present");
  if (session.lockedResponseAudioBundle) failures.push("lockedResponseAudioBundle_present");
  for (const needle of ["# v50.4", "STT Noise Handling", "候補者供給可能性", "終了", "フィードバック要求"]) {
    if (!session.instructions.includes(needle)) failures.push(`instructions_missing:${needle}`);
  }
  if (failures.length) throw new Error(`session contract failed: ${failures.join(", ")}`);
}

async function runScenario(input: {
  scenario: ScenarioDef;
  turns: CaseDef[];
  session: GrokSession;
}): Promise<ScenarioOutcome> {
  const turns: TurnOutcome[] = [];
  const failures: string[] = [];
  await new Promise<void>((resolveScenario) => {
    const ws = new WsClient(
      input.session.wsUrl,
      [
        input.session.realtimeAuth.protocol,
        `mendan-relay-ticket.${input.session.realtimeAuth.ticket}`,
      ],
      { headers: { Origin: BASE_URL } }
    );
    let turnIndex = -1;
    let active: TurnOutcome | null = null;
    let startedAt = 0;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    let sessionReady = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (watchdog) clearTimeout(watchdog);
      try {
        ws.close();
      } catch {
        // noop
      }
      resolveScenario();
    };
    const arm = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (active) {
          active.failures.push("timeout:response.done");
          active.pass = false;
          turns.push(active);
        } else {
          failures.push("timeout");
        }
        finish();
      }, WATCHDOG_MS);
    };
    const sendNext = () => {
      turnIndex += 1;
      if (turnIndex >= input.turns.length) {
        finish();
        return;
      }
      const def = input.turns[turnIndex]!;
      const pcm = parsePcm16Mono24kSync(audioPath(def));
      active = {
        caseId: def.caseId,
        scenarioId: def.scenarioId,
        turnNo: def.turnNo,
        priority: def.priority,
        userInputText: def.inputText,
        sttTranscript: "",
        assistantTranscript: "",
        firstAudioDeltaMs: null,
        doneMs: null,
        audioDeltaCount: 0,
        audioBytesApprox: 0,
        sentenceCount: 0,
        pass: false,
        failures: [],
      };
      startedAt = Date.now();
      arm();
      void streamAudioTurn(ws, pcm).catch((error) => {
        if (!active) return;
        active.failures.push(`audio_stream_error:${error instanceof Error ? error.message : String(error)}`);
      });
    };
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          voice: input.session.voiceId,
          instructions: input.session.instructions,
          tools: [],
          audio: {
            input: { format: { type: input.session.audio.inputFormat, rate: input.session.audio.sampleRate } },
            output: { format: { type: input.session.audio.outputFormat, rate: input.session.audio.sampleRate } },
          },
          turn_detection: input.session.turnDetection,
        },
      }));
    });
    ws.on("message", (raw) => {
      let event: { type?: string; transcript?: string; delta?: string; error?: { code?: string; message?: string } };
      try {
        event = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if ((event.type === "session.updated" || event.type === "session.created") && !sessionReady) {
        sessionReady = true;
      ws.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: input.session.firstMessage }],
        },
      }));
        setTimeout(sendNext, 700);
        return;
      }
      if (!active) return;
      if (event.type === "conversation.item.input_audio_transcription.completed") {
        active.sttTranscript = event.transcript ?? "";
      } else if (
        event.type === "response.audio_transcript.delta" ||
        event.type === "response.output_audio_transcript.delta" ||
        event.type === "response.text.delta"
      ) {
        active.assistantTranscript += event.delta ?? "";
      } else if (event.type === "response.output_audio.delta") {
        active.audioDeltaCount += 1;
        const delta = event.delta ?? "";
        active.audioBytesApprox += Math.floor((delta.length * 3) / 4);
        if (active.firstAudioDeltaMs === null) active.firstAudioDeltaMs = Date.now() - startedAt;
      } else if (event.type === "response.done") {
        active.doneMs = Date.now() - startedAt;
        evaluateTurn(input.turns[turnIndex]!, active);
        turns.push(active);
        active = null;
        setTimeout(sendNext, 500);
      } else if (event.type === "error") {
        active.failures.push(`api_error:${event.error?.code ?? "unknown"} ${event.error?.message ?? ""}`.trim());
        active.pass = false;
        turns.push(active);
        active = null;
        finish();
      }
    });
    ws.on("error", (error) => {
      failures.push(`ws_error:${error.message}`);
      finish();
    });
    ws.on("close", () => {
      if (!resolved && turns.length < input.turns.length) {
        failures.push(`closed_early:${turns.length}/${input.turns.length}`);
      }
      finish();
    });
  });
  return {
    scenarioId: input.scenario.scenarioId,
    name: input.scenario.name,
    runTier: input.scenario.runTier,
    priority: input.scenario.priority,
    session: {
      sessionId: input.session.sessionId,
      demoSlug: input.session.demoSlug,
      backend: input.session.backend,
      scenarioId: input.session.scenarioId,
      promptVersion: input.session.promptVersion,
      model: input.session.model,
      voiceId: input.session.voiceId,
    },
    turns,
    pass: failures.length === 0 && turns.every((turn) => turn.pass) && turns.length === input.turns.length,
    failures: [
      ...failures,
      ...turns.flatMap((turn) => turn.failures.map((failure) => `${turn.caseId}:${failure}`)),
      ...(turns.length === input.turns.length ? [] : [`turn_count:${turns.length}/${input.turns.length}`]),
    ],
  };
}

function evaluateTurn(def: CaseDef, outcome: TurnOutcome) {
  const text = normalizeText(outcome.assistantTranscript);
  if (!outcome.sttTranscript.trim()) outcome.failures.push("stt_empty");
  if (!text) outcome.failures.push("assistant_empty");
  if (outcome.audioDeltaCount <= 0) outcome.failures.push("audio_delta_missing");
  if (!(outcome.audioBytesApprox > 0)) outcome.failures.push("audio_bytes_missing");
  if (outcome.firstAudioDeltaMs === null) outcome.failures.push("first_audio_delta_missing");
  for (const needle of def.mustIncludeAll) {
    if (!text.includes(needle)) outcome.failures.push(`missing_all:${needle}`);
  }
  if (def.mustIncludeAny.length > 0 && !def.mustIncludeAny.some((needle) => text.includes(needle))) {
    outcome.failures.push(`missing_any:${def.mustIncludeAny.join("|")}`);
  }
  for (const needle of [...def.mustNotInclude, ...def.forbiddenPhrases, ...GLOBAL_FORBIDDEN]) {
    if (needle && text.includes(needle)) outcome.failures.push(`forbidden:${needle}`);
  }
  outcome.sentenceCount = countSentences(text);
  if (outcome.sentenceCount > def.maxSentences) {
    outcome.failures.push(`sentence_count:${outcome.sentenceCount}>${def.maxSentences}`);
  }
  outcome.assistantTranscript = text;
  outcome.pass = outcome.failures.length === 0;
}

function parsePcm16Mono24kSync(path: string) {
  const result = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `[Convert]::ToBase64String([IO.File]::ReadAllBytes('${escapePs(path)}'))`,
  ], { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`read wav failed ${path}: ${result.stderr}`);
  return parsePcm16Mono24k(Buffer.from(result.stdout.trim(), "base64"));
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
    throw new Error(`fixture must be PCM16 mono 24kHz (format=${audioFormat}, channels=${channels}, rate=${sampleRate}, bits=${bitsPerSample})`);
  }
  if (!data || data.length === 0) throw new Error("fixture has no data chunk");
  return data;
}

function* chunkBuffer(buffer: Buffer, chunkSize: number) {
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    yield buffer.subarray(offset, Math.min(buffer.length, offset + chunkSize));
  }
}

async function streamAudioTurn(ws: WsClient, pcm: Buffer) {
  for (const chunk of chunkBuffer(pcm, 4_800)) {
    if (ws.readyState !== WsClient.OPEN) return;
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }));
    await sleep(100);
  }
  const silence = Buffer.alloc(4_800);
  for (let i = 0; i < 10; i += 1) {
    if (ws.readyState !== WsClient.OPEN) return;
    ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: silence.toString("base64") }));
    await sleep(100);
  }
}

function audioPath(def: CaseDef) {
  return resolve(AUDIO_DIR, `${def.caseId}.wav`);
}

function resolveDemoToken() {
  const current = process.env["DEMO_ACCESS_TOKEN"];
  if (current && current.length >= 8 && !current.startsWith("test-")) return current;
  for (const project of [process.env["SECRET_SOURCE_PROJECT_ID"] ?? "zapier-transfer", "adecco-mendan"]) {
    for (const secret of ["DEMO_ACCESS_TOKEN", "demo-access-token"]) {
      const result = spawnSync(
        "powershell",
        ["-NoProfile", "-Command", `gcloud secrets versions access latest --secret=${secret} --project=${project}`],
        { encoding: "utf8", maxBuffer: 1024 * 1024 }
      );
      if (result.status === 0 && result.stdout.trim().length >= 8) {
        console.info(`[v50.4-voice-e2e] DEMO_ACCESS_TOKEN fetched from projects/${project}/secrets/${secret}`);
        return result.stdout.trim();
      }
    }
  }
  return "";
}

function renderReport(summary: {
  generatedAt: string;
  baseUrl: string;
  tier: string;
  sourceWorkbook: string;
  scenarioCount: number;
  turnCount: number;
  passedTurnCount: number;
  failedTurnCount: number;
  passRate: number;
  p0TurnCount: number;
  p0FailedTurnCount: number;
  p0PassRate: number;
  forbiddenHitCount: number;
  firstAudioDeltaMs: ReturnType<typeof percentileSummary>;
  doneMs: ReturnType<typeof percentileSummary>;
  pass: boolean;
  failedTurns: TurnOutcome[];
}, outcomes: ScenarioOutcome[]) {
  const lines = [
    "# v50.4 Voice E2E Report",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- baseUrl: ${summary.baseUrl}`,
    `- workbook: ${summary.sourceWorkbook}`,
    `- tier: ${summary.tier}`,
    `- result: ${summary.pass ? "PASS" : "FAIL"}`,
    `- scenarios: ${summary.scenarioCount}`,
    `- turns: ${summary.passedTurnCount}/${summary.turnCount} passed (${Math.round(summary.passRate * 1000) / 10}%)`,
    `- P0: ${summary.p0TurnCount - summary.p0FailedTurnCount}/${summary.p0TurnCount} passed (${Math.round(summary.p0PassRate * 1000) / 10}%)`,
    `- forbidden hits: ${summary.forbiddenHitCount}`,
    `- firstAudioDeltaMs p50/p95: ${summary.firstAudioDeltaMs.p50 ?? "n/a"} / ${summary.firstAudioDeltaMs.p95 ?? "n/a"}`,
    `- doneMs p50/p95: ${summary.doneMs.p50 ?? "n/a"} / ${summary.doneMs.p95 ?? "n/a"}`,
    "",
    "## Scenario Results",
    "",
    ...outcomes.map((scenario) => {
      const failed = scenario.turns.filter((turn) => !turn.pass);
      return `- ${scenario.scenarioId} ${scenario.name}: ${scenario.pass ? "PASS" : "FAIL"} (${scenario.turns.length - failed.length}/${scenario.turns.length})`;
    }),
    "",
    "## Failed Turns",
    "",
    ...(summary.failedTurns.length === 0
      ? ["- none"]
      : summary.failedTurns.flatMap((turn) => [
          `### ${turn.caseId} ${turn.pass ? "PASS" : "FAIL"}`,
          `- failures: ${turn.failures.join("; ")}`,
          `- user: ${turn.userInputText}`,
          `- stt: ${turn.sttTranscript || "(empty)"}`,
          `- assistant: ${turn.assistantTranscript || "(empty)"}`,
          "",
        ])),
  ];
  return lines.join("\n");
}

function arg(flag: string, fallback?: string) {
  const idx = process.argv.findIndex((value) => value === flag);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function escapePs(value: string) {
  return value.replace(/'/g, "''");
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function countSentences(value: string) {
  const text = value.trim();
  if (!text) return 0;
  const matches = text.match(/[。！？!?]+/g);
  return matches ? matches.length : 1;
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
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

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
