import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StreamingTextEvent } from "@top-performer/vendors";
import {
  runLlmLatencyMatrix,
  type LlmStreamClient,
  type LlmStreamRequest,
} from "./llmLatencyMatrixBenchmark";
import { resolveModelDefinition } from "./modelMatrix";

function makeClient(deltas: string[], onRequest?: (req: LlmStreamRequest) => void): LlmStreamClient {
  return {
    async *stream(input: LlmStreamRequest): AsyncIterable<StreamingTextEvent> {
      onRequest?.(input);
      for (const delta of deltas) {
        yield { kind: "delta", text: delta };
      }
      yield {
        kind: "done",
        fullText: deltas.join(""),
        responseId: "resp_test",
      };
    },
  };
}

const SHORT_CASE = {
  id: "resp_001",
  category: "short_ack" as const,
  userInput: "はい",
  expectedLength: "short" as const,
  notes: "",
};

describe("runLlmLatencyMatrix", () => {
  it("emits one row per (model × case × repeat)", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p6-out-")), "out");
    const result = await runLlmLatencyMatrix({
      models: [
        resolveModelDefinition("openai:gpt-4.1-nano"),
        resolveModelDefinition("openai:gpt-4o-mini"),
      ],
      repeats: 2,
      cases: [SHORT_CASE],
      outputDir,
      llmClientFactory: () => makeClient(["はい、", "承知しました。"]),
    });
    expect(result.totalRows).toBe(4);
    expect(result.failures).toBe(0);
    const metrics = await readFile(result.metricsCsvPath, "utf8");
    expect(metrics).toContain("gpt-4.1-nano");
    expect(metrics).toContain("gpt-4o-mini");

    await expect(stat(result.indexPath)).resolves.toBeTruthy();
    await expect(stat(result.manifestPath)).resolves.toBeTruthy();
  });

  it("propagates default reasoning effort=minimal for gpt-5-nano", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p6-effort-")), "out");
    const seenRequests: LlmStreamRequest[] = [];
    await runLlmLatencyMatrix({
      models: [resolveModelDefinition("openai:gpt-5-nano")],
      repeats: 1,
      cases: [SHORT_CASE],
      outputDir,
      llmClientFactory: () => makeClient(["はい。"], (req) => seenRequests.push(req)),
    });
    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]?.reasoningEffort).toBe("minimal");
  });

  it("CLI override beats per-model default", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p6-override-")), "out");
    const seenRequests: LlmStreamRequest[] = [];
    await runLlmLatencyMatrix({
      models: [resolveModelDefinition("openai:gpt-5-nano")],
      repeats: 1,
      cases: [SHORT_CASE],
      reasoningEffortOverride: "high",
      outputDir,
      llmClientFactory: () => makeClient(["はい。"], (req) => seenRequests.push(req)),
    });
    expect(seenRequests[0]?.reasoningEffort).toBe("high");
  });

  it("does NOT include reasoning effort for non-reasoning models when no override", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p6-noeffort-")), "out");
    const seenRequests: LlmStreamRequest[] = [];
    await runLlmLatencyMatrix({
      models: [resolveModelDefinition("openai:gpt-4.1-nano")],
      repeats: 1,
      cases: [SHORT_CASE],
      outputDir,
      llmClientFactory: () => makeClient(["はい。"], (req) => seenRequests.push(req)),
    });
    expect(seenRequests[0]?.reasoningEffort).toBeUndefined();
  });

  it("sends temperature for non-reasoning models but omits it for reasoning models", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p6-temp-")), "out");
    const seenRequests: LlmStreamRequest[] = [];
    await runLlmLatencyMatrix({
      models: [
        resolveModelDefinition("openai:gpt-4.1-nano"),
        resolveModelDefinition("openai:gpt-5-nano"),
      ],
      repeats: 1,
      cases: [SHORT_CASE],
      temperature: 0.2,
      outputDir,
      llmClientFactory: () => makeClient(["はい。"], (req) => seenRequests.push(req)),
    });
    const nano = seenRequests.find((r) => r.model === "gpt-4.1-nano");
    const gpt5 = seenRequests.find((r) => r.model === "gpt-5-nano");
    expect(nano?.temperature).toBe(0.2);
    expect(gpt5?.temperature).toBeUndefined();
  });

  it("records LLM_THROW per row when stream throws but runner continues", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p6-fail-")), "out");
    const flakyClient: LlmStreamClient = {
      async *stream(): AsyncIterable<StreamingTextEvent> {
        throw new Error("transient");
      },
    };

    const result = await runLlmLatencyMatrix({
      models: [resolveModelDefinition("openai:gpt-4.1-nano")],
      repeats: 2,
      cases: [SHORT_CASE],
      outputDir,
      llmClientFactory: () => flakyClient,
    });

    expect(result.totalRows).toBe(2);
    expect(result.failures).toBe(2);
    const metrics = await readFile(result.metricsCsvPath, "utf8");
    expect(metrics).toContain("LLM_THROW");
    expect(metrics).toContain("transient");
  });

  it("emits FACTORY_ERROR rows when client factory throws", async () => {
    const outputDir = resolve(await mkdtemp(resolve(tmpdir(), "p6-factoryfail-")), "out");
    const result = await runLlmLatencyMatrix({
      models: [
        resolveModelDefinition("openai:gpt-4.1-nano"),
        resolveModelDefinition("openai:gpt-4o-mini"),
      ],
      repeats: 1,
      cases: [SHORT_CASE],
      outputDir,
      llmClientFactory: (def) => {
        if (def.model === "gpt-4.1-nano") {
          throw new Error("missing creds for nano");
        }
        return makeClient(["はい。"]);
      },
    });

    expect(result.totalRows).toBe(2);
    expect(result.failures).toBe(1);
    const metrics = await readFile(result.metricsCsvPath, "utf8");
    expect(metrics).toContain("FACTORY_ERROR");
    expect(metrics).toContain("missing creds for nano");
  });
});
