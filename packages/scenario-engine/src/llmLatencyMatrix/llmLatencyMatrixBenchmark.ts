import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  countSentences,
  detectFirstSentence,
  type ReasoningEffort,
  type StreamingTextEvent,
} from "@top-performer/vendors";
import { buildMetricsCsv, buildSummaryCsv, summarizeRows } from "./csvWriters";
import { buildLlmMatrixIndexHtml } from "./indexHtml";
import { effortFor } from "./modelMatrix";
import type { LlmMatrixMode, LlmMatrixRow, ModelDefinition } from "./types";
import {
  RESPONSE_LATENCY_SYSTEM_PROMPT,
  responseLatencyCases,
  type ResponseLatencyCase,
} from "../ttsResponseLatency/responseCases";

export type LlmStreamRequest = {
  model: string;
  systemPrompt: string;
  userMessage: string;
  /** Prior conversation turns. Optional; omit for one-shot benchmark calls. */
  history?: readonly { role: "user" | "assistant"; text: string }[];
  maxOutputTokens?: number;
  temperature?: number;
  seed?: number;
  reasoningEffort?: ReasoningEffort;
};

export interface LlmStreamClient {
  stream(input: LlmStreamRequest): AsyncIterable<StreamingTextEvent>;
}

export type LlmLatencyMatrixInput = {
  models: ModelDefinition[];
  modes?: readonly LlmMatrixMode[];
  repeats?: number;
  cases?: readonly ResponseLatencyCase[];
  systemPrompt?: string;
  systemPromptVersion?: string;
  reasoningEffortOverride?: ReasoningEffort;
  temperature?: number;
  maxOutputTokens?: number;
  seed?: number;
  outputDir?: string;
  outputRoot?: string;
  llmClientFactory: (def: ModelDefinition) => LlmStreamClient;
};

export type LlmLatencyMatrixResult = {
  runId: string;
  outputDir: string;
  manifestPath: string;
  metricsCsvPath: string;
  summaryCsvPath: string;
  indexPath: string;
  totalRows: number;
  failures: number;
};

const DEFAULT_OUTPUT_ROOT_RELATIVE = ["data", "generated", "llm-model-latency"];

function createRunId(): string {
  const isoCompact = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace(/-/g, "");
  return `p6-${isoCompact}`;
}

function modelSlug(def: ModelDefinition): string {
  return def.id.replace(/[^a-zA-Z0-9]+/g, "-");
}

export type LlmRunOutcome = {
  responseText: string;
  firstSentenceText: string;
  llmRequestToFirstTokenMs: number | null;
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
  llmOutputChars: number;
  llmOutputSentences: number;
  llmOutputCharsPerSec: number | null;
  errorCode: string;
  errorMessage: string;
  vendorRequestId: string;
};

export async function runLlmLive(
  client: LlmStreamClient,
  request: LlmStreamRequest
): Promise<LlmRunOutcome> {
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let firstSentenceAt: number | null = null;
  let firstSentenceText = "";
  let accumulated = "";
  let vendorRequestId = "";

  try {
    for await (const event of client.stream(request)) {
      if (event.kind === "delta") {
        const now = Date.now();
        if (firstTokenAt === null) firstTokenAt = now;
        accumulated += event.text;
        if (firstSentenceAt === null) {
          const match = detectFirstSentence(accumulated);
          if (match) {
            firstSentenceAt = now;
            firstSentenceText = match.text;
          }
        }
      } else if (event.kind === "done") {
        const now = Date.now();
        vendorRequestId = event.responseId;
        const finalText = event.fullText.length > 0 ? event.fullText : accumulated;
        if (firstSentenceAt === null) {
          const match = detectFirstSentence(finalText);
          if (match) {
            firstSentenceAt = now;
            firstSentenceText = match.text;
          } else {
            firstSentenceText = finalText;
            firstSentenceAt = now;
          }
        }
        const llmDoneMs = now - startedAt;
        const llmOutputChars = finalText.length;
        return {
          responseText: finalText,
          firstSentenceText,
          llmRequestToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
          llmRequestToFirstSentenceMs:
            firstSentenceAt === null ? null : firstSentenceAt - startedAt,
          llmRequestToDoneMs: llmDoneMs,
          llmOutputChars,
          llmOutputSentences: countSentences(finalText),
          llmOutputCharsPerSec:
            llmDoneMs > 0 && llmOutputChars > 0 ? (llmOutputChars * 1000) / llmDoneMs : null,
          errorCode: "",
          errorMessage: "",
          vendorRequestId,
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      responseText: accumulated,
      firstSentenceText,
      llmRequestToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
      llmRequestToFirstSentenceMs:
        firstSentenceAt === null ? null : firstSentenceAt - startedAt,
      llmRequestToDoneMs: null,
      llmOutputChars: accumulated.length,
      llmOutputSentences: 0,
      llmOutputCharsPerSec: null,
      errorCode: "LLM_THROW",
      errorMessage: message,
      vendorRequestId,
    };
  }

  // Stream ended without explicit done.
  const now = Date.now();
  if (firstSentenceText.length === 0 && accumulated.length > 0) {
    firstSentenceText = accumulated;
  }
  const llmDoneMs = now - startedAt;
  const llmOutputChars = accumulated.length;
  return {
    responseText: accumulated,
    firstSentenceText,
    llmRequestToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
    llmRequestToFirstSentenceMs:
      firstSentenceAt === null ? null : firstSentenceAt - startedAt,
    llmRequestToDoneMs: llmDoneMs,
    llmOutputChars,
    llmOutputSentences: countSentences(accumulated),
    llmOutputCharsPerSec:
      llmDoneMs > 0 && llmOutputChars > 0 ? (llmOutputChars * 1000) / llmDoneMs : null,
    errorCode: "",
    errorMessage: "",
    vendorRequestId,
  };
}

function buildRow(args: {
  runId: string;
  def: ModelDefinition;
  effort: ReasoningEffort | undefined;
  caseDef: ResponseLatencyCase;
  repeatIndex: number;
  outcome: LlmRunOutcome;
  temperature: number | null;
  maxOutputTokens: number | null;
  seed: number | null;
}): LlmMatrixRow {
  const ok = args.outcome.errorCode.length === 0;
  return {
    runId: args.runId,
    timestamp: new Date().toISOString(),
    provider: args.def.provider,
    model: args.def.model,
    modelCategory: args.def.category,
    reasoningEffort: args.effort ?? "",
    caseId: args.caseDef.id,
    category: args.caseDef.category,
    userInput: args.caseDef.userInput,
    repeatIndex: args.repeatIndex,
    status: ok ? "success" : "failed",
    llmRequestToFirstTokenMs: args.outcome.llmRequestToFirstTokenMs,
    llmRequestToFirstSentenceMs: args.outcome.llmRequestToFirstSentenceMs,
    llmRequestToDoneMs: args.outcome.llmRequestToDoneMs,
    llmOutputChars: ok ? args.outcome.llmOutputChars : null,
    llmOutputSentences: ok ? args.outcome.llmOutputSentences : null,
    llmOutputCharsPerSec: ok ? args.outcome.llmOutputCharsPerSec : null,
    firstSentenceText: args.outcome.firstSentenceText,
    responseText: args.outcome.responseText,
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    seed: args.seed,
    errorCode: args.outcome.errorCode,
    errorMessage: args.outcome.errorMessage,
    vendorRequestId: args.outcome.vendorRequestId,
  };
}

export async function runLlmLatencyMatrix(
  input: LlmLatencyMatrixInput
): Promise<LlmLatencyMatrixResult> {
  const repeats = Math.max(1, input.repeats ?? 5);
  const cases = input.cases ?? responseLatencyCases;
  const systemPrompt = input.systemPrompt ?? RESPONSE_LATENCY_SYSTEM_PROMPT;
  const systemPromptVersion =
    input.systemPromptVersion ??
    process.env["RESPONSE_LATENCY_SYSTEM_PROMPT_VERSION"] ??
    "v1";
  const temperature = input.temperature ?? 0.2;
  const maxOutputTokens = input.maxOutputTokens ?? 200;

  const runId = createRunId();
  const outputRoot =
    input.outputRoot ??
    resolve(process.cwd(), ...DEFAULT_OUTPUT_ROOT_RELATIVE);
  const outputDir = input.outputDir ?? resolve(outputRoot, runId);
  const llmTextDir = resolve(outputDir, "llm-text");
  await mkdir(outputDir, { recursive: true });
  await mkdir(llmTextDir, { recursive: true });

  const rows: LlmMatrixRow[] = [];

  for (const def of input.models) {
    const effort = effortFor(def, input.reasoningEffortOverride);
    let client: LlmStreamClient;
    try {
      client = input.llmClientFactory(def);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const caseDef of cases) {
        for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
          rows.push(
            buildRow({
              runId,
              def,
              effort,
              caseDef,
              repeatIndex,
              outcome: {
                responseText: "",
                firstSentenceText: "",
                llmRequestToFirstTokenMs: null,
                llmRequestToFirstSentenceMs: null,
                llmRequestToDoneMs: null,
                llmOutputChars: 0,
                llmOutputSentences: 0,
                llmOutputCharsPerSec: null,
                errorCode: "FACTORY_ERROR",
                errorMessage: message,
                vendorRequestId: "",
              },
              temperature,
              maxOutputTokens,
              seed: input.seed ?? null,
            })
          );
        }
      }
      continue;
    }

    for (const caseDef of cases) {
      for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
        // Reasoning-class models (OpenAI gpt-5/o-series) reject custom temperature.
        // Only send temperature for general (non-reasoning) categories.
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
        const row = buildRow({
          runId,
          def,
          effort,
          caseDef,
          repeatIndex,
          outcome,
          temperature,
          maxOutputTokens,
          seed: input.seed ?? null,
        });
        rows.push(row);

        if (outcome.errorCode.length === 0) {
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
                temperature,
                maxOutputTokens,
                seed: input.seed ?? null,
                responseText: outcome.responseText,
                firstSentenceText: outcome.firstSentenceText,
                llmRequestToFirstTokenMs: outcome.llmRequestToFirstTokenMs,
                llmRequestToFirstSentenceMs: outcome.llmRequestToFirstSentenceMs,
                llmRequestToDoneMs: outcome.llmRequestToDoneMs,
                llmOutputChars: outcome.llmOutputChars,
                llmOutputSentences: outcome.llmOutputSentences,
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
  const indexPath = resolve(outputDir, "index.html");

  const manifest = {
    runId,
    timestamp: new Date().toISOString(),
    outputDir,
    systemPromptVersion,
    systemPromptHashSnippet: systemPrompt.slice(0, 80),
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
      notes: def.notes ?? null,
    })),
    rowCount: rows.length,
    summaries: summarizeRows(rows),
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(metricsCsvPath, `${buildMetricsCsv(rows)}\n`, "utf8");
  await writeFile(summaryCsvPath, `${buildSummaryCsv(rows)}\n`, "utf8");
  await writeFile(indexPath, buildLlmMatrixIndexHtml({ runId, rows }), "utf8");

  return {
    runId,
    outputDir,
    manifestPath,
    metricsCsvPath,
    summaryCsvPath,
    indexPath,
    totalRows: rows.length,
    failures: rows.filter((row) => row.status === "failed").length,
  };
}
