import { describe, expect, it } from "vitest";
import {
  MODEL_REGISTRY,
  UnknownModelError,
  effortFor,
  isValidReasoningEffort,
  parseModelIds,
  resolveModelDefinition,
} from "./modelMatrix";

describe("MODEL_REGISTRY", () => {
  it("contains the recommended Stage 1 OpenAI fast models", () => {
    expect(MODEL_REGISTRY["openai:gpt-4.1-nano"]).toBeDefined();
    expect(MODEL_REGISTRY["openai:gpt-4.1-mini"]).toBeDefined();
    expect(MODEL_REGISTRY["openai:gpt-4o-mini"]).toBeDefined();
    expect(MODEL_REGISTRY["openai:gpt-5-nano"]).toBeDefined();
  });

  it("contains Stage 2 multi-provider entries", () => {
    expect(MODEL_REGISTRY["anthropic:claude-haiku-4-5-20251001"]?.provider).toBe("anthropic");
    expect(MODEL_REGISTRY["google:gemini-2.5-flash-lite"]?.provider).toBe("google");
    expect(MODEL_REGISTRY["google:gemini-2.5-flash"]?.provider).toBe("google");
    expect(MODEL_REGISTRY["inworld:auto"]?.provider).toBe("inworld");
  });

  it("does not register Z.AI entries (deferred per ops decision)", () => {
    expect(MODEL_REGISTRY["zai:glm-4.5-air"]).toBeUndefined();
    expect(MODEL_REGISTRY["zai:glm-4.5-airx"]).toBeUndefined();
    expect(MODEL_REGISTRY["zai:glm-4.5-flash"]).toBeUndefined();
  });

  it("does not assign reasoning effort for non-OpenAI fast models", () => {
    expect(
      MODEL_REGISTRY["anthropic:claude-haiku-4-5-20251001"]?.defaultReasoningEffort
    ).toBeUndefined();
    expect(MODEL_REGISTRY["google:gemini-2.5-flash-lite"]?.defaultReasoningEffort).toBeUndefined();
    expect(MODEL_REGISTRY["inworld:auto"]?.defaultReasoningEffort).toBeUndefined();
  });

  it("defaults gpt-5 family to reasoning effort=minimal", () => {
    expect(MODEL_REGISTRY["openai:gpt-5-nano"]?.defaultReasoningEffort).toBe("minimal");
    expect(MODEL_REGISTRY["openai:gpt-5-mini"]?.defaultReasoningEffort).toBe("minimal");
  });

  it("does NOT set reasoning effort for gpt-4.x family", () => {
    expect(MODEL_REGISTRY["openai:gpt-4.1-nano"]?.defaultReasoningEffort).toBeUndefined();
    expect(MODEL_REGISTRY["openai:gpt-4o-mini"]?.defaultReasoningEffort).toBeUndefined();
  });
});

describe("resolveModelDefinition", () => {
  it("returns a registered definition", () => {
    const def = resolveModelDefinition("openai:gpt-4.1-nano");
    expect(def.provider).toBe("openai");
    expect(def.model).toBe("gpt-4.1-nano");
    expect(def.category).toBe("general-fast");
  });

  it("throws UnknownModelError for unregistered ids", () => {
    expect(() => resolveModelDefinition("openai:gpt-99-foo")).toThrow(UnknownModelError);
  });
});

describe("parseModelIds", () => {
  it("returns full registry when value is empty", () => {
    const list = parseModelIds(undefined);
    expect(list.length).toBe(Object.keys(MODEL_REGISTRY).length);
  });

  it("parses csv list and resolves each", () => {
    const list = parseModelIds("openai:gpt-4.1-nano, openai:gpt-4o-mini");
    expect(list).toHaveLength(2);
    expect(list[0]?.model).toBe("gpt-4.1-nano");
    expect(list[1]?.model).toBe("gpt-4o-mini");
  });

  it("throws on unknown id within csv", () => {
    expect(() => parseModelIds("openai:gpt-4.1-nano,openai:bogus")).toThrow(UnknownModelError);
  });
});

describe("effortFor", () => {
  it("uses model default when no override", () => {
    const def = resolveModelDefinition("openai:gpt-5-nano");
    expect(effortFor(def, undefined)).toBe("minimal");
  });

  it("override wins over default", () => {
    const def = resolveModelDefinition("openai:gpt-5-nano");
    expect(effortFor(def, "high")).toBe("high");
  });

  it("returns undefined when neither override nor default", () => {
    const def = resolveModelDefinition("openai:gpt-4.1-nano");
    expect(effortFor(def, undefined)).toBeUndefined();
  });
});

describe("isValidReasoningEffort", () => {
  it("accepts only the four documented values", () => {
    expect(isValidReasoningEffort("minimal")).toBe(true);
    expect(isValidReasoningEffort("low")).toBe(true);
    expect(isValidReasoningEffort("medium")).toBe(true);
    expect(isValidReasoningEffort("high")).toBe(true);
    expect(isValidReasoningEffort("none")).toBe(false);
    expect(isValidReasoningEffort("")).toBe(false);
  });
});
