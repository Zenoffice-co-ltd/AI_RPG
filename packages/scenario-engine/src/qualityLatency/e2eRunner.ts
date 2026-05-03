import { readFile, mkdir, writeFile } from "node:fs/promises";
import Papa from "papaparse";
import { dirname, resolve } from "node:path";
import type {
  TtsOutputFormat,
  TtsProvider,
  TtsProviderId,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from "@top-performer/vendors";
import { qualityLatencyCases } from "./cases";
import { buildE2eCsv, buildE2eSummaryCsv } from "./csvWriters";
import type {
  E2eRow,
  JudgeScoreRow,
  QualityLatencyCase,
  RuleScoreRow,
} from "./types";

type LlmTextEntry = {
  runId: string;
  model: string;
  caseId: string;
  repeatIndex: number;
  responseText: string;
  firstSentenceText: string;
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
};

export type E2eRunInput = {
  runId: string;
  outputDir: string;
  llmTextEntries: readonly LlmTextEntry[];
  ttsProviders: readonly TtsProviderId[];
  modes: readonly ("first-sentence" | "full-text")[];
  repeats: number;
  cases?: readonly QualityLatencyCase[];
  outputFormat?: TtsOutputFormat;
  sampleRateHz?: number;
  ttsTimeoutMs?: number;
  judgeRows?: readonly JudgeScoreRow[];
  ruleRows?: readonly RuleScoreRow[];
  providerFactories: Partial<Record<TtsProviderId, () => TtsProvider>>;
};

export type E2eRunResult = {
  runId: string;
  e2eCsvPath: string;
  e2eSummaryCsvPath: string;
  audioDir: string;
  totalRows: number;
  failures: number;
};

function fileExtensionForFormat(format: string): string {
  if (format === "wav" || format === "pcm_s16le") return "wav";
  if (format === "mp3") return "mp3";
  if (format === "ogg_opus") return "ogg";
  return "bin";
}

function defaultTtsModelFor(provider: TtsProviderId): string {
  switch (provider) {
    case "openai":
      return process.env["OPENAI_TTS_MODEL"] ?? "gpt-4o-mini-tts";
    case "cartesia":
      return process.env["CARTESIA_TTS_MODEL"] ?? "sonic-3";
    case "inworld":
      return process.env["INWORLD_TTS_MODEL"] ?? "inworld-tts-1.5-mini";
    case "fish":
      return process.env["FISH_TTS_MODEL"] ?? "s2-pro";
    case "google_gemini":
      return process.env["GOOGLE_TTS_MODEL"] ?? "gemini-2.5-flash-preview-tts";
    case "elevenlabs_baseline":
      return process.env["DEFAULT_ELEVEN_MODEL"] ?? "eleven_v3";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive as string;
    }
  }
}

async function resolveProvider(
  id: TtsProviderId,
  factories: E2eRunInput["providerFactories"]
): Promise<TtsProvider> {
  const factory = factories[id];
  if (!factory) {
    throw new Error(`No factory registered for tts provider "${id}"`);
  }
  return factory();
}

function indexJudgeAvg(rows: readonly JudgeScoreRow[]): Map<string, number> {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    if (r.status !== "success" || r.overallScore === null) continue;
    const key = `${r.caseId}|${r.candidateProvider}|${r.candidateModel}|${r.repeatIndex}`;
    const arr = map.get(key) ?? [];
    arr.push(r.overallScore);
    map.set(key, arr);
  }
  const out = new Map<string, number>();
  for (const [key, arr] of map) {
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    out.set(key, avg);
  }
  return out;
}

function indexRule(rows: readonly RuleScoreRow[]): Map<string, RuleScoreRow> {
  const out = new Map<string, RuleScoreRow>();
  for (const r of rows) {
    out.set(`${r.caseId}|${r.provider}|${r.model}|${r.repeatIndex}`, r);
  }
  return out;
}

export async function runE2e(input: E2eRunInput): Promise<E2eRunResult> {
  const audioDir = resolve(input.outputDir, "audio");
  await mkdir(audioDir, { recursive: true });
  const sampleRateHz = input.sampleRateHz ?? 24_000;
  const outputFormat = input.outputFormat ?? "pcm_s16le";
  const ttsTimeoutMs = input.ttsTimeoutMs ?? 30_000;
  const cases = input.cases ?? qualityLatencyCases;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const judgeAvg = indexJudgeAvg(input.judgeRows ?? []);
  const ruleByKey = indexRule(input.ruleRows ?? []);

  const llmEntries = filterLlmEntries(input.llmTextEntries, input.repeats);

  // Resolve TTS providers up front.
  const providerSlots = new Map<
    TtsProviderId,
    { provider: TtsProvider | null; error: string | null }
  >();
  for (const id of input.ttsProviders) {
    try {
      const provider = await resolveProvider(id, input.providerFactories);
      providerSlots.set(id, { provider, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      providerSlots.set(id, { provider: null, error: message });
    }
  }

  const rows: E2eRow[] = [];
  const fullTextE2eByKey = new Map<string, number>();

  for (const entry of llmEntries) {
    const caseDef = caseById.get(entry.caseId);
    if (!caseDef) continue;
    const llmKey = `${entry.caseId}|${entry.repeatIndex}`;
    const candidateModelKey = entry.model;
    const [llmProvider, llmModel] = candidateModelKey.split(":") as [string, string];

    for (const ttsProviderId of input.ttsProviders) {
      const slot = providerSlots.get(ttsProviderId);
      const ttsModel = defaultTtsModelFor(ttsProviderId);

      for (const mode of input.modes) {
        const ttsInputText =
          mode === "first-sentence" ? entry.firstSentenceText : entry.responseText;

        const baseRow: E2eRow = {
          runId: input.runId,
          llmProvider,
          llmModel,
          ttsProvider: ttsProviderId,
          ttsModel,
          voiceId: "",
          mode,
          caseId: entry.caseId,
          repeatIndex: entry.repeatIndex,
          status: "failed",
          llmRequestToFirstSentenceMs: entry.llmRequestToFirstSentenceMs,
          llmRequestToDoneMs: entry.llmRequestToDoneMs,
          ttsRequestToFirstAudioMs: null,
          ttsRequestToDoneMs: null,
          audioDurationMs: null,
          rtf: null,
          firstAudioAvailable: false,
          e2eFirstAudioMs: null,
          e2eDoneMs: null,
          overlapGainMs: null,
          ttsInputMode: mode === "first-sentence" ? "first-sentence" : "full-text",
          ttsInputChars: ttsInputText.length,
          qualityScore: judgeAvg.get(`${entry.caseId}|${llmProvider}|${llmModel}|${entry.repeatIndex}`) ?? null,
          rulePass: ruleByKey.get(`${entry.caseId}|${llmProvider}|${llmModel}|${entry.repeatIndex}`)?.rulePass ?? null,
          knockout: ruleByKey.get(`${entry.caseId}|${llmProvider}|${llmModel}|${entry.repeatIndex}`)?.knockout ?? null,
          outputFile: "",
          errorCode: "",
          errorMessage: "",
          vendorRequestId: "",
        };

        if (!slot?.provider) {
          rows.push({
            ...baseRow,
            errorCode: "FACTORY_ERROR",
            errorMessage: slot?.error ?? "no provider",
          });
          continue;
        }
        if (ttsInputText.length === 0) {
          rows.push({
            ...baseRow,
            errorCode: "EMPTY_TTS_INPUT",
            errorMessage:
              mode === "first-sentence"
                ? "first-sentence text empty"
                : "response text empty",
          });
          continue;
        }

        const synthesisInput: TtsSynthesisInput = {
          provider: ttsProviderId,
          model: ttsModel,
          text: ttsInputText,
          language: "ja",
          outputFormat,
          sampleRateHz,
          timeoutMs: ttsTimeoutMs,
        };

        let result: TtsSynthesisResult;
        try {
          result = await slot.provider.synthesize(synthesisInput);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rows.push({
            ...baseRow,
            errorCode: "VENDOR_THROW",
            errorMessage: message,
          });
          continue;
        }

        const voiceId = result.voiceId ?? "";
        const repeatLabel = String(entry.repeatIndex).padStart(2, "0");
        const ext = fileExtensionForFormat(result.format);
        const llmSlug = candidateModelKey.replace(/[^a-zA-Z0-9]+/g, "-");
        const fileName = `${llmSlug}__${ttsProviderId}__${mode}__${entry.caseId}__r${repeatLabel}.${ext}`;
        const outputFile = resolve(audioDir, fileName);
        if (result.success && result.audio) {
          await writeFile(outputFile, result.audio);
        }

        const ttsFirst = result.requestToFirstAudioMs;
        const ttsDone = result.requestToLastAudioMs;
        const llmFirstSent = entry.llmRequestToFirstSentenceMs;
        const llmDone = entry.llmRequestToDoneMs;
        let e2eFirst: number | null = null;
        let e2eDone: number | null = null;
        if (mode === "full-text") {
          if (llmDone !== null && ttsFirst !== null) e2eFirst = llmDone + ttsFirst;
          if (llmDone !== null && ttsDone !== null) e2eDone = llmDone + ttsDone;
        } else {
          if (llmFirstSent !== null && ttsFirst !== null) e2eFirst = llmFirstSent + ttsFirst;
        }
        const completed: E2eRow = {
          ...baseRow,
          voiceId,
          ttsModel: result.model,
          status: result.success ? "success" : "failed",
          ttsRequestToFirstAudioMs: ttsFirst,
          ttsRequestToDoneMs: ttsDone,
          audioDurationMs: result.audioDurationMs,
          rtf: result.rtf,
          firstAudioAvailable: ttsFirst !== null,
          e2eFirstAudioMs: e2eFirst,
          e2eDoneMs: e2eDone,
          outputFile: result.success ? outputFile : "",
          errorCode: result.errorCode ?? "",
          errorMessage: result.errorMessage ?? "",
          vendorRequestId: result.vendorRequestId ?? "",
        };

        if (mode === "full-text" && e2eFirst !== null) {
          fullTextE2eByKey.set(`${llmKey}|${ttsProviderId}|${candidateModelKey}`, e2eFirst);
        }
        rows.push(completed);
      }
    }
  }

  // backfill overlapGain
  for (const row of rows) {
    if (row.mode !== "first-sentence" || row.e2eFirstAudioMs === null) continue;
    const candidateModelKey = `${row.llmProvider}:${row.llmModel}`;
    const k = `${row.caseId}|${row.repeatIndex}|${row.ttsProvider}|${candidateModelKey}`;
    const fullText = fullTextE2eByKey.get(k);
    if (fullText !== undefined) {
      row.overlapGainMs = fullText - row.e2eFirstAudioMs;
    }
  }

  const e2eCsvPath = resolve(input.outputDir, "e2e-metrics.csv");
  const e2eSummaryCsvPath = resolve(input.outputDir, "e2e-summary.csv");
  await mkdir(dirname(e2eCsvPath), { recursive: true });
  await writeFile(e2eCsvPath, `${buildE2eCsv(rows)}\n`, "utf8");
  await writeFile(e2eSummaryCsvPath, `${buildE2eSummaryCsv(rows)}\n`, "utf8");

  return {
    runId: input.runId,
    e2eCsvPath,
    e2eSummaryCsvPath,
    audioDir,
    totalRows: rows.length,
    failures: rows.filter((r) => r.status === "failed").length,
  };
}

function filterLlmEntries(
  entries: readonly LlmTextEntry[],
  repeats: number
): LlmTextEntry[] {
  return entries.filter((e) => e.repeatIndex >= 1 && e.repeatIndex <= repeats);
}

export async function loadLlmTextEntries(
  llmTextDir: string
): Promise<LlmTextEntry[]> {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(llmTextDir);
  const out: LlmTextEntry[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const content = await readFile(resolve(llmTextDir, f), "utf8");
    try {
      const j = JSON.parse(content);
      if (typeof j === "object" && j !== null) {
        out.push(j as LlmTextEntry);
      }
    } catch {
      // skip
    }
  }
  return out;
}

export async function loadJudgeScoresCsv(path: string): Promise<JudgeScoreRow[]> {
  const text = await readFile(path, "utf8");
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.map((r) => ({
    runId: r["runId"] ?? "",
    caseId: r["caseId"] ?? "",
    candidateProvider: r["candidateProvider"] ?? "",
    candidateModel: r["candidateModel"] ?? "",
    repeatIndex: Number(r["repeatIndex"] ?? 0),
    judgeProvider: r["judgeProvider"] ?? "",
    judgeModel: r["judgeModel"] ?? "",
    status: (r["status"] === "success" ? "success" : "failed") as "success" | "failed",
    overallScore: r["overallScore"] === "" ? null : Number(r["overallScore"]),
    intentFit: r["intentFit"] === "" ? null : Number(r["intentFit"]),
    businessCorrectness: r["businessCorrectness"] === "" ? null : Number(r["businessCorrectness"]),
    nextAction: r["nextAction"] === "" ? null : Number(r["nextAction"]),
    conciseness: r["conciseness"] === "" ? null : Number(r["conciseness"]),
    japaneseNaturalness: r["japaneseNaturalness"] === "" ? null : Number(r["japaneseNaturalness"]),
    voiceReadiness: r["voiceReadiness"] === "" ? null : Number(r["voiceReadiness"]),
    penalties: r["penalties"] ?? "",
    knockout: r["knockout"] === "true",
    knockoutReason: r["knockoutReason"] ?? "",
    shortRationale: r["shortRationale"] ?? "",
    errorMessage: r["errorMessage"] ?? "",
  }));
}

export async function loadRuleScoresCsv(path: string): Promise<RuleScoreRow[]> {
  const text = await readFile(path, "utf8");
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.map((r) => ({
    runId: r["runId"] ?? "",
    caseId: r["caseId"] ?? "",
    provider: r["provider"] ?? "",
    model: r["model"] ?? "",
    repeatIndex: Number(r["repeatIndex"] ?? 0),
    responseChars: Number(r["responseChars"] ?? 0),
    responseSentences: Number(r["responseSentences"] ?? 0),
    tooLong: r["tooLong"] === "true",
    hasBullet: r["hasBullet"] === "true",
    hasMetaLeak: r["hasMetaLeak"] === "true",
    missingMustInclude: r["missingMustInclude"] ?? "",
    containsMustNotInclude: r["containsMustNotInclude"] ?? "",
    hasUnsupportedClaim: r["hasUnsupportedClaim"] === "true",
    voiceUnfriendlySymbols: r["voiceUnfriendlySymbols"] === "true",
    rulePenalty: Number(r["rulePenalty"] ?? 0),
    rulePass: r["rulePass"] === "true",
    knockout: r["knockout"] === "true",
  }));
}

export async function loadE2eMetricsCsv(path: string): Promise<E2eRow[]> {
  const text = await readFile(path, "utf8");
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.map((r) => ({
    runId: r["runId"] ?? "",
    llmProvider: r["llmProvider"] ?? "",
    llmModel: r["llmModel"] ?? "",
    ttsProvider: (r["ttsProvider"] ?? "") as E2eRow["ttsProvider"],
    ttsModel: r["ttsModel"] ?? "",
    voiceId: r["voiceId"] ?? "",
    mode: (r["mode"] === "full-text" ? "full-text" : "first-sentence") as
      | "first-sentence"
      | "full-text",
    caseId: r["caseId"] ?? "",
    repeatIndex: Number(r["repeatIndex"] ?? 0),
    status: (r["status"] === "success" ? "success" : "failed") as "success" | "failed",
    llmRequestToFirstSentenceMs:
      r["llmRequestToFirstSentenceMs"] === "" ? null : Number(r["llmRequestToFirstSentenceMs"]),
    llmRequestToDoneMs:
      r["llmRequestToDoneMs"] === "" ? null : Number(r["llmRequestToDoneMs"]),
    ttsRequestToFirstAudioMs:
      r["ttsRequestToFirstAudioMs"] === "" ? null : Number(r["ttsRequestToFirstAudioMs"]),
    ttsRequestToDoneMs:
      r["ttsRequestToDoneMs"] === "" ? null : Number(r["ttsRequestToDoneMs"]),
    audioDurationMs:
      r["audioDurationMs"] === "" ? null : Number(r["audioDurationMs"]),
    rtf: r["rtf"] === "" ? null : Number(r["rtf"]),
    firstAudioAvailable: r["firstAudioAvailable"] === "true",
    e2eFirstAudioMs:
      r["e2eFirstAudioMs"] === "" ? null : Number(r["e2eFirstAudioMs"]),
    e2eDoneMs: r["e2eDoneMs"] === "" ? null : Number(r["e2eDoneMs"]),
    overlapGainMs:
      r["overlapGainMs"] === "" ? null : Number(r["overlapGainMs"]),
    ttsInputMode: r["ttsInputMode"] ?? "",
    ttsInputChars:
      r["ttsInputChars"] === "" ? null : Number(r["ttsInputChars"]),
    qualityScore: r["qualityScore"] === "" ? null : Number(r["qualityScore"]),
    rulePass: r["rulePass"] === "" ? null : r["rulePass"] === "true",
    knockout: r["knockout"] === "" ? null : r["knockout"] === "true",
    outputFile: r["outputFile"] ?? "",
    errorCode: r["errorCode"] ?? "",
    errorMessage: r["errorMessage"] ?? "",
    vendorRequestId: r["vendorRequestId"] ?? "",
  }));
}

export async function loadMetricsCsv(path: string): Promise<import("./types").QualityLatencyRow[]> {
  const text = await readFile(path, "utf8");
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.map((r) => ({
    runId: r["runId"] ?? "",
    timestamp: r["timestamp"] ?? "",
    provider: r["provider"] ?? "",
    model: r["model"] ?? "",
    modelCategory: r["modelCategory"] ?? "",
    reasoningEffort: r["reasoningEffort"] ?? "",
    caseId: r["caseId"] ?? "",
    caseCategory: r["caseCategory"] ?? "",
    userInput: r["userInput"] ?? "",
    repeatIndex: Number(r["repeatIndex"] ?? 0),
    status: (r["status"] === "success" ? "success" : "failed") as "success" | "failed",
    llmRequestToFirstTokenMs: r["llmRequestToFirstTokenMs"] === "" ? null : Number(r["llmRequestToFirstTokenMs"]),
    llmRequestToFirstSentenceMs: r["llmRequestToFirstSentenceMs"] === "" ? null : Number(r["llmRequestToFirstSentenceMs"]),
    llmRequestToDoneMs: r["llmRequestToDoneMs"] === "" ? null : Number(r["llmRequestToDoneMs"]),
    llmOutputChars: r["llmOutputChars"] === "" ? null : Number(r["llmOutputChars"]),
    llmOutputSentences: r["llmOutputSentences"] === "" ? null : Number(r["llmOutputSentences"]),
    llmOutputCharsPerSec: r["llmOutputCharsPerSec"] === "" ? null : Number(r["llmOutputCharsPerSec"]),
    firstSentenceText: r["firstSentenceText"] ?? "",
    responseText: r["responseText"] ?? "",
    temperature: r["temperature"] === "" ? null : Number(r["temperature"]),
    maxOutputTokens: r["maxOutputTokens"] === "" ? null : Number(r["maxOutputTokens"]),
    seed: r["seed"] === "" ? null : Number(r["seed"]),
    errorCode: r["errorCode"] ?? "",
    errorMessage: r["errorMessage"] ?? "",
    vendorRequestId: r["vendorRequestId"] ?? "",
  }));
}
