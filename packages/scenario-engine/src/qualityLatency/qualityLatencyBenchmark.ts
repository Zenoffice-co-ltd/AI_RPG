import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { effortFor } from "../llmLatencyMatrix/modelMatrix";
import type { ModelDefinition } from "../llmLatencyMatrix/types";
import {
  runLlmLive,
  type LlmStreamClient,
  type LlmStreamRequest,
} from "../llmLatencyMatrix/llmLatencyMatrixBenchmark";
import { qualityLatencyCases } from "./cases";
import {
  QUALITY_LATENCY_SYSTEM_PROMPT,
  QUALITY_LATENCY_SYSTEM_PROMPT_VERSION,
} from "./systemPrompt";
import {
  buildLatencySummaryCsv,
  buildMetricsCsv,
} from "./csvWriters";
import type { QualityLatencyCase, QualityLatencyRow } from "./types";

export type QualityLatencyGenerateInput = {
  models: ModelDefinition[];
  cases?: readonly QualityLatencyCase[];
  caseLimit?: number;
  repeats?: number;
  systemPrompt?: string;
  systemPromptVersion?: string;
  reasoningEffortOverride?: "minimal" | "low" | "medium" | "high";
  temperature?: number;
  maxOutputTokens?: number;
  seed?: number;
  outputDir?: string;
  outputRoot?: string;
  llmClientFactory: (def: ModelDefinition) => LlmStreamClient;
};

export type QualityLatencyGenerateResult = {
  runId: string;
  outputDir: string;
  manifestPath: string;
  metricsCsvPath: string;
  summaryCsvPath: string;
  totalRows: number;
  failures: number;
};

const DEFAULT_OUTPUT_ROOT_RELATIVE = ["data", "generated", "quality-latency-benchmark"];

export function defaultOutputRoot(repoRoot: string): string {
  return resolve(repoRoot, ...DEFAULT_OUTPUT_ROOT_RELATIVE);
}

function createRunId(): string {
  const isoCompact = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace(/-/g, "");
  return `p6s3-${isoCompact}`;
}

function modelSlug(def: ModelDefinition): string {
  return def.id.replace(/[^a-zA-Z0-9]+/g, "-");
}

export async function runQualityLatencyGenerate(
  input: QualityLatencyGenerateInput
): Promise<QualityLatencyGenerateResult> {
  const repeats = Math.max(1, input.repeats ?? 10);
  const systemPrompt = input.systemPrompt ?? QUALITY_LATENCY_SYSTEM_PROMPT;
  const systemPromptVersion =
    input.systemPromptVersion ?? QUALITY_LATENCY_SYSTEM_PROMPT_VERSION;
  const temperature = input.temperature ?? 0.2;
  const maxOutputTokens = input.maxOutputTokens ?? 220;

  const sourceCases = input.cases ?? qualityLatencyCases;
  const cases =
    input.caseLimit !== undefined
      ? sourceCases.slice(0, Math.max(1, input.caseLimit))
      : sourceCases;

  const runId = createRunId();
  const outputRoot =
    input.outputRoot ?? resolve(process.cwd(), ...DEFAULT_OUTPUT_ROOT_RELATIVE);
  const outputDir = input.outputDir ?? resolve(outputRoot, runId);
  const llmTextDir = resolve(outputDir, "llm-text");
  await mkdir(outputDir, { recursive: true });
  await mkdir(llmTextDir, { recursive: true });

  const rows: QualityLatencyRow[] = [];

  for (const def of input.models) {
    const effort = effortFor(def, input.reasoningEffortOverride);
    let client: LlmStreamClient;
    try {
      client = input.llmClientFactory(def);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const caseDef of cases) {
        for (let r = 1; r <= repeats; r += 1) {
          rows.push(buildFailedRow({
            runId,
            def,
            effort: effort ?? "",
            caseDef,
            repeatIndex: r,
            errorCode: "FACTORY_ERROR",
            errorMessage: message,
            temperature,
            maxOutputTokens,
            seed: input.seed ?? null,
          }));
        }
      }
      continue;
    }

    for (const caseDef of cases) {
      for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
        const sendTemperature = def.category !== "reasoning";
        const request: LlmStreamRequest = {
          model: def.model,
          systemPrompt,
          userMessage: caseDef.userInput,
          maxOutputTokens,
          ...(sendTemperature ? { temperature } : {}),
          ...(input.seed === undefined ? {} : { seed: input.seed }),
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
        };
        const outcome = await runLlmLive(client, request);
        const ok = outcome.errorCode.length === 0;
        const row: QualityLatencyRow = {
          runId,
          timestamp: new Date().toISOString(),
          provider: def.provider,
          model: def.model,
          modelCategory: def.category,
          reasoningEffort: effort ?? "",
          caseId: caseDef.id,
          caseCategory: caseDef.category,
          userInput: caseDef.userInput,
          repeatIndex,
          status: ok ? "success" : "failed",
          llmRequestToFirstTokenMs: outcome.llmRequestToFirstTokenMs,
          llmRequestToFirstSentenceMs: outcome.llmRequestToFirstSentenceMs,
          llmRequestToDoneMs: outcome.llmRequestToDoneMs,
          llmOutputChars: ok ? outcome.llmOutputChars : null,
          llmOutputSentences: ok ? outcome.llmOutputSentences : null,
          llmOutputCharsPerSec: ok ? outcome.llmOutputCharsPerSec : null,
          firstSentenceText: outcome.firstSentenceText,
          responseText: outcome.responseText,
          temperature: sendTemperature ? temperature : null,
          maxOutputTokens,
          seed: input.seed ?? null,
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
          vendorRequestId: outcome.vendorRequestId,
        };
        rows.push(row);

        if (ok) {
          const repeatLabel = String(repeatIndex).padStart(2, "0");
          const fileName = `${modelSlug(def)}__${caseDef.id}__r${repeatLabel}.json`;
          await writeFile(
            resolve(llmTextDir, fileName),
            `${JSON.stringify(
              {
                runId,
                model: def.id,
                reasoningEffort: effort ?? null,
                caseId: caseDef.id,
                repeatIndex,
                temperature: sendTemperature ? temperature : null,
                maxOutputTokens,
                seed: input.seed ?? null,
                responseText: outcome.responseText,
                firstSentenceText: outcome.firstSentenceText,
                llmRequestToFirstTokenMs: outcome.llmRequestToFirstTokenMs,
                llmRequestToFirstSentenceMs: outcome.llmRequestToFirstSentenceMs,
                llmRequestToDoneMs: outcome.llmRequestToDoneMs,
                llmOutputChars: outcome.llmOutputChars,
                llmOutputSentences: outcome.llmOutputSentences,
                llmOutputCharsPerSec: outcome.llmOutputCharsPerSec,
                vendorRequestId: outcome.vendorRequestId,
              },
              null,
              2
            )}\n`,
            "utf8"
          );
        }
      }
    }
  }

  const manifestPath = resolve(outputDir, "manifest.json");
  const metricsCsvPath = resolve(outputDir, "metrics.csv");
  const summaryCsvPath = resolve(outputDir, "summary.csv");

  const manifest = {
    runId,
    timestamp: new Date().toISOString(),
    outputDir,
    systemPromptVersion,
    cases: cases.map((c) => c.id),
    repeats,
    temperature,
    maxOutputTokens,
    seed: input.seed ?? null,
    reasoningEffortOverride: input.reasoningEffortOverride ?? null,
    models: input.models.map((def) => ({
      id: def.id,
      provider: def.provider,
      model: def.model,
      category: def.category,
      reasoningEffort: effortFor(def, input.reasoningEffortOverride) ?? null,
    })),
    rowCount: rows.length,
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(metricsCsvPath, `${buildMetricsCsv(rows)}\n`, "utf8");
  await writeFile(summaryCsvPath, `${buildLatencySummaryCsv(rows)}\n`, "utf8");

  return {
    runId,
    outputDir,
    manifestPath,
    metricsCsvPath,
    summaryCsvPath,
    totalRows: rows.length,
    failures: rows.filter((r) => r.status === "failed").length,
  };
}

function buildFailedRow(args: {
  runId: string;
  def: ModelDefinition;
  effort: string;
  caseDef: QualityLatencyCase;
  repeatIndex: number;
  errorCode: string;
  errorMessage: string;
  temperature: number;
  maxOutputTokens: number;
  seed: number | null;
}): QualityLatencyRow {
  return {
    runId: args.runId,
    timestamp: new Date().toISOString(),
    provider: args.def.provider,
    model: args.def.model,
    modelCategory: args.def.category,
    reasoningEffort: args.effort,
    caseId: args.caseDef.id,
    caseCategory: args.caseDef.category,
    userInput: args.caseDef.userInput,
    repeatIndex: args.repeatIndex,
    status: "failed",
    llmRequestToFirstTokenMs: null,
    llmRequestToFirstSentenceMs: null,
    llmRequestToDoneMs: null,
    llmOutputChars: null,
    llmOutputSentences: null,
    llmOutputCharsPerSec: null,
    firstSentenceText: "",
    responseText: "",
    temperature: args.def.category === "reasoning" ? null : args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    seed: args.seed,
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
    vendorRequestId: "",
  };
}
