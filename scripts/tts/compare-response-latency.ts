import { resolve } from "node:path";
import {
  CartesiaTtsProvider,
  ElevenLabsBaselineTtsProvider,
  FishTtsProvider,
  GoogleGeminiTtsProvider,
  InworldTtsProvider,
  OpenAiResponsesStreamingClient,
  OpenAiTtsProvider,
  type TtsProvider,
  type TtsProviderId,
} from "../../packages/vendors/src/index";
import {
  runResponseLatencyBenchmark,
  type LlmStreamClient,
} from "../../packages/scenario-engine/src/ttsResponseLatency/responseLatencyBenchmark";
import { responseLatencyCases } from "../../packages/scenario-engine/src/ttsResponseLatency/responseCases";
import type { ResponseLatencyMode } from "../../packages/scenario-engine/src/ttsResponseLatency/types";

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

const VALID_TTS_PROVIDERS = new Set<TtsProviderId>([
  "openai",
  "cartesia",
  "inworld",
  "fish",
  "google_gemini",
  "elevenlabs_baseline",
]);

const VALID_MODES: readonly ResponseLatencyMode[] = [
  "llm-only",
  "full-text",
  "first-sentence",
];

function parseTtsProviders(value: string | undefined): TtsProviderId[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!VALID_TTS_PROVIDERS.has(part as TtsProviderId)) {
        throw new Error(
          `Unknown tts provider "${part}". Valid: ${[...VALID_TTS_PROVIDERS].join(", ")}`
        );
      }
      return part as TtsProviderId;
    });
}

function parseModes(value: string | undefined): ResponseLatencyMode[] {
  if (!value) return [...VALID_MODES];
  const result: ResponseLatencyMode[] = [];
  for (const part of value.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!VALID_MODES.includes(part as ResponseLatencyMode)) {
      throw new Error(
        `Unknown mode "${part}". Valid: ${VALID_MODES.join(", ")}`
      );
    }
    result.push(part as ResponseLatencyMode);
  }
  return result;
}

const TTS_PROVIDER_FACTORIES: Record<TtsProviderId, () => TtsProvider> = {
  openai: () => new OpenAiTtsProvider(),
  cartesia: () => new CartesiaTtsProvider(),
  inworld: () => new InworldTtsProvider(),
  fish: () => new FishTtsProvider(),
  google_gemini: () => new GoogleGeminiTtsProvider(),
  elevenlabs_baseline: () => new ElevenLabsBaselineTtsProvider(),
};

function resolveLlmModel(explicit: string | undefined): string {
  if (explicit && explicit.length > 0) return explicit;
  const envSpecific = process.env["OPENAI_RESPONSE_LATENCY_MODEL"];
  if (envSpecific && envSpecific.length > 0) return envSpecific;
  const envMining = process.env["OPENAI_MINING_MODEL"];
  if (envMining && envMining.length > 0) return envMining;
  const envAnalysis = process.env["OPENAI_ANALYSIS_MODEL"];
  if (envAnalysis && envAnalysis.length > 0) return envAnalysis;
  throw new Error(
    "LLM model not configured. Set OPENAI_RESPONSE_LATENCY_MODEL or pass --llm-model"
  );
}

function preflight(args: {
  llmModel: string;
  ttsProviders: TtsProviderId[];
  modes: ResponseLatencyMode[];
}): number {
  let exitCode = 0;
  console.info("=== TTS Response Latency Benchmark — preflight ===");
  console.info(`LLM model: ${args.llmModel}`);
  console.info(`Modes: ${args.modes.join(", ")}`);

  const openaiKey = process.env["OPENAI_API_KEY"];
  if (!openaiKey || openaiKey.trim().length === 0) {
    console.warn("[MISSING] OPENAI_API_KEY (required for LLM streaming)");
    exitCode = 1;
  } else {
    console.info("[OK]      OPENAI_API_KEY");
  }

  const ttsModesNeeded = args.modes.some((m) => m !== "llm-only");
  if (ttsModesNeeded) {
    for (const id of args.ttsProviders) {
      const factory = TTS_PROVIDER_FACTORIES[id];
      const instance = factory();
      const required = instance.requiredEnv;
      const missing = required.filter((key) => {
        const value = process.env[key];
        return value === undefined || value.trim().length === 0;
      });
      if (missing.length === 0) {
        console.info(`[OK]      ${id}  (required: ${required.join(", ") || "(none)"})`);
      } else {
        console.warn(`[MISSING] ${id}  -> ${missing.join(", ")}`);
        exitCode = 1;
      }
    }
  } else {
    console.info("(no TTS providers needed for llm-only mode)");
  }

  return exitCode;
}

function buildLlmClientFactory(): () => LlmStreamClient {
  return () => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey || apiKey.length === 0) {
      throw new Error("OPENAI_API_KEY not set");
    }
    return new OpenAiResponsesStreamingClient({ apiKey });
  };
}

async function main() {
  const isPreflight = getBooleanFlag("--preflight");
  const ttsProvidersArg = getArg("--tts-providers");
  const modesArg = getArg("--modes");
  const llmModelArg = getArg("--llm-model");
  const repeats = getNumberArg("--repeats") ?? 3;
  const seedArg = getNumberArg("--seed");
  const reuseLlmCache = getBooleanFlag("--reuse-llm-cache");
  const refreshLlmCache = getBooleanFlag("--refresh-llm-cache");
  const outputDirArg = getArg("--output-dir");

  const llmProvider = (getArg("--llm") ?? "openai") as "openai";
  if (llmProvider !== "openai") {
    throw new Error(`Unsupported --llm value: ${llmProvider} (only openai is supported)`);
  }

  const modes = parseModes(modesArg);
  const ttsProviders = parseTtsProviders(ttsProvidersArg);
  const llmModel = resolveLlmModel(llmModelArg);

  if (isPreflight) {
    const code = preflight({ llmModel, ttsProviders, modes });
    process.exitCode = code;
    return;
  }

  const ttsModesNeeded = modes.some((m) => m !== "llm-only");
  if (ttsModesNeeded && ttsProviders.length === 0) {
    throw new Error(
      "--tts-providers is required when modes include full-text or first-sentence"
    );
  }

  console.info(
    `[run] llm=${llmModel} modes=${modes.join(",")} ttsProviders=${ttsProviders.join(",") || "(none)"} repeats=${repeats}`
  );

  const result = await runResponseLatencyBenchmark({
    llmProvider,
    llmModel,
    cases: responseLatencyCases,
    ttsProviders,
    modes,
    repeats,
    reuseLlmCache,
    refreshLlmCache,
    ...(seedArg === undefined ? {} : { seed: seedArg }),
    ...(outputDirArg ? { outputDir: resolve(outputDirArg) } : {}),
    llmClientFactory: buildLlmClientFactory(),
    providerFactories: TTS_PROVIDER_FACTORIES,
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
