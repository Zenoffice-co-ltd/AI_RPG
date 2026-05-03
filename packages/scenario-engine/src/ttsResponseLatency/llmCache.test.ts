import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCacheKey,
  buildEntryFromMetrics,
  cacheFilePath,
  readCacheEntry,
  writeCacheEntry,
} from "./llmCache";

const baseInput = {
  llmProvider: "openai" as const,
  llmModel: "gpt-test",
  systemPromptVersion: "v1",
  systemPrompt: "system prompt body",
  caseId: "resp_001",
  userInput: "hello",
  repeatIndex: 1,
};

describe("buildCacheKey", () => {
  it("produces stable key for identical inputs", () => {
    const a = buildCacheKey(baseInput);
    const b = buildCacheKey({ ...baseInput });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{24}$/);
  });

  it("changes when systemPromptVersion differs", () => {
    expect(buildCacheKey(baseInput)).not.toBe(
      buildCacheKey({ ...baseInput, systemPromptVersion: "v2" })
    );
  });

  it("changes when userInput differs", () => {
    expect(buildCacheKey(baseInput)).not.toBe(
      buildCacheKey({ ...baseInput, userInput: "different" })
    );
  });

  it("changes when repeatIndex differs", () => {
    expect(buildCacheKey(baseInput)).not.toBe(
      buildCacheKey({ ...baseInput, repeatIndex: 2 })
    );
  });

  it("changes when seed differs", () => {
    expect(buildCacheKey({ ...baseInput, seed: 1 })).not.toBe(
      buildCacheKey({ ...baseInput, seed: 2 })
    );
  });
});

describe("cache I/O", () => {
  it("writes and reads back an entry", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "llm-cache-"));
    const cacheKey = buildCacheKey(baseInput);
    const path = cacheFilePath(dir, "openai", cacheKey);

    const entry = buildEntryFromMetrics({
      cacheKey,
      input: baseInput,
      responseText: "はい、承知しました。",
      firstSentenceText: "はい、承知しました。",
      llmRequestToFirstTokenMs: 120,
      llmRequestToFirstSentenceMs: 350,
      llmRequestToDoneMs: 600,
      llmOutputChars: 11,
      llmOutputSentences: 1,
    });

    await writeCacheEntry(path, entry);
    await expect(stat(path)).resolves.toBeTruthy();

    const text = await readFile(path, "utf8");
    expect(text).toContain("\"responseText\": \"はい、承知しました。\"");

    const roundtrip = await readCacheEntry(path);
    expect(roundtrip?.cacheKey).toBe(cacheKey);
    expect(roundtrip?.responseText).toBe("はい、承知しました。");
    expect(roundtrip?.llmRequestToFirstSentenceMs).toBe(350);
  });

  it("returns null when cache file is missing", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "llm-cache-miss-"));
    const path = cacheFilePath(dir, "openai", "missingkey");
    expect(await readCacheEntry(path)).toBeNull();
  });
});
