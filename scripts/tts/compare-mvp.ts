import { runProviderBenchmark } from "../../packages/scenario-engine/src/ttsComparison/providerBenchmark";
import {
  CartesiaTtsProvider,
  ElevenLabsBaselineTtsProvider,
  FishTtsProvider,
  GoogleGeminiTtsProvider,
  InworldTtsProvider,
  OpenAiTtsProvider,
  type TtsProvider,
  type TtsProviderId,
} from "../../packages/vendors/src/tts/index";

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

function parseProviderList(value: string | undefined): TtsProviderId[] {
  if (!value) {
    return ["openai"];
  }
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const valid = new Set<TtsProviderId>([
    "openai",
    "cartesia",
    "inworld",
    "fish",
    "google_gemini",
    "elevenlabs_baseline",
  ]);
  const result: TtsProviderId[] = [];
  for (const part of parts) {
    if (valid.has(part as TtsProviderId)) {
      result.push(part as TtsProviderId);
    } else {
      throw new Error(
        `Unknown provider "${part}". Valid: ${[...valid].join(", ")}`
      );
    }
  }
  return result;
}

const PROVIDER_FACTORIES: Record<TtsProviderId, () => TtsProvider> = {
  openai: () => new OpenAiTtsProvider(),
  cartesia: () => new CartesiaTtsProvider(),
  inworld: () => new InworldTtsProvider(),
  fish: () => new FishTtsProvider(),
  google_gemini: () => new GoogleGeminiTtsProvider(),
  elevenlabs_baseline: () => new ElevenLabsBaselineTtsProvider(),
};

function preflight(providers: TtsProviderId[]): number {
  let exitCode = 0;
  console.info("=== TTS Provider Benchmark MVP — preflight ===");
  for (const id of providers) {
    const instance = PROVIDER_FACTORIES[id]();
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
  return exitCode;
}

async function main() {
  const providersArg = getArg("--providers");
  const includeBaseline = getBooleanFlag("--include-elevenlabs-baseline");
  const isPreflight = getBooleanFlag("--preflight");
  const repeats = getNumberArg("--repeats") ?? 1;
  const modeArg = getArg("--mode");
  const mode = modeArg === "cold" ? "cold" : "warm";
  const outputDir = getArg("--output-dir");
  const utterances = getArg("--utterances");

  const providers = parseProviderList(providersArg);
  const providerSet = new Set<TtsProviderId>(providers);
  if (includeBaseline) providerSet.add("elevenlabs_baseline");
  const finalProviders = [...providerSet];

  if (isPreflight) {
    const code = preflight(finalProviders);
    process.exitCode = code;
    return;
  }

  const result = await runProviderBenchmark({
    providers: finalProviders,
    repeats,
    mode,
    includeElevenLabsBaseline: includeBaseline,
    ...(outputDir ? { outputDir } : {}),
    ...(utterances ? { utteranceCsvPath: utterances } : {}),
    providerFactories: PROVIDER_FACTORIES,
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
