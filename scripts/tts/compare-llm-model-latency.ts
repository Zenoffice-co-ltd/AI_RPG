import { resolve } from "node:path";
import {
  AnthropicMessagesStreamingClient,
  GoogleAiStudioStreamingClient,
  InworldRouterStreamingClient,
  OpenAiResponsesStreamingClient,
  ZaiChatCompletionsStreamingClient,
  type ReasoningEffort,
} from "../../packages/vendors/src/index";
import {
  runLlmLatencyMatrix,
  type LlmStreamClient,
} from "../../packages/scenario-engine/src/llmLatencyMatrix/llmLatencyMatrixBenchmark";
import {
  MODEL_REGISTRY,
  isValidReasoningEffort,
  parseModelIds,
} from "../../packages/scenario-engine/src/llmLatencyMatrix/modelMatrix";
import type { ModelDefinition } from "../../packages/scenario-engine/src/llmLatencyMatrix/types";

function getArg(flag: string): string | undefined {
  const idx = process.argv.findIndex((value) => value === flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function getBooleanFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getNumberArg(flag: string): number | undefined {
  const value = getArg(flag);
  return value !== undefined ? Number(value) : undefined;
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (!isValidReasoningEffort(value)) {
    throw new Error(
      `Invalid --reasoning-effort "${value}" (allowed: minimal,low,medium,high)`
    );
  }
  return value;
}

type RequiredEnvSpec = { provider: string; envName: string; description: string };

const PROVIDER_REQUIRED_ENV: Record<string, RequiredEnvSpec> = {
  openai: { provider: "openai", envName: "OPENAI_API_KEY", description: "OpenAI Responses API streaming" },
  anthropic: { provider: "anthropic", envName: "ANTHROPIC_API_KEY", description: "Anthropic Messages API streaming" },
  google: { provider: "google", envName: "GOOGLE_API_KEY", description: "Google AI Studio (generativelanguage) streaming" },
  zai: { provider: "zai", envName: "ZAI_API_KEY", description: "Z.AI chat completions streaming" },
  inworld: { provider: "inworld", envName: "INWORLD_API_KEY", description: "Inworld Router chat completions streaming" },
};

function readEnvOrThrow(envName: string, providerLabel: string): string {
  const value = process.env[envName];
  if (!value || value.length === 0) {
    throw new Error(`${envName} not set (required for ${providerLabel} streaming)`);
  }
  return value;
}

function buildClientFor(def: ModelDefinition): LlmStreamClient {
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
    case "zai":
      return new ZaiChatCompletionsStreamingClient({
        apiKey: readEnvOrThrow("ZAI_API_KEY", "zai"),
      });
    case "inworld":
      return new InworldRouterStreamingClient({
        apiKey: readEnvOrThrow("INWORLD_API_KEY", "inworld"),
      });
    default: {
      const _exhaustive: never = def.provider;
      throw new Error(`Unsupported provider: ${_exhaustive as string}`);
    }
  }
}

function preflight(args: {
  models: ModelDefinition[];
  reasoningEffortOverride: ReasoningEffort | undefined;
}): number {
  let exitCode = 0;
  console.info("=== LLM Model Latency Matrix — preflight ===");

  const requiredProviders = new Set(args.models.map((def) => def.provider));
  for (const provider of requiredProviders) {
    const spec = PROVIDER_REQUIRED_ENV[provider];
    if (!spec) {
      console.warn(`[UNKNOWN] provider=${provider} has no env mapping`);
      exitCode = 1;
      continue;
    }
    const value = process.env[spec.envName];
    if (!value || value.trim().length === 0) {
      console.warn(`[MISSING] ${spec.envName} (required for ${spec.description})`);
      exitCode = 1;
    } else {
      console.info(`[OK]      ${spec.envName} (${spec.description})`);
    }
  }

  console.info(`Models (${args.models.length}):`);
  for (const def of args.models) {
    const effort = args.reasoningEffortOverride ?? def.defaultReasoningEffort ?? "(none)";
    console.info(`  - ${def.id} [${def.category}] effort=${effort}`);
  }
  if (args.reasoningEffortOverride) {
    console.info(`Global reasoning effort override: ${args.reasoningEffortOverride}`);
  }
  console.info(`Registered models: ${Object.keys(MODEL_REGISTRY).join(", ")}`);
  return exitCode;
}

async function main() {
  const isPreflight = getBooleanFlag("--preflight");
  const modelsArg = getArg("--models");
  const modesArg = getArg("--modes");
  const repeats = getNumberArg("--repeats") ?? 5;
  const reasoningEffortArg = getArg("--reasoning-effort");
  const temperature = getNumberArg("--temperature") ?? 0.2;
  const maxOutputTokens = getNumberArg("--max-output-tokens") ?? 200;
  const seed = getNumberArg("--seed");
  const outputDirArg = getArg("--output-dir");

  if (modesArg && modesArg !== "llm-only") {
    throw new Error(
      `--modes "${modesArg}" not supported in Stage 1 (only "llm-only"). Use Phase 5 benchmark for TTS-connected modes.`
    );
  }

  const models = parseModelIds(modelsArg);
  const reasoningEffortOverride = parseReasoningEffort(reasoningEffortArg);

  if (isPreflight) {
    const code = preflight({ models, reasoningEffortOverride });
    process.exitCode = code;
    return;
  }

  console.info(
    `[run] models=${models.map((m) => m.id).join(",")} repeats=${repeats} temperature=${temperature} maxOutputTokens=${maxOutputTokens}`
  );

  const result = await runLlmLatencyMatrix({
    models,
    repeats,
    temperature,
    maxOutputTokens,
    ...(seed === undefined ? {} : { seed }),
    ...(reasoningEffortOverride === undefined ? {} : { reasoningEffortOverride }),
    ...(outputDirArg ? { outputDir: resolve(outputDirArg) } : {}),
    llmClientFactory: buildClientFor,
  });

  console.info(JSON.stringify(result, null, 2));
  if (result.failures > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
