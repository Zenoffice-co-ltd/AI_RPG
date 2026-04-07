import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBenchmarkIndexHtml,
  buildReviewSheetCsv,
  buildSummaryCsv,
  loadBenchmarkUtterances,
  renderVoiceBenchmark,
} from "./benchmarkRenderer";

describe("benchmarkRenderer", () => {
  it("parses benchmark utterances from CSV", async () => {
    const csvPath = resolve(await mkdtemp(resolve(tmpdir(), "utterances-")), "test.csv");
    await writeFile(
      csvPath,
      [
        "id,category,utterance,contains_number,contains_company_name,contains_role_title,contains_location,notes",
        "u1,opening,よろしくお願いします,false,false,false,false,",
      ].join("\n"),
      "utf8"
    );

    const utterances = await loadBenchmarkUtterances(csvPath);

    expect(utterances).toHaveLength(1);
    expect(utterances[0]?.containsNumber).toBe(false);
    expect(utterances[0]?.category).toBe("opening");
  });

  it("builds review and summary CSV outputs", () => {
    const rows = [
      {
        runId: "run_1",
        timestamp: "2026-04-07T00:00:00.000Z",
        scenarioId: "staffing_order_hearing_busy_manager_medium",
        targetLabel: "Busy Manager JA Baseline v1",
        profileId: "busy_manager_ja_baseline_v1",
        utteranceId: "u1",
        utterance: "よろしくお願いします。",
        category: "opening",
        model: "eleven_flash_v2_5",
        requestedVoiceId: "voice_123",
        resolvedVoiceId: "voice_123",
        textNormalizationStrategy: "elevenlabs" as const,
        settingsSnapshot: {},
        outputFile: "audio/u1.mp3",
        status: "success" as const,
        latencyMs: 420,
      },
    ];

    const reviewSheet = buildReviewSheetCsv(rows);
    const summary = buildSummaryCsv(rows);
    const html = buildBenchmarkIndexHtml({
      runId: "run_1",
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      outputDir: "C:/tmp/run_1",
      rows,
    });

    expect(reviewSheet).toContain("自然さ");
    expect(summary).toContain("resolvedVoiceId");
    expect(html).toContain("<audio controls");
  });

  it("renders benchmark audio, manifest, and failure rows", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "voice-benchmark-"));
    const csvPath = resolve(root, "utterances.csv");
    const outputDir = resolve(root, "out");
    await writeFile(
      csvPath,
      [
        "id,category,utterance,contains_number,contains_company_name,contains_role_title,contains_location,notes",
        "u1,opening,よろしくお願いします,false,false,false,false,",
        "u2,closing,またご連絡します,false,false,false,false,",
      ].join("\n"),
      "utf8"
    );

    let renderCall = 0;
    const fakeElevenLabs = {
      resolveVoiceId: async (voiceId: string) => ({
        voiceId,
        voiceName: "Resolved Voice",
        resolution: "preferred" as const,
      }),
      renderSpeech: async () => {
        renderCall += 1;
        if (renderCall === 2) {
          throw new Error("Synthetic render failure");
        }

        return {
          audio: Buffer.from("audio"),
          latencyMs: 123,
        };
      },
    } as const;

    const result = await renderVoiceBenchmark({
      elevenLabs: fakeElevenLabs as never,
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      rawTarget: {
        source: "raw",
        label: "Raw Target",
        language: "ja",
        modelId: "eleven_flash_v2_5",
        voiceId: "voice_123",
        textNormalisationType: "elevenlabs",
        voiceSettings: {},
      },
      outputDir,
      utteranceCsvPath: csvPath,
      seed: 42,
    });

    expect(result.total).toBe(2);
    expect(result.failed).toBe(1);
    await expect(stat(result.manifestPath)).resolves.toBeTruthy();
    await expect(stat(result.indexPath)).resolves.toBeTruthy();
    const manifest = await readFile(result.manifestPath, "utf8");
    expect(manifest).toContain('"status": "failed"');
    expect(manifest).toContain('"seed": 42');
  });
});
