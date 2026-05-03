import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Papa from "papaparse";
import {
  ElevenLabsConvAiClient,
  ElevenLabsConvAiError,
  countSentences,
  detectFirstSentence,
} from "@top-performer/vendors";
import { qualityLatencyCases } from "./cases";
import type { QualityLatencyCase } from "./types";

export type ElevenLabsAgentRow = {
  runId: string;
  timestamp: string;
  agentId: string;
  llmLabel: string;
  ttsLabel: string;
  caseId: string;
  caseCategory: string;
  userInput: string;
  repeatIndex: number;
  status: "success" | "failed";
  conversationId: string;
  requestToFirstTextMs: number | null;
  requestToFirstAudioMs: number | null;
  requestToLastAudioMs: number | null;
  audioBytes: number;
  audioFormat: string;
  sampleRateHz: number;
  responseText: string;
  firstSentenceText: string;
  responseChars: number | null;
  responseSentences: number | null;
  outputFile: string;
  errorCode: string;
  errorMessage: string;
};

export type ElevenLabsAgentRunInput = {
  runId: string;
  outputDir: string;
  agentId: string;
  llmLabel: string;
  cases?: readonly QualityLatencyCase[];
  caseLimit?: number;
  repeats: number;
  timeoutMs?: number;
  client: ElevenLabsConvAiClient;
};

export type ElevenLabsAgentRunResult = {
  runId: string;
  metricsPath: string;
  audioDir: string;
  totalRows: number;
  failures: number;
};

const ELEVENLABS_LABEL = "elevenlabs:agent-glm-4.5";

function pcmS16LeToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}

export async function runElevenLabsAgent(
  input: ElevenLabsAgentRunInput
): Promise<ElevenLabsAgentRunResult> {
  const audioDir = resolve(input.outputDir, "audio");
  await mkdir(audioDir, { recursive: true });
  await mkdir(input.outputDir, { recursive: true });
  const sourceCases = input.cases ?? qualityLatencyCases;
  const cases =
    input.caseLimit !== undefined
      ? sourceCases.slice(0, Math.max(1, input.caseLimit))
      : sourceCases;
  const timeoutMs = input.timeoutMs ?? 60_000;

  const rows: ElevenLabsAgentRow[] = [];

  for (const caseDef of cases) {
    for (let repeatIndex = 1; repeatIndex <= input.repeats; repeatIndex += 1) {
      const startedAtIso = new Date().toISOString();
      try {
        const result = await input.client.runOneTurn({
          userMessage: caseDef.userInput,
          timeoutMs,
        });
        const responseText = result.agentResponseText;
        const firstSentenceMatch = detectFirstSentence(responseText);
        const firstSentenceText = firstSentenceMatch
          ? firstSentenceMatch.text
          : responseText;

        const repeatLabel = String(repeatIndex).padStart(2, "0");
        const fileName = `elevenlabs-agent__${caseDef.id}__r${repeatLabel}.wav`;
        const outputFile = resolve(audioDir, fileName);
        if (result.audio.byteLength > 0) {
          const wav = pcmS16LeToWav(result.audio, result.sampleRateHz);
          await writeFile(outputFile, wav);
        }

        rows.push({
          runId: input.runId,
          timestamp: startedAtIso,
          agentId: input.agentId,
          llmLabel: input.llmLabel,
          ttsLabel: "elevenlabs",
          caseId: caseDef.id,
          caseCategory: caseDef.category,
          userInput: caseDef.userInput,
          repeatIndex,
          status: "success",
          conversationId: result.conversationId,
          requestToFirstTextMs: result.requestToFirstTextMs,
          requestToFirstAudioMs: result.requestToFirstAudioMs,
          requestToLastAudioMs: result.requestToLastAudioMs,
          audioBytes: result.audio.byteLength,
          audioFormat: result.audioFormat,
          sampleRateHz: result.sampleRateHz,
          responseText,
          firstSentenceText,
          responseChars: responseText.length,
          responseSentences: countSentences(responseText),
          outputFile: result.audio.byteLength > 0 ? outputFile : "",
          errorCode: "",
          errorMessage: "",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        const errorCode =
          error instanceof ElevenLabsConvAiError ? "VENDOR_THROW" : "CLIENT_THROW";
        rows.push({
          runId: input.runId,
          timestamp: startedAtIso,
          agentId: input.agentId,
          llmLabel: input.llmLabel,
          ttsLabel: "elevenlabs",
          caseId: caseDef.id,
          caseCategory: caseDef.category,
          userInput: caseDef.userInput,
          repeatIndex,
          status: "failed",
          conversationId: "",
          requestToFirstTextMs: null,
          requestToFirstAudioMs: null,
          requestToLastAudioMs: null,
          audioBytes: 0,
          audioFormat: "pcm_s16le",
          sampleRateHz: 16_000,
          responseText: "",
          firstSentenceText: "",
          responseChars: null,
          responseSentences: null,
          outputFile: "",
          errorCode,
          errorMessage: message,
        });
      }
    }
  }

  const metricsPath = resolve(input.outputDir, "elevenlabs-agent-metrics.csv");
  const csv = Papa.unparse(
    rows.map((r) => ({
      runId: r.runId,
      timestamp: r.timestamp,
      agentId: r.agentId,
      llmLabel: r.llmLabel,
      ttsLabel: r.ttsLabel,
      caseId: r.caseId,
      caseCategory: r.caseCategory,
      userInput: r.userInput,
      repeatIndex: r.repeatIndex,
      status: r.status,
      conversationId: r.conversationId,
      requestToFirstTextMs: r.requestToFirstTextMs ?? "",
      requestToFirstAudioMs: r.requestToFirstAudioMs ?? "",
      requestToLastAudioMs: r.requestToLastAudioMs ?? "",
      audioBytes: r.audioBytes,
      audioFormat: r.audioFormat,
      sampleRateHz: r.sampleRateHz,
      responseText: r.responseText,
      firstSentenceText: r.firstSentenceText,
      responseChars: r.responseChars ?? "",
      responseSentences: r.responseSentences ?? "",
      outputFile: r.outputFile,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
    }))
  );
  await writeFile(metricsPath, `${csv}\n`, "utf8");

  return {
    runId: input.runId,
    metricsPath,
    audioDir,
    totalRows: rows.length,
    failures: rows.filter((r) => r.status === "failed").length,
  };
}

export { ELEVENLABS_LABEL };

import { readFile } from "node:fs/promises";
import { scoreRow } from "./ruleScorer";
import type { E2eRow, QualityLatencyRow } from "./types";

/**
 * Convert raw ElevenLabs Agent rows into the shared E2eRow shape so that
 * the Pareto frontier can rank the agent against text-LLM + external-TTS
 * combinations on the same axes.
 *
 * mode = "first-sentence" | "full-text" は意味的に存在しないため "native" に
 * マップする。Pareto runner の正規化は文字列ベースなのでこれで OK。
 */
export function elevenlabsRowsToE2e(
  rows: ElevenLabsAgentRow[]
): E2eRow[] {
  return rows.map((r) => ({
    runId: r.runId,
    llmProvider: "elevenlabs",
    llmModel: r.llmLabel.replace(/^elevenlabs:/, ""),
    ttsProvider: "elevenlabs" as const,
    ttsModel: "elevenlabs-agent",
    voiceId: "",
    mode: "first-sentence" as const, // pareto frontier groups by (llm, tts, mode); "first-sentence" puts the agent next to first-sentence rows for visual comparison.
    caseId: r.caseId,
    repeatIndex: r.repeatIndex,
    status: r.status,
    llmRequestToFirstSentenceMs: r.requestToFirstTextMs,
    llmRequestToDoneMs: r.requestToLastAudioMs,
    ttsRequestToFirstAudioMs: r.requestToFirstAudioMs,
    ttsRequestToDoneMs: r.requestToLastAudioMs,
    audioDurationMs: null,
    rtf: null,
    firstAudioAvailable: r.requestToFirstAudioMs !== null,
    e2eFirstAudioMs: r.requestToFirstAudioMs,
    e2eDoneMs: r.requestToLastAudioMs,
    overlapGainMs: null,
    ttsInputMode: "native",
    ttsInputChars: null,
    qualityScore: null,
    rulePass: null,
    knockout: null,
    outputFile: r.outputFile,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    vendorRequestId: r.conversationId,
  }));
}

/**
 * Apply rule scoring to ElevenLabs Agent responses, mapped onto the same
 * RuleScoreRow shape so they can be merged with text-LLM rule scores.
 */
export function elevenlabsRowsToQualityRows(
  rows: ElevenLabsAgentRow[]
): QualityLatencyRow[] {
  return rows.map((r) => ({
    runId: r.runId,
    timestamp: r.timestamp,
    provider: "elevenlabs",
    model: r.llmLabel.replace(/^elevenlabs:/, ""),
    modelCategory: "general-mid",
    reasoningEffort: "",
    caseId: r.caseId,
    caseCategory: r.caseCategory,
    userInput: r.userInput,
    repeatIndex: r.repeatIndex,
    status: r.status,
    llmRequestToFirstTokenMs: r.requestToFirstTextMs,
    llmRequestToFirstSentenceMs: r.requestToFirstTextMs,
    llmRequestToDoneMs: r.requestToLastAudioMs,
    llmOutputChars: r.responseChars,
    llmOutputSentences: r.responseSentences,
    llmOutputCharsPerSec:
      r.responseChars && r.requestToLastAudioMs && r.requestToLastAudioMs > 0
        ? (r.responseChars * 1000) / r.requestToLastAudioMs
        : null,
    firstSentenceText: r.firstSentenceText,
    responseText: r.responseText,
    temperature: null,
    maxOutputTokens: null,
    seed: null,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    vendorRequestId: r.conversationId,
  }));
}

export async function loadElevenLabsAgentMetricsCsv(
  path: string
): Promise<ElevenLabsAgentRow[]> {
  const text = await readFile(path, "utf8");
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.map((r) => ({
    runId: r["runId"] ?? "",
    timestamp: r["timestamp"] ?? "",
    agentId: r["agentId"] ?? "",
    llmLabel: r["llmLabel"] ?? ELEVENLABS_LABEL,
    ttsLabel: r["ttsLabel"] ?? "elevenlabs",
    caseId: r["caseId"] ?? "",
    caseCategory: r["caseCategory"] ?? "",
    userInput: r["userInput"] ?? "",
    repeatIndex: Number(r["repeatIndex"] ?? 0),
    status: (r["status"] === "success" ? "success" : "failed") as "success" | "failed",
    conversationId: r["conversationId"] ?? "",
    requestToFirstTextMs:
      r["requestToFirstTextMs"] === "" || r["requestToFirstTextMs"] === undefined
        ? null
        : Number(r["requestToFirstTextMs"]),
    requestToFirstAudioMs:
      r["requestToFirstAudioMs"] === "" || r["requestToFirstAudioMs"] === undefined
        ? null
        : Number(r["requestToFirstAudioMs"]),
    requestToLastAudioMs:
      r["requestToLastAudioMs"] === "" || r["requestToLastAudioMs"] === undefined
        ? null
        : Number(r["requestToLastAudioMs"]),
    audioBytes: Number(r["audioBytes"] ?? 0),
    audioFormat: r["audioFormat"] ?? "pcm_s16le",
    sampleRateHz: Number(r["sampleRateHz"] ?? 16000),
    responseText: r["responseText"] ?? "",
    firstSentenceText: r["firstSentenceText"] ?? "",
    responseChars:
      r["responseChars"] === "" || r["responseChars"] === undefined
        ? null
        : Number(r["responseChars"]),
    responseSentences:
      r["responseSentences"] === "" || r["responseSentences"] === undefined
        ? null
        : Number(r["responseSentences"]),
    outputFile: r["outputFile"] ?? "",
    errorCode: r["errorCode"] ?? "",
    errorMessage: r["errorMessage"] ?? "",
  }));
}

/**
 * Apply rule scoring inline (no LLM judge) so the agent's responses can
 * contribute a quality signal to the Pareto frontier even when the user
 * only ran the speed measurement.
 */
export function elevenlabsAgentRuleScores(
  rows: ElevenLabsAgentRow[],
  caseLookup: ReadonlyMap<string, import("./types").QualityLatencyCase>
): import("./types").RuleScoreRow[] {
  const out: import("./types").RuleScoreRow[] = [];
  for (const row of rows) {
    if (row.status !== "success") continue;
    const c = caseLookup.get(row.caseId);
    if (!c) continue;
    const qlRow = elevenlabsRowsToQualityRows([row])[0]!;
    out.push(scoreRow({ row: qlRow, caseDef: c }));
  }
  return out;
}

