import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  TtsOutputFormat,
  TtsProvider,
  TtsProviderId,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from "@top-performer/vendors";
import { loadBenchmarkUtterances } from "../benchmarkRenderer";
import { REPO_ROOT } from "../voiceProfiles";
import {
  buildMetricsCsv,
  buildReviewSheetCsv,
  buildSummaryCsv,
  summarizeRows,
} from "./csvWriters";
import { buildProviderBenchmarkIndexHtml } from "./indexHtml";
import type { BenchmarkMode, BenchmarkRow } from "./types";

const DEFAULT_UTTERANCE_CSV = resolve(
  REPO_ROOT,
  "data",
  "voice-benchmark",
  "utterances_ja_busy_manager_sanity.csv"
);
const DEFAULT_OUTPUT_ROOT = resolve(
  REPO_ROOT,
  "data",
  "generated",
  "tts-provider-benchmark"
);
const WARMUP_TEXT = "テスト";

export type ProviderFactory = () => TtsProvider;

export type ProviderBenchmarkInput = {
  providers: TtsProviderId[];
  utteranceCsvPath?: string;
  outputDir?: string;
  repeats?: number;
  sampleRateHz?: number;
  mode?: BenchmarkMode;
  timeoutMs?: number;
  includeElevenLabsBaseline?: boolean;
  outputFormat?: TtsOutputFormat;
  providerFactories?: Partial<Record<TtsProviderId, ProviderFactory>>;
};

export type ProviderBenchmarkResult = {
  runId: string;
  outputDir: string;
  manifestPath: string;
  metricsCsvPath: string;
  summaryCsvPath: string;
  reviewSheetPath: string;
  indexPath: string;
  totalCalls: number;
  failures: number;
};

function createRunId(): string {
  const isoCompact = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace(/-/g, "");
  return `mvp-${isoCompact}`;
}

function fileExtensionForFormat(format: string): string {
  if (format === "wav" || format === "pcm_s16le") return "wav";
  if (format === "mp3") return "mp3";
  if (format === "ogg_opus") return "ogg";
  if (format === "raw" || format.startsWith("raw")) return "raw";
  return "bin";
}

function hiddenIdFor(runId: string, provider: string, voiceId: string): string {
  return createHash("sha1")
    .update(`${runId}|${provider}|${voiceId}`)
    .digest("hex")
    .slice(0, 8);
}

function buildProviderList(
  input: ProviderBenchmarkInput
): TtsProviderId[] {
  const set = new Set<TtsProviderId>(input.providers);
  if (input.includeElevenLabsBaseline) {
    set.add("elevenlabs_baseline");
  }
  return [...set];
}

async function resolveProvider(
  id: TtsProviderId,
  factories: ProviderBenchmarkInput["providerFactories"]
): Promise<TtsProvider> {
  const factory = factories?.[id];
  if (factory) {
    return factory();
  }
  // Lazy default factory loader so the runner can be unit-tested without
  // requiring the real vendor SDKs to compile.
  const tts = await import("@top-performer/vendors");
  switch (id) {
    case "openai":
      return new tts.OpenAiTtsProvider();
    case "cartesia":
      return new tts.CartesiaTtsProvider();
    case "inworld":
      return new tts.InworldTtsProvider();
    case "fish":
      return new tts.FishTtsProvider();
    case "google_gemini":
      return new tts.GoogleGeminiTtsProvider();
    case "elevenlabs_baseline":
      return new tts.ElevenLabsBaselineTtsProvider();
    default: {
      const _exhaustive: never = id;
      throw new Error(`No factory for provider ${_exhaustive as string}`);
    }
  }
}

export async function runProviderBenchmark(
  input: ProviderBenchmarkInput
): Promise<ProviderBenchmarkResult> {
  const runId = createRunId();
  const outputDir = input.outputDir ?? resolve(DEFAULT_OUTPUT_ROOT, runId);
  const audioDir = resolve(outputDir, "audio");
  const utteranceCsvPath = input.utteranceCsvPath ?? DEFAULT_UTTERANCE_CSV;
  const repeats = Math.max(1, input.repeats ?? 1);
  const sampleRateHz = input.sampleRateHz ?? 24_000;
  const mode: BenchmarkMode = input.mode ?? "warm";
  const outputFormat: TtsOutputFormat = input.outputFormat ?? "pcm_s16le";
  const timeoutMs = input.timeoutMs ?? 30_000;

  const utterances = await loadBenchmarkUtterances(utteranceCsvPath);
  await mkdir(audioDir, { recursive: true });

  const providers = buildProviderList(input);
  const rows: BenchmarkRow[] = [];

  for (const providerId of providers) {
    let provider: TtsProvider;
    try {
      provider = await resolveProvider(providerId, input.providerFactories);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const utterance of utterances) {
        for (let r = 1; r <= repeats; r += 1) {
          rows.push(
            buildFailureRow({
              runId,
              providerId,
              model: "",
              voiceId: "",
              utterance,
              repeatIndex: r,
              mode,
              sampleRateHz,
              format: outputFormat,
              errorCode: "FACTORY_ERROR",
              errorMessage: message,
            })
          );
        }
      }
      continue;
    }

    if (mode === "warm") {
      try {
        await provider.synthesize({
          provider: providerId,
          model: defaultModelFor(providerId),
          text: WARMUP_TEXT,
          language: "ja",
          outputFormat,
          sampleRateHz,
          timeoutMs,
        });
      } catch {
        // Ignore warmup errors; the failure will surface in the real call below.
      }
    }

    for (const utterance of utterances) {
      for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
        const timestamp = new Date().toISOString();
        const synthesisInput: TtsSynthesisInput = {
          provider: providerId,
          model: defaultModelFor(providerId),
          text: utterance.utterance,
          language: "ja",
          outputFormat,
          sampleRateHz,
          timeoutMs,
        };

        let result: TtsSynthesisResult;
        try {
          result = await provider.synthesize(synthesisInput);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rows.push(
            buildFailureRow({
              runId,
              providerId,
              model: synthesisInput.model,
              voiceId: synthesisInput.voiceId ?? "",
              utterance,
              repeatIndex,
              mode,
              sampleRateHz,
              format: outputFormat,
              errorCode: "VENDOR_THROW",
              errorMessage: message,
            })
          );
          continue;
        }

        const voiceId = result.voiceId ?? synthesisInput.voiceId ?? "";
        const repeatLabel = String(repeatIndex).padStart(2, "0");
        const ext = fileExtensionForFormat(result.format);
        const fileName = `${providerId}__${utterance.id}__r${repeatLabel}.${ext}`;
        const outputFile = resolve(audioDir, fileName);

        if (result.success && result.audio) {
          await writeFile(outputFile, result.audio);
        }

        rows.push({
          runId,
          timestamp,
          provider: providerId,
          providerHiddenId: hiddenIdFor(runId, providerId, voiceId),
          model: result.model,
          voiceId,
          utteranceId: utterance.id,
          utterance: utterance.utterance,
          category: utterance.category,
          repeatIndex,
          mode,
          textLength: utterance.utterance.length,
          status: result.success ? "success" : "failed",
          requestToFirstAudioMs: result.requestToFirstAudioMs,
          requestToLastAudioMs: result.requestToLastAudioMs,
          audioDurationMs: result.audioDurationMs,
          rtf: result.rtf,
          bytes: result.bytes,
          sampleRateHz: result.sampleRateHz || sampleRateHz,
          format: result.format,
          outputFile: result.success ? outputFile : "",
          errorCode: result.errorCode ?? "",
          errorMessage: result.errorMessage ?? "",
          vendorRequestId: result.vendorRequestId ?? "",
          appliedNormalizationRules: [],
        });
      }
    }
  }

  const manifestPath = resolve(outputDir, "manifest.json");
  const metricsCsvPath = resolve(outputDir, "metrics.csv");
  const summaryCsvPath = resolve(outputDir, "summary.csv");
  const reviewSheetPath = resolve(outputDir, "review-sheet.csv");
  const indexPath = resolve(outputDir, "index.html");

  const manifest = {
    runId,
    timestamp: new Date().toISOString(),
    outputDir,
    utteranceCsvPath,
    repeats,
    sampleRateHz,
    mode,
    outputFormat,
    providers,
    summaries: summarizeRows(rows),
    rowCount: rows.length,
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(metricsCsvPath, `${buildMetricsCsv(rows)}\n`, "utf8");
  await writeFile(summaryCsvPath, `${buildSummaryCsv(rows)}\n`, "utf8");
  await writeFile(reviewSheetPath, `${buildReviewSheetCsv(rows)}\n`, "utf8");
  await writeFile(
    indexPath,
    buildProviderBenchmarkIndexHtml({ runId, outputDir, rows }),
    "utf8"
  );

  return {
    runId,
    outputDir,
    manifestPath,
    metricsCsvPath,
    summaryCsvPath,
    reviewSheetPath,
    indexPath,
    totalCalls: rows.length,
    failures: rows.filter((row) => row.status === "failed").length,
  };
}

function buildFailureRow(args: {
  runId: string;
  providerId: TtsProviderId;
  model: string;
  voiceId: string;
  utterance: { id: string; utterance: string; category: string };
  repeatIndex: number;
  mode: BenchmarkMode;
  sampleRateHz: number;
  format: string;
  errorCode: string;
  errorMessage: string;
}): BenchmarkRow {
  return {
    runId: args.runId,
    timestamp: new Date().toISOString(),
    provider: args.providerId,
    providerHiddenId: hiddenIdFor(args.runId, args.providerId, args.voiceId),
    model: args.model,
    voiceId: args.voiceId,
    utteranceId: args.utterance.id,
    utterance: args.utterance.utterance,
    category: args.utterance.category,
    repeatIndex: args.repeatIndex,
    mode: args.mode,
    textLength: args.utterance.utterance.length,
    status: "failed",
    requestToFirstAudioMs: null,
    requestToLastAudioMs: null,
    audioDurationMs: null,
    rtf: null,
    bytes: 0,
    sampleRateHz: args.sampleRateHz,
    format: args.format,
    outputFile: "",
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
    vendorRequestId: "",
    appliedNormalizationRules: [],
  };
}

function defaultModelFor(provider: TtsProviderId): string {
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
