import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  TtsProvider,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from "@top-performer/vendors";
import { runProviderBenchmark } from "./providerBenchmark";

const UTTERANCES_HEADER =
  "id,category,utterance,contains_number,contains_company_name,contains_role_title,contains_location,notes";

async function writeUtterancesCsv(rows: string[]): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "tts-benchmark-"));
  const csvPath = resolve(dir, "utterances.csv");
  await writeFile(csvPath, [UTTERANCES_HEADER, ...rows].join("\n"), "utf8");
  return csvPath;
}

function makeMockProvider(
  id: TtsProvider["id"],
  fn: (input: TtsSynthesisInput, callIndex: number) => TtsSynthesisResult
): TtsProvider {
  let callIndex = 0;
  return {
    id,
    requiredEnv: [],
    async synthesize(input) {
      const result = fn(input, callIndex);
      callIndex += 1;
      return result;
    },
  };
}

describe("runProviderBenchmark", () => {
  it("emits metrics, summary, review-sheet, manifest, index.html and audio", async () => {
    const csvPath = await writeUtterancesCsv([
      "u1,opening,よろしくお願いします,false,false,false,false,",
    ]);
    const outputDir = resolve(
      await mkdtemp(resolve(tmpdir(), "tts-benchmark-out-")),
      "out"
    );

    const okProvider = makeMockProvider("openai", () => ({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voiceId: "marin",
      success: true,
      audio: Buffer.from("FAKE_AUDIO"),
      format: "wav",
      sampleRateHz: 24_000,
      bytes: 10,
      requestToFirstAudioMs: 120,
      requestToLastAudioMs: 480,
      audioDurationMs: 1000,
      rtf: 0.48,
      vendorRequestId: "req_test",
    }));

    const cartesiaProvider = makeMockProvider("cartesia", (_input, idx) => ({
      provider: "cartesia",
      model: "sonic-3",
      voiceId: "voice_a",
      success: true,
      audio: Buffer.from("FAKE_AUDIO"),
      format: "wav",
      sampleRateHz: 24_000,
      bytes: 10,
      requestToFirstAudioMs: 100 + idx * 5,
      requestToLastAudioMs: 400 + idx * 10,
      audioDurationMs: 1000,
      rtf: 0.4,
    }));

    const result = await runProviderBenchmark({
      providers: ["openai", "cartesia"],
      utteranceCsvPath: csvPath,
      outputDir,
      repeats: 2,
      mode: "cold",
      providerFactories: {
        openai: () => okProvider,
        cartesia: () => cartesiaProvider,
      },
    });

    expect(result.totalCalls).toBe(4);
    expect(result.failures).toBe(0);

    const metrics = await readFile(result.metricsCsvPath, "utf8");
    const lines = metrics.trim().split("\n");
    expect(lines.length).toBe(5); // header + 4 rows
    expect(lines[0]).toContain("requestToFirstAudioMs");

    const summary = await readFile(result.summaryCsvPath, "utf8");
    expect(summary).toContain("p50FirstAudioMs");
    expect(summary).toContain("openai");
    expect(summary).toContain("cartesia");

    const reviewSheet = await readFile(result.reviewSheetPath, "utf8");
    expect(reviewSheet).toContain("自然さ");
    expect(reviewSheet).toContain("providerHiddenId");

    await expect(stat(result.indexPath)).resolves.toBeTruthy();
    await expect(stat(result.manifestPath)).resolves.toBeTruthy();

    const indexHtml = await readFile(result.indexPath, "utf8");
    expect(indexHtml).toContain("toggle-blind");
    expect(indexHtml).toContain("<audio controls");
  });

  it("continues across providers when one fails", async () => {
    const csvPath = await writeUtterancesCsv([
      "u1,opening,テストです,false,false,false,false,",
    ]);
    const outputDir = resolve(
      await mkdtemp(resolve(tmpdir(), "tts-benchmark-fail-")),
      "out"
    );

    const failing = makeMockProvider("inworld", () => ({
      provider: "inworld",
      model: "inworld-tts-1.5-mini",
      success: false,
      format: "wav",
      sampleRateHz: 24_000,
      bytes: 0,
      requestToFirstAudioMs: null,
      requestToLastAudioMs: null,
      audioDurationMs: null,
      rtf: null,
      errorCode: "ENV_MISSING",
      errorMessage: "Missing INWORLD_API_KEY",
    }));

    const ok = makeMockProvider("openai", () => ({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voiceId: "marin",
      success: true,
      audio: Buffer.from("X"),
      format: "wav",
      sampleRateHz: 24_000,
      bytes: 1,
      requestToFirstAudioMs: 100,
      requestToLastAudioMs: 300,
      audioDurationMs: 800,
      rtf: 0.375,
    }));

    const result = await runProviderBenchmark({
      providers: ["inworld", "openai"],
      utteranceCsvPath: csvPath,
      outputDir,
      repeats: 1,
      mode: "cold",
      providerFactories: {
        inworld: () => failing,
        openai: () => ok,
      },
    });

    expect(result.totalCalls).toBe(2);
    expect(result.failures).toBe(1);

    const metrics = await readFile(result.metricsCsvPath, "utf8");
    expect(metrics).toContain("ENV_MISSING");
    expect(metrics).toContain("Missing INWORLD_API_KEY");
    expect(metrics).toContain("openai");
  });

  it("marks firstAudioAvailable=false in summary when provider has no streaming", async () => {
    const csvPath = await writeUtterancesCsv([
      "u1,opening,こんにちは,false,false,false,false,",
    ]);
    const outputDir = resolve(
      await mkdtemp(resolve(tmpdir(), "tts-benchmark-nostream-")),
      "out"
    );

    const nonStream = makeMockProvider("google_gemini", () => ({
      provider: "google_gemini",
      model: "gemini-3.1-flash-tts-preview",
      voiceId: "Aoede",
      success: true,
      audio: Buffer.from("AUDIO"),
      format: "wav",
      sampleRateHz: 24_000,
      bytes: 5,
      requestToFirstAudioMs: null,
      requestToLastAudioMs: 720,
      audioDurationMs: 900,
      rtf: 0.8,
    }));

    const result = await runProviderBenchmark({
      providers: ["google_gemini"],
      utteranceCsvPath: csvPath,
      outputDir,
      repeats: 1,
      mode: "cold",
      providerFactories: {
        google_gemini: () => nonStream,
      },
    });

    const summary = await readFile(result.summaryCsvPath, "utf8");
    const dataLine = summary.trim().split("\n")[1] ?? "";
    expect(dataLine).toContain("google_gemini");
    expect(dataLine).toContain("false"); // firstAudioAvailable
    // The two columns immediately after firstAudioAvailable=false should be empty.
    expect(dataLine).toMatch(/false,,,/);
  });
});
