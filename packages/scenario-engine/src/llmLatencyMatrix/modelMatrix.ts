import type { ReasoningEffort } from "@top-performer/vendors";
import type { LlmMatrixProvider, ModelDefinition } from "./types";

export const MODEL_REGISTRY: Record<string, ModelDefinition> = {
  "openai:gpt-4.1-nano": {
    id: "openai:gpt-4.1-nano",
    provider: "openai",
    model: "gpt-4.1-nano",
    category: "general-fast",
    notes: "Lowest-latency non-reasoning OpenAI text model.",
  },
  "openai:gpt-4.1-mini": {
    id: "openai:gpt-4.1-mini",
    provider: "openai",
    model: "gpt-4.1-mini",
    category: "general-mid",
    notes: "Mid-tier non-reasoning OpenAI text model.",
  },
  "openai:gpt-4o-mini": {
    id: "openai:gpt-4o-mini",
    provider: "openai",
    model: "gpt-4o-mini",
    category: "general-fast",
    notes: "Standard fast non-reasoning OpenAI text model.",
  },
  "openai:gpt-5-nano": {
    id: "openai:gpt-5-nano",
    provider: "openai",
    model: "gpt-5-nano",
    category: "reasoning",
    defaultReasoningEffort: "minimal",
    notes: "GPT-5 nano. Reasoning-class but supports effort=minimal for low-latency conversation.",
  },
  "openai:gpt-5-mini": {
    id: "openai:gpt-5-mini",
    provider: "openai",
    model: "gpt-5-mini",
    category: "reasoning",
    defaultReasoningEffort: "minimal",
    notes:
      "Phase 5 baseline (default effort gave p90 first sentence ≈ 7050ms). Default to minimal here.",
  },
  "anthropic:claude-haiku-4-5-20251001": {
    id: "anthropic:claude-haiku-4-5-20251001",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    category: "general-fast",
    notes: "Anthropic Haiku 4.5. Extended thinking is left disabled (default).",
  },
  "anthropic:claude-sonnet-4-5-20250929": {
    id: "anthropic:claude-sonnet-4-5-20250929",
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    category: "general-mid",
    notes: "Anthropic Sonnet 4.5. Quality/judge candidate. Extended thinking disabled.",
  },
  "openai:gpt-4.1": {
    id: "openai:gpt-4.1",
    provider: "openai",
    model: "gpt-4.1",
    category: "general-mid",
    notes: "OpenAI GPT-4.1 full. Quality/judge candidate. Non-reasoning.",
  },
  "google:gemini-2.5-flash-lite": {
    id: "google:gemini-2.5-flash-lite",
    provider: "google",
    model: "gemini-2.5-flash-lite",
    category: "general-fast",
    notes: "Google AI Studio (generativelanguage). API key auth.",
  },
  "google:gemini-2.5-flash": {
    id: "google:gemini-2.5-flash",
    provider: "google",
    model: "gemini-2.5-flash",
    category: "general-mid",
    notes: "Google AI Studio (generativelanguage). API key auth.",
  },
  "inworld:auto": {
    id: "inworld:auto",
    provider: "inworld",
    model: "auto",
    category: "general-fast",
    notes: "Inworld Router auto-routing across multiple providers.",
  },
};

export const VALID_REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
];

export const VALID_PROVIDERS: readonly LlmMatrixProvider[] = [
  "openai",
  "anthropic",
  "google",
  "zai",
  "inworld",
];

export class UnknownModelError extends Error {
  constructor(id: string, knownIds: string[]) {
    super(
      `Unknown model id "${id}". Registered: ${knownIds.join(", ")}`
    );
    this.name = "UnknownModelError";
  }
}

export function resolveModelDefinition(id: string): ModelDefinition {
  const def = MODEL_REGISTRY[id];
  if (!def) {
    throw new UnknownModelError(id, Object.keys(MODEL_REGISTRY));
  }
  return def;
}

export function parseModelIds(value: string | undefined): ModelDefinition[] {
  const ids = value && value.length > 0
    ? value.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : Object.keys(MODEL_REGISTRY);
  return ids.map((id) => resolveModelDefinition(id));
}

export function effortFor(
  def: ModelDefinition,
  override: ReasoningEffort | undefined
): ReasoningEffort | undefined {
  if (override !== undefined) return override;
  return def.defaultReasoningEffort;
}

export function isValidReasoningEffort(value: string): value is ReasoningEffort {
  return (VALID_REASONING_EFFORTS as readonly string[]).includes(value);
}
