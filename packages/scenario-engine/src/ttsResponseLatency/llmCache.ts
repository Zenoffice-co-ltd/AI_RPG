import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { LlmProviderId } from "./types";

export type LlmCacheKeyInput = {
  llmProvider: LlmProviderId;
  llmModel: string;
  systemPromptVersion: string;
  systemPrompt: string;
  caseId: string;
  userInput: string;
  repeatIndex: number;
  temperature?: number;
  maxOutputTokens?: number;
  seed?: number;
};

export type LlmCacheEntry = {
  cacheKey: string;
  createdAt: string;
  llmProvider: LlmProviderId;
  llmModel: string;
  systemPromptVersion: string;
  systemPromptHash: string;
  caseId: string;
  userInputHash: string;
  repeatIndex: number;
  temperature: number | null;
  maxOutputTokens: number | null;
  seed: number | null;
  responseText: string;
  firstSentenceText: string;
  llmRequestToFirstTokenMs: number | null;
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
  llmOutputChars: number;
  llmOutputSentences: number;
};

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortHash(input: string, length = 16): string {
  return sha256Hex(input).slice(0, length);
}

export function buildCacheKey(input: LlmCacheKeyInput): string {
  const parts = [
    input.llmProvider,
    input.llmModel,
    input.systemPromptVersion,
    shortHash(input.systemPrompt),
    input.caseId,
    shortHash(input.userInput),
    String(input.repeatIndex),
    input.temperature === undefined ? "default" : String(input.temperature),
    input.maxOutputTokens === undefined ? "default" : String(input.maxOutputTokens),
    input.seed === undefined ? "none" : String(input.seed),
  ];
  return shortHash(parts.join("|"), 24);
}

export function cacheFilePath(rootDir: string, llmProvider: LlmProviderId, cacheKey: string): string {
  return resolve(rootDir, "_llm-cache", llmProvider, `${cacheKey}.json`);
}

export async function readCacheEntry(filePath: string): Promise<LlmCacheEntry | null> {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text) as LlmCacheEntry;
  } catch {
    return null;
  }
}

export async function writeCacheEntry(filePath: string, entry: LlmCacheEntry): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

export function buildEntryFromMetrics(args: {
  cacheKey: string;
  input: LlmCacheKeyInput;
  responseText: string;
  firstSentenceText: string;
  llmRequestToFirstTokenMs: number | null;
  llmRequestToFirstSentenceMs: number | null;
  llmRequestToDoneMs: number | null;
  llmOutputChars: number;
  llmOutputSentences: number;
}): LlmCacheEntry {
  return {
    cacheKey: args.cacheKey,
    createdAt: new Date().toISOString(),
    llmProvider: args.input.llmProvider,
    llmModel: args.input.llmModel,
    systemPromptVersion: args.input.systemPromptVersion,
    systemPromptHash: shortHash(args.input.systemPrompt),
    caseId: args.input.caseId,
    userInputHash: shortHash(args.input.userInput),
    repeatIndex: args.input.repeatIndex,
    temperature: args.input.temperature ?? null,
    maxOutputTokens: args.input.maxOutputTokens ?? null,
    seed: args.input.seed ?? null,
    responseText: args.responseText,
    firstSentenceText: args.firstSentenceText,
    llmRequestToFirstTokenMs: args.llmRequestToFirstTokenMs,
    llmRequestToFirstSentenceMs: args.llmRequestToFirstSentenceMs,
    llmRequestToDoneMs: args.llmRequestToDoneMs,
    llmOutputChars: args.llmOutputChars,
    llmOutputSentences: args.llmOutputSentences,
  };
}
