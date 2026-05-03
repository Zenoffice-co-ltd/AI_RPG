import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  StreamingTextEvent,
  TtsProvider,
  TtsSynthesisResult,
} from "@top-performer/vendors";
import {
  runResponseLatencyBenchmark,
  type LlmStreamClient,
} from "./responseLatencyBenchmark";

function makeMockLlmClient(deltas: string[], responseId = "resp_test"): LlmStreamClient {
  return {
    async *stream(): AsyncIterable<StreamingTextEvent> {
      for (const delta of deltas) {
        yield { kind: "delta", text: delta };
      }
      yield {
        kind: "done",
        fullText: deltas.join(""),
        responseId,
      };
    },
  };
}

function makeMockTtsProvider(
  id: TtsProvider["id"],
  fn: (callIndex: number) => TtsSynthesisResult
): TtsProvider {
  let callIndex = 0;
  return {
    id,
    requiredEnv: [],
    async synthesize() {
      const result = fn(callIndex);
      callIndex += 1;
      return result;
    },
  };
}

function defaultSuccess(provider: TtsProvider["id"], voiceId: string): TtsSynthesisResult {
  return {
    provider,
    model: "mock-model",
    voiceId,
    success: true,
    audio: Buffer.from("FAKE"),
    format: "wav",
    sampleRateHz: 24_000,
    bytes: 4,
    requestToFirstAudioMs: 200,
    requestToLastAudioMs: 500,
    audioDurationMs: 800,
    rtf: 0.625,
    vendorRequestId: "req_mock",
  };
}

const FIRST_CASE_ID = "resp_001";

describe("runResponseLatencyBenchmark", () => {
  it("emits llm-only rows with cache miss and writes llm-text artifacts", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p5-out-")), "out");
    const cacheRoot = await mkdtemp(resolve(tmpdir(), "p5-cache-"));

    const result = await runResponseLatencyBenchmark({
      llmModel: "gpt-mock",
      modes: ["llm-only"],
      ttsProviders: [],
      repeats: 1,
      cases: [
        {
          id: FIRST_CASE_ID,
          category: "short_ack",
          userInput: "はい、お願いします。",
          expectedLength: "short",
          notes: "",
        },
      ],
      outputDir,
      cacheRoot,
      llmClientFactory: () => makeMockLlmClient(["はい、", "承知しました。"]),
    });

    expect(result.totalRows).toBe(1);
    expect(result.llmCallsLive).toBe(1);
    expect(result.llmCallsCached).toBe(0);

    const metrics = await readFile(result.metricsCsvPath, "utf8");
    expect(metrics).toContain("llm-only");
    expect(metrics).toContain(FIRST_CASE_ID);
    expect(metrics).toContain("llmCacheHit");

    const llmText = await readFile(
      resolve(outputDir, "llm-text", `${FIRST_CASE_ID}__r01.json`),
      "utf8"
    );
    expect(llmText).toContain("はい、承知しました。");

    await expect(stat(result.indexPath)).resolves.toBeTruthy();
    await expect(stat(result.manifestPath)).resolves.toBeTruthy();
  });

  it("reuses cache across runs and marks llmLatencyFresh accordingly", async () => {
    const cacheRoot = await mkdtemp(resolve(tmpdir(), "p5-cache-shared-"));
    const cases = [
      {
        id: FIRST_CASE_ID,
        category: "short_ack" as const,
        userInput: "はい、お願いします。",
        expectedLength: "short" as const,
        notes: "",
      },
    ];

    const factory = vi.fn(() => makeMockLlmClient(["はい、承知しました。"]));

    const out1 = resolve(await mkdtemp(resolve(tmpdir(), "p5-out1-")), "out");
    const r1 = await runResponseLatencyBenchmark({
      llmModel: "gpt-mock",
      modes: ["llm-only"],
      ttsProviders: [],
      repeats: 1,
      cases,
      outputDir: out1,
      cacheRoot,
      llmClientFactory: factory,
    });
    expect(r1.llmCallsLive).toBe(1);

    const out2 = resolve(await mkdtemp(resolve(tmpdir(), "p5-out2-")), "out");
    const r2 = await runResponseLatencyBenchmark({
      llmModel: "gpt-mock",
      modes: ["llm-only"],
      ttsProviders: [],
      repeats: 1,
      cases,
      outputDir: out2,
      cacheRoot,
      reuseLlmCache: true,
      llmClientFactory: factory,
    });
    expect(r2.llmCallsLive).toBe(0);
    expect(r2.llmCallsCached).toBe(1);

    const metrics = await readFile(r2.metricsCsvPath, "utf8");
    const dataLine = metrics.trim().split("\n")[1] ?? "";
    expect(dataLine).toContain(",true,"); // llmCacheHit=true somewhere in row
    expect(dataLine).toContain(",false,"); // llmLatencyFresh=false somewhere in row
  });

  it("emits full-text and first-sentence rows with separate TTS audio per mode", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p5-modes-")), "out");
    const cacheRoot = await mkdtemp(resolve(tmpdir(), "p5-modes-cache-"));

    const cases = [
      {
        id: FIRST_CASE_ID,
        category: "short_ack" as const,
        userInput: "はい、お願いします。",
        expectedLength: "short" as const,
        notes: "",
      },
    ];

    const cartesia = makeMockTtsProvider("cartesia", () =>
      defaultSuccess("cartesia", "voice_a")
    );

    const result = await runResponseLatencyBenchmark({
      llmModel: "gpt-mock",
      modes: ["full-text", "first-sentence"],
      ttsProviders: ["cartesia"],
      repeats: 1,
      cases,
      outputDir,
      cacheRoot,
      providerFactories: { cartesia: () => cartesia },
      llmClientFactory: () => makeMockLlmClient(["はい、お引き受けします。", "ご相談ください。"]),
    });

    expect(result.totalRows).toBe(2);
    const metrics = await readFile(result.metricsCsvPath, "utf8");
    expect(metrics).toContain("full-text");
    expect(metrics).toContain("first-sentence");
    expect(metrics).toContain("cartesia");

    const audioFullText = resolve(
      outputDir,
      "audio",
      `cartesia__${FIRST_CASE_ID}__full-text__r01.wav`
    );
    const audioFirstSentence = resolve(
      outputDir,
      "audio",
      `cartesia__${FIRST_CASE_ID}__first-sentence__r01.wav`
    );
    await expect(stat(audioFullText)).resolves.toBeTruthy();
    await expect(stat(audioFirstSentence)).resolves.toBeTruthy();
  });

  it("computes overlapGain when both full-text and first-sentence rows exist", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p5-overlap-")), "out");
    const cacheRoot = await mkdtemp(resolve(tmpdir(), "p5-overlap-cache-"));

    const cartesia = makeMockTtsProvider("cartesia", () =>
      defaultSuccess("cartesia", "voice_a")
    );

    const result = await runResponseLatencyBenchmark({
      llmModel: "gpt-mock",
      modes: ["full-text", "first-sentence"],
      ttsProviders: ["cartesia"],
      repeats: 1,
      cases: [
        {
          id: FIRST_CASE_ID,
          category: "short_ack",
          userInput: "はい",
          expectedLength: "short",
          notes: "",
        },
      ],
      outputDir,
      cacheRoot,
      providerFactories: { cartesia: () => cartesia },
      llmClientFactory: () =>
        makeMockLlmClient(["はい、承知しました。続けます。"]),
    });

    expect(result.failures).toBe(0);
    const csv = await readFile(result.metricsCsvPath, "utf8");
    const lines = csv.trim().split("\n").slice(1);
    const firstSentenceLine = lines.find((line) => line.includes(",first-sentence,"));
    expect(firstSentenceLine).toBeDefined();
    const overlapValue = firstSentenceLine?.split(",")[34];
    expect(overlapValue).toBeDefined();
    expect(overlapValue?.length).toBeGreaterThan(0);
  });

  it("marks first audio unavailable for non-streaming TTS providers", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p5-nostream-")), "out");
    const cacheRoot = await mkdtemp(resolve(tmpdir(), "p5-nostream-cache-"));

    const gemini = makeMockTtsProvider("google_gemini", () => ({
      provider: "google_gemini",
      model: "gemini-test",
      voiceId: "Aoede",
      success: true,
      audio: Buffer.from("X"),
      format: "wav",
      sampleRateHz: 24_000,
      bytes: 1,
      requestToFirstAudioMs: null,
      requestToLastAudioMs: 700,
      audioDurationMs: 900,
      rtf: 0.78,
    }));

    const result = await runResponseLatencyBenchmark({
      llmModel: "gpt-mock",
      modes: ["full-text"],
      ttsProviders: ["google_gemini"],
      repeats: 1,
      cases: [
        {
          id: FIRST_CASE_ID,
          category: "short_ack",
          userInput: "はい",
          expectedLength: "short",
          notes: "",
        },
      ],
      outputDir,
      cacheRoot,
      providerFactories: { google_gemini: () => gemini },
      llmClientFactory: () => makeMockLlmClient(["回答。"]),
    });

    const summary = await readFile(result.summaryCsvPath, "utf8");
    expect(summary).toContain("google_gemini");
    const dataLine = summary.trim().split("\n").find((l) => l.includes("google_gemini")) ?? "";
    expect(dataLine).toContain("false"); // firstAudioAvailable=false
  });

  it("records LLM_THROW failure but keeps other modes/cases progressing", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p5-llmfail-")), "out");
    const cacheRoot = await mkdtemp(resolve(tmpdir(), "p5-llmfail-cache-"));

    const failingClient: LlmStreamClient = {
      async *stream() {
        throw new Error("LLM blew up");
      },
    };

    const result = await runResponseLatencyBenchmark({
      llmModel: "gpt-mock",
      modes: ["llm-only"],
      ttsProviders: [],
      repeats: 1,
      cases: [
        {
          id: FIRST_CASE_ID,
          category: "short_ack",
          userInput: "はい",
          expectedLength: "short",
          notes: "",
        },
      ],
      outputDir,
      cacheRoot,
      llmClientFactory: () => failingClient,
    });

    expect(result.totalRows).toBe(1);
    expect(result.failures).toBe(1);
    const metrics = await readFile(result.metricsCsvPath, "utf8");
    expect(metrics).toContain("LLM_THROW");
    expect(metrics).toContain("LLM blew up");
  });
});
