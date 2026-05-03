import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AnthropicMessagesStreamingClient,
  AnthropicMessagesStructuredClient,
  CartesiaTtsProvider,
  ElevenLabsBaselineTtsProvider,
  ElevenLabsClient,
  ElevenLabsConvAiClient,
  FishTtsProvider,
  GoogleAiStudioStreamingClient,
  GoogleGeminiTtsProvider,
  InworldRouterStreamingClient,
  InworldTtsProvider,
  OpenAiResponsesClient,
  OpenAiResponsesStreamingClient,
  OpenAiTtsProvider,
  type ReasoningEffort,
  type TtsProvider,
  type TtsProviderId,
} from "../../packages/vendors/src/index";
import {
  parseModelIds,
  isValidReasoningEffort,
  effortFor,
} from "../../packages/scenario-engine/src/llmLatencyMatrix/modelMatrix";
import type {
  ModelDefinition,
} from "../../packages/scenario-engine/src/llmLatencyMatrix/types";
import type {
  LlmStreamClient,
} from "../../packages/scenario-engine/src/llmLatencyMatrix/llmLatencyMatrixBenchmark";
import {
  runQualityLatencyGenerate,
} from "../../packages/scenario-engine/src/qualityLatency/qualityLatencyBenchmark";
import {
  qualityLatencyCases,
} from "../../packages/scenario-engine/src/qualityLatency/cases";
import {
  scoreRow,
} from "../../packages/scenario-engine/src/qualityLatency/ruleScorer";
import {
  AnthropicJudgeClient,
  OpenAiJudgeClient,
  judgeOneRow,
  type JudgeStructuredClient,
} from "../../packages/scenario-engine/src/qualityLatency/judgeRunner";
import {
  AnthropicPairwiseClient,
  OpenAiPairwiseClient,
  comparePair,
  type PairwiseStructuredClient,
} from "../../packages/scenario-engine/src/qualityLatency/pairwiseRunner";
import {
  buildJudgeScoresCsv,
  buildJudgeSummaryCsv,
  buildPairwiseCsv,
  buildPairwiseSummaryCsv,
  buildRuleScoresCsv,
  buildFrontierCsv,
} from "../../packages/scenario-engine/src/qualityLatency/csvWriters";
import {
  loadE2eMetricsCsv,
  loadJudgeScoresCsv,
  loadLlmTextEntries,
  loadMetricsCsv,
  loadRuleScoresCsv,
  runE2e,
} from "../../packages/scenario-engine/src/qualityLatency/e2eRunner";
import {
  computeFrontier,
} from "../../packages/scenario-engine/src/qualityLatency/paretoFrontier";
import {
  buildQualityLatencyIndexHtml,
} from "../../packages/scenario-engine/src/qualityLatency/indexHtml";
import {
  ELEVENLABS_LABEL,
  elevenlabsAgentRuleScores,
  elevenlabsRowsToE2e,
  elevenlabsRowsToQualityRows,
  loadElevenLabsAgentMetricsCsv,
  runElevenLabsAgent,
} from "../../packages/scenario-engine/src/qualityLatency/elevenlabsAgentRunner";
import {
  QUALITY_LATENCY_SYSTEM_PROMPT,
} from "../../packages/scenario-engine/src/qualityLatency/systemPrompt";

function getArg(flag: string): string | undefined {
  const idx = process.argv.findIndex((v) => v === flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
function getBooleanFlag(flag: string): boolean {
  return process.argv.includes(flag);
}
function getNumberArg(flag: string): number | undefined {
  const v = getArg(flag);
  return v !== undefined ? Number(v) : undefined;
}

const TTS_FACTORIES: Record<TtsProviderId, () => TtsProvider> = {
  openai: () => new OpenAiTtsProvider(),
  cartesia: () => new CartesiaTtsProvider(),
  inworld: () => new InworldTtsProvider(),
  fish: () => new FishTtsProvider(),
  google_gemini: () => new GoogleGeminiTtsProvider(),
  elevenlabs_baseline: () => new ElevenLabsBaselineTtsProvider(),
};

function parseTtsProviders(value: string | undefined): TtsProviderId[] {
  if (!value) return ["cartesia", "fish", "openai", "inworld", "google_gemini"];
  return value.split(",").map((s) => s.trim()).filter(Boolean) as TtsProviderId[];
}
function parseModes(value: string | undefined): ("first-sentence" | "full-text")[] {
  if (!value) return ["first-sentence", "full-text"];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is "first-sentence" | "full-text" => s === "first-sentence" || s === "full-text");
}

function readEnvOrThrow(name: string, label: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`${name} not set (${label})`);
  return v;
}

function buildLlmClientFor(def: ModelDefinition): LlmStreamClient {
  switch (def.provider) {
    case "openai":
      return new OpenAiResponsesStreamingClient({
        apiKey: readEnvOrThrow("OPENAI_API_KEY", "openai"),
      });
    case "anthropic":
      return new AnthropicMessagesStreamingClient({
        apiKey: readEnvOrThrow("ANTHROPIC_API_KEY", "anthropic"),
      });
    case "google":
      return new GoogleAiStudioStreamingClient({
        apiKey: readEnvOrThrow("GOOGLE_API_KEY", "google"),
      });
    case "inworld":
      return new InworldRouterStreamingClient({
        apiKey: readEnvOrThrow("INWORLD_API_KEY", "inworld"),
      });
    case "zai":
      throw new Error("zai is intentionally not wired in this CLI.");
    default: {
      const _exhaustive: never = def.provider;
      throw new Error(`Unknown provider: ${_exhaustive as string}`);
    }
  }
}

function buildJudgeClient(spec: { provider: "openai" | "anthropic"; model: string }): JudgeStructuredClient {
  if (spec.provider === "openai") {
    const responses = new OpenAiResponsesClient(readEnvOrThrow("OPENAI_API_KEY", "openai"));
    return new OpenAiJudgeClient(responses, spec.model);
  }
  const client = new AnthropicMessagesStructuredClient({
    apiKey: readEnvOrThrow("ANTHROPIC_API_KEY", "anthropic"),
  });
  return new AnthropicJudgeClient(client, spec.model);
}

function buildPairwiseClient(spec: { provider: "openai" | "anthropic"; model: string }): PairwiseStructuredClient {
  if (spec.provider === "openai") {
    const responses = new OpenAiResponsesClient(readEnvOrThrow("OPENAI_API_KEY", "openai"));
    return new OpenAiPairwiseClient(responses, spec.model);
  }
  const client = new AnthropicMessagesStructuredClient({
    apiKey: readEnvOrThrow("ANTHROPIC_API_KEY", "anthropic"),
  });
  return new AnthropicPairwiseClient(client, spec.model);
}

function parseJudgeModelSpecs(value: string | undefined): { provider: "openai" | "anthropic"; model: string }[] {
  const defaults = "anthropic:claude-sonnet-4-5-20250929,openai:gpt-4.1";
  return (value ?? defaults)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => {
      const [provider, model] = id.split(":");
      if (provider !== "openai" && provider !== "anthropic") {
        throw new Error(`Judge provider must be openai or anthropic: got "${id}"`);
      }
      return { provider, model: model ?? "" };
    });
}

const REPO_ROOT = resolve(__dirname, "..", "..");
const OUTPUT_ROOT = resolve(REPO_ROOT, "data", "generated", "quality-latency-benchmark");

function defaultRunDir(runId: string): string {
  return resolve(OUTPUT_ROOT, runId);
}

async function main() {
  const isPreflight = getBooleanFlag("--preflight");
  const doScoreRules = getBooleanFlag("--score-rules");
  const doJudge = getBooleanFlag("--judge");
  const doPairwise = getBooleanFlag("--pairwise");
  const doE2e = getBooleanFlag("--e2e");
  const doPareto = getBooleanFlag("--pareto");
  const doElevenLabsAgent = getBooleanFlag("--elevenlabs-agent");
  const runArg = getArg("--run");
  const modelsArg = getArg("--models");
  const repeats = getNumberArg("--repeats") ?? 10;
  const reasoningArg = getArg("--reasoning-effort");
  const temperature = getNumberArg("--temperature") ?? 0.2;
  const maxOutputTokens = getNumberArg("--max-output-tokens") ?? 220;
  const seed = getNumberArg("--seed");
  const caseLimit = getNumberArg("--cases-limit");
  const outputDirArg = getArg("--output-dir");

  const reasoningEffortOverride =
    reasoningArg && isValidReasoningEffort(reasoningArg)
      ? (reasoningArg as ReasoningEffort)
      : undefined;
  if (reasoningArg && !reasoningEffortOverride) {
    throw new Error(`Invalid --reasoning-effort "${reasoningArg}"`);
  }

  if (isPreflight) {
    const models = modelsArg ? parseModelIds(modelsArg) : [];
    console.info("=== Quality-Latency Benchmark — preflight ===");
    const requiredEnv: Record<string, string> = {};
    for (const def of models) {
      if (def.provider === "openai") requiredEnv["OPENAI_API_KEY"] = "openai";
      if (def.provider === "anthropic") requiredEnv["ANTHROPIC_API_KEY"] = "anthropic";
      if (def.provider === "google") requiredEnv["GOOGLE_API_KEY"] = "google";
      if (def.provider === "inworld") requiredEnv["INWORLD_API_KEY"] = "inworld";
    }
    let exitCode = 0;
    for (const [env, label] of Object.entries(requiredEnv)) {
      const v = process.env[env];
      if (!v || v.length === 0) {
        console.warn(`[MISSING] ${env} (${label})`);
        exitCode = 1;
      } else {
        console.info(`[OK]      ${env} (${label})`);
      }
    }
    console.info(`Models: ${models.map((m) => m.id).join(", ") || "(none specified)"}`);
    process.exitCode = exitCode;
    return;
  }

  if (doScoreRules) {
    if (!runArg) throw new Error("--score-rules requires --run <runId>");
    const runDir = outputDirArg ?? defaultRunDir(runArg);
    const metrics = await loadMetricsCsv(resolve(runDir, "metrics.csv"));
    const caseById = new Map(qualityLatencyCases.map((c) => [c.id, c]));
    const ruleRows = metrics
      .map((row) => {
        const c = caseById.get(row.caseId);
        if (!c || row.status !== "success") return null;
        return scoreRow({ row, caseDef: c });
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const path = resolve(runDir, "rule-scores.csv");
    await writeFile(path, `${buildRuleScoresCsv(ruleRows)}\n`, "utf8");
    console.info(JSON.stringify({ runId: runArg, ruleScoresPath: path, total: ruleRows.length }, null, 2));
    return;
  }

  if (doJudge) {
    if (!runArg) throw new Error("--judge requires --run <runId>");
    const runDir = outputDirArg ?? defaultRunDir(runArg);
    const metrics = await loadMetricsCsv(resolve(runDir, "metrics.csv"));
    const caseById = new Map(qualityLatencyCases.map((c) => [c.id, c]));
    const judgeSpecs = parseJudgeModelSpecs(getArg("--judge-models"));
    const allJudgeRows: Awaited<ReturnType<typeof judgeOneRow>>[] = [];
    for (const spec of judgeSpecs) {
      const client = buildJudgeClient(spec);
      console.info(`[judge] using ${spec.provider}:${spec.model}`);
      let i = 0;
      for (const row of metrics) {
        if (row.status !== "success") continue;
        const caseDef = caseById.get(row.caseId);
        if (!caseDef) continue;
        const result = await judgeOneRow({
          judgeProvider: spec.provider,
          judgeModel: spec.model,
          judgeClient: client,
          row,
          caseDef,
        });
        allJudgeRows.push(result);
        i += 1;
        if (i % 25 === 0) console.info(`[judge] ${spec.model} ${i} rows...`);
      }
    }
    const path = resolve(runDir, "judge-scores.csv");
    const summaryPath = resolve(runDir, "judge-summary.csv");
    await writeFile(path, `${buildJudgeScoresCsv(allJudgeRows)}\n`, "utf8");
    await writeFile(summaryPath, `${buildJudgeSummaryCsv(allJudgeRows)}\n`, "utf8");
    console.info(JSON.stringify({
      runId: runArg,
      judgeScoresPath: path,
      summaryPath,
      total: allJudgeRows.length,
      failed: allJudgeRows.filter((r) => r.status === "failed").length,
    }, null, 2));
    return;
  }

  if (doPairwise) {
    if (!runArg) throw new Error("--pairwise requires --run <runId>");
    const runDir = outputDirArg ?? defaultRunDir(runArg);
    const metrics = await loadMetricsCsv(resolve(runDir, "metrics.csv"));
    const caseById = new Map(qualityLatencyCases.map((c) => [c.id, c]));
    const judgeSpecs = parseJudgeModelSpecs(getArg("--judge-models"));
    const candidatesArg = getArg("--pairwise-candidates");
    const targetCandidates = candidatesArg
      ? new Set(candidatesArg.split(",").map((s) => s.trim()))
      : null;
    const byKey = new Map<string, typeof metrics>();
    for (const row of metrics) {
      if (row.status !== "success") continue;
      if (targetCandidates && !targetCandidates.has(`${row.provider}:${row.model}`)) continue;
      const k = `${row.caseId}|${row.repeatIndex}`;
      const list = byKey.get(k) ?? [];
      list.push(row);
      byKey.set(k, list);
    }
    const allPwRows: Awaited<ReturnType<typeof comparePair>>[] = [];
    for (const spec of judgeSpecs) {
      const client = buildPairwiseClient(spec);
      console.info(`[pairwise] using ${spec.provider}:${spec.model}`);
      let i = 0;
      for (const list of byKey.values()) {
        for (let a = 0; a < list.length; a += 1) {
          for (let b = a + 1; b < list.length; b += 1) {
            const rowA = list[a]!;
            const rowB = list[b]!;
            const caseDef = caseById.get(rowA.caseId);
            if (!caseDef) continue;
            const result = await comparePair({
              judgeProvider: spec.provider,
              judgeModel: spec.model,
              client,
              caseDef,
              rowA,
              rowB,
            });
            allPwRows.push(result);
            i += 1;
            if (i % 50 === 0) console.info(`[pairwise] ${spec.model} ${i} comparisons...`);
          }
        }
      }
    }
    const path = resolve(runDir, "pairwise.csv");
    const summaryPath = resolve(runDir, "pairwise-summary.csv");
    await writeFile(path, `${buildPairwiseCsv(allPwRows)}\n`, "utf8");
    await writeFile(summaryPath, `${buildPairwiseSummaryCsv(allPwRows)}\n`, "utf8");
    console.info(JSON.stringify({
      runId: runArg,
      pairwisePath: path,
      summaryPath,
      total: allPwRows.length,
    }, null, 2));
    return;
  }

  if (doE2e) {
    if (!runArg) throw new Error("--e2e requires --run <runId>");
    const runDir = outputDirArg ?? defaultRunDir(runArg);
    const ttsProviders = parseTtsProviders(getArg("--tts-providers"));
    const modes = parseModes(getArg("--modes"));
    const llmEntries = await loadLlmTextEntries(resolve(runDir, "llm-text"));
    const judgeRows = await loadJudgeScoresCsv(resolve(runDir, "judge-scores.csv")).catch(() => []);
    const ruleRows = await loadRuleScoresCsv(resolve(runDir, "rule-scores.csv")).catch(() => []);
    const limitedCases =
      caseLimit !== undefined
        ? qualityLatencyCases.slice(0, Math.max(1, caseLimit))
        : qualityLatencyCases;
    const limitedCaseIds = new Set(limitedCases.map((c) => c.id));
    const filteredEntries = llmEntries.filter((e) => limitedCaseIds.has(e.caseId));
    console.info(
      `[e2e] cases=${limitedCases.length} ttsProviders=${ttsProviders.join(",")} modes=${modes.join(",")} repeats=${repeats}`
    );
    const result = await runE2e({
      runId: runArg,
      outputDir: runDir,
      llmTextEntries: filteredEntries,
      ttsProviders,
      modes,
      repeats,
      cases: limitedCases,
      judgeRows,
      ruleRows,
      providerFactories: TTS_FACTORIES,
    });
    console.info(JSON.stringify(result, null, 2));
    if (result.failures > 0) process.exitCode = 1;
    return;
  }

  if (doElevenLabsAgent) {
    if (!runArg) throw new Error("--elevenlabs-agent requires --run <runId>");
    const runDir = outputDirArg ?? defaultRunDir(runArg);
    const apiKey = readEnvOrThrow("ELEVENLABS_API_KEY", "elevenlabs");
    const productionAgentId =
      getArg("--agent-id") ??
      process.env["ELEVENLABS_AGENT_ID"] ??
      "agent_2801kpj49tj1f43sr840cvy17zcc";
    const useTempAgent = getBooleanFlag("--create-temp-agent");
    const customLlmLabel = getArg("--elevenlabs-llm-label");

    let activeAgentId = productionAgentId;
    let llmLabel = customLlmLabel ?? ELEVENLABS_LABEL;
    let createdTempAgentId: string | null = null;
    let originalWebhookId: string | null = null;
    let originalEvents: string[] = [];
    let originalTranscriptFormat = "json";
    let originalSendAudio = false;
    let webhookWasDetached = false;
    const elClient = new ElevenLabsClient(apiKey);

    // Detach workspace-level post-call webhook BEFORE any conversation traffic
    // so the production Adecco eval webhook does not fire on benchmark calls.
    // Restored in the finally block regardless of success/failure.
    console.info(
      `[elevenlabs-agent] reading workspace ConvAI settings to snapshot post_call_webhook_id...`
    );
    const settingsBefore = await elClient.getConvaiSettings();
    originalWebhookId = settingsBefore.webhooks.post_call_webhook_id;
    originalEvents = settingsBefore.webhooks.events;
    originalTranscriptFormat = settingsBefore.webhooks.transcript_format;
    originalSendAudio = settingsBefore.webhooks.send_audio;
    if (originalWebhookId) {
      console.info(
        `[elevenlabs-agent] DETACHING workspace post-call webhook (was ${originalWebhookId}). Production eval webhook will NOT fire during the benchmark window.`
      );
      await elClient.setConvaiPostCallWebhookId(null, {
        events: originalEvents,
        transcriptFormat: originalTranscriptFormat,
        sendAudio: originalSendAudio,
      });
      webhookWasDetached = true;
    } else {
      console.info(
        `[elevenlabs-agent] no workspace post-call webhook configured; nothing to detach.`
      );
    }

    if (useTempAgent) {
      console.info(`[elevenlabs-agent] inspecting production agent ${productionAgentId} to clone llm+voice+tts...`);
      const prod = await elClient.getAgent(productionAgentId);
      const cc = prod.conversation_config as
        | {
            agent?: {
              prompt?: { llm?: string };
              language?: string;
            };
            tts?: { model_id?: string; voice_id?: string };
          }
        | undefined;
      const prodLlm = cc?.agent?.prompt?.llm ?? "glm-45-air-fp8";
      const prodVoice = cc?.tts?.voice_id ?? "";
      const prodTtsModel = cc?.tts?.model_id ?? "eleven_v3_conversational";
      const prodLanguage = cc?.agent?.language ?? "ja";
      if (!prodVoice) {
        throw new Error("Production agent has no voice_id; cannot clone for benchmark.");
      }
      console.info(
        `[elevenlabs-agent] prod config: llm=${prodLlm} voice=${prodVoice} tts=${prodTtsModel} language=${prodLanguage}`
      );

      const tempName = `latency-benchmark-${runArg}`;
      console.info(`[elevenlabs-agent] creating temp agent "${tempName}" with generic system prompt...`);
      const created = await elClient.createAgent({
        name: tempName,
        prompt: QUALITY_LATENCY_SYSTEM_PROMPT,
        firstMessage: "",
        knowledgeBase: [],
        llmModel: prodLlm,
        language: prodLanguage,
        tts: {
          modelId: prodTtsModel,
          voiceId: prodVoice,
        },
      });
      activeAgentId = created.agent_id;
      createdTempAgentId = activeAgentId;
      llmLabel = customLlmLabel ?? `elevenlabs:${prodLlm}`;
      console.info(`[elevenlabs-agent] temp agent created: ${activeAgentId}`);
      // Note: post-call webhook suppression is handled at workspace level (above).
      // Per-agent override (workspace_overrides.webhooks.events=[]) does NOT take
      // effect on this ElevenLabs API as of 2026-05-03; only workspace-level
      // detach reliably stops post-call events from firing.
    }

    let result: Awaited<ReturnType<typeof runElevenLabsAgent>>;
    try {
      const client = new ElevenLabsConvAiClient({ apiKey, agentId: activeAgentId });
      result = await runElevenLabsAgent({
        runId: runArg,
        outputDir: runDir,
        agentId: activeAgentId,
        llmLabel,
        repeats,
        ...(caseLimit !== undefined ? { caseLimit } : {}),
        timeoutMs: 60_000,
        client,
      });
    } finally {
      if (createdTempAgentId) {
        try {
          await elClient.deleteAgent(createdTempAgentId);
          console.info(`[elevenlabs-agent] temp agent deleted: ${createdTempAgentId}`);
        } catch (deleteError) {
          const message =
            deleteError instanceof Error ? deleteError.message : String(deleteError);
          console.warn(
            `[elevenlabs-agent] WARN: failed to delete temp agent ${createdTempAgentId}: ${message}. Manual cleanup required.`
          );
        }
      }
      if (webhookWasDetached) {
        try {
          await elClient.setConvaiPostCallWebhookId(originalWebhookId, {
            events: originalEvents,
            transcriptFormat: originalTranscriptFormat,
            sendAudio: originalSendAudio,
          });
          console.info(
            `[elevenlabs-agent] RESTORED workspace post-call webhook to ${originalWebhookId}.`
          );
        } catch (restoreError) {
          const message =
            restoreError instanceof Error ? restoreError.message : String(restoreError);
          console.error(
            `[elevenlabs-agent] CRITICAL: failed to restore workspace post-call webhook (${originalWebhookId}): ${message}`
          );
          console.error(
            `[elevenlabs-agent] MANUAL ACTION REQUIRED: PATCH /v1/convai/settings { "webhooks": { "post_call_webhook_id": "${originalWebhookId}", "events": ["transcript"] } }`
          );
        }
      }
    }

    console.info(JSON.stringify(result, null, 2));
    if (result.failures > 0) process.exitCode = 1;
    return;
  }

  if (doPareto) {
    if (!runArg) throw new Error("--pareto requires --run <runId>");
    const runDir = outputDirArg ?? defaultRunDir(runArg);
    const e2ePath = resolve(runDir, "e2e-metrics.csv");
    const judgePath = resolve(runDir, "judge-scores.csv");
    const rulePath = resolve(runDir, "rule-scores.csv");
    const e2eRows = await loadE2eMetricsCsv(e2ePath);
    const judgeRows = await loadJudgeScoresCsv(judgePath).catch(() => []);
    const ruleRows = await loadRuleScoresCsv(rulePath).catch(() => []);

    // Optionally inject ElevenLabs Agent rows into the same frontier.
    const elevenLabsPath = resolve(runDir, "elevenlabs-agent-metrics.csv");
    let mergedE2eRows: typeof e2eRows = e2eRows;
    let mergedRuleRows = ruleRows;
    let mergedJudgeRows = judgeRows;
    try {
      const elRows = await loadElevenLabsAgentMetricsCsv(elevenLabsPath);
      if (elRows.length > 0) {
        const synthesizedE2e = elevenlabsRowsToE2e(elRows);
        const caseLookup = new Map(qualityLatencyCases.map((c) => [c.id, c]));
        const inlineRule = elevenlabsAgentRuleScores(elRows, caseLookup);
        mergedE2eRows = [...e2eRows, ...synthesizedE2e];
        mergedRuleRows = [...ruleRows, ...inlineRule];
        // If the user ran --judge with elevenlabs candidate (provider="elevenlabs",
        // model=ELEVENLABS_LABEL.split(":")[1]), those judge rows are already in judgeRows.
        // We do not synthesize quality scores here; rule pass rate alone drives quality
        // for ElevenLabs unless --judge has been re-run to include it.
        console.info(`[pareto] merged ${elRows.length} ElevenLabs Agent rows into frontier`);
      }
    } catch {
      // elevenlabs-agent-metrics.csv not present; skip silently.
    }
    const points = computeFrontier({
      e2eRows: mergedE2eRows,
      judgeRows: mergedJudgeRows,
      ruleRows: mergedRuleRows,
    });
    const path = resolve(runDir, "quality-latency-frontier.csv");
    await writeFile(path, `${buildFrontierCsv(points)}\n`, "utf8");

    // also rebuild index.html with all data (incl. ElevenLabs if present)
    const generationRows = await loadMetricsCsv(resolve(runDir, "metrics.csv"));
    let mergedGenerationRows = generationRows;
    try {
      const elRows = await loadElevenLabsAgentMetricsCsv(elevenLabsPath);
      if (elRows.length > 0) {
        mergedGenerationRows = [...generationRows, ...elevenlabsRowsToQualityRows(elRows)];
      }
    } catch {
      // ignore
    }
    const html = buildQualityLatencyIndexHtml({
      runId: runArg,
      outputDir: runDir,
      generationRows: mergedGenerationRows,
      ruleRows: mergedRuleRows,
      judgeRows: mergedJudgeRows,
      e2eRows: mergedE2eRows,
      frontier: points,
    });
    await writeFile(resolve(runDir, "index.html"), html, "utf8");
    console.info(JSON.stringify({ runId: runArg, frontierPath: path, points: points.length }, null, 2));
    return;
  }

  // default: generate
  const models = parseModelIds(modelsArg);
  console.info(
    `[generate] models=${models.map((m) => m.id).join(",")} repeats=${repeats} cases=${caseLimit ?? qualityLatencyCases.length}`
  );
  const result = await runQualityLatencyGenerate({
    models,
    repeats,
    temperature,
    maxOutputTokens,
    ...(caseLimit !== undefined ? { caseLimit } : {}),
    ...(seed === undefined ? {} : { seed }),
    ...(reasoningEffortOverride === undefined ? {} : { reasoningEffortOverride }),
    ...(outputDirArg ? { outputDir: resolve(outputDirArg) } : {}),
    llmClientFactory: buildLlmClientFor,
  });
  console.info(JSON.stringify(result, null, 2));
  if (result.failures > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
