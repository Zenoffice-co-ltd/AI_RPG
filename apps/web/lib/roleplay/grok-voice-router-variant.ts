export const ADECCO_GROK_VOICE_DEMO_SLUGS = [
  "adecco-roleplay-v3",
  "adecco-roleplay-v4",
  "adecco-roleplay-v5",
] as const;

export type AdeccoGrokVoiceDemoSlug =
  (typeof ADECCO_GROK_VOICE_DEMO_SLUGS)[number];

export type GrokVoiceRouterVariant =
  | "A_STRICT_FALLBACK_CONTROL"
  | "B_NARROW_FALLBACK_SEMANTIC"
  | "C_GUARDED_FLEXIBLE_GENERATION";

export const DEFAULT_ADECCO_GROK_VOICE_DEMO_SLUG: AdeccoGrokVoiceDemoSlug =
  "adecco-roleplay-v3";

export const ADECCO_GROK_VOICE_VARIANT_BY_SLUG: Record<
  AdeccoGrokVoiceDemoSlug,
  GrokVoiceRouterVariant
> = {
  "adecco-roleplay-v3": "A_STRICT_FALLBACK_CONTROL",
  "adecco-roleplay-v4": "B_NARROW_FALLBACK_SEMANTIC",
  "adecco-roleplay-v5": "C_GUARDED_FLEXIBLE_GENERATION",
};

const DEMO_SLUG_SET = new Set<string>(ADECCO_GROK_VOICE_DEMO_SLUGS);

export function isAdeccoGrokVoiceDemoSlug(
  value: unknown
): value is AdeccoGrokVoiceDemoSlug {
  return typeof value === "string" && DEMO_SLUG_SET.has(value);
}

export function getGrokVoiceRouterVariantForDemoSlug(
  slug: AdeccoGrokVoiceDemoSlug
): GrokVoiceRouterVariant {
  return ADECCO_GROK_VOICE_VARIANT_BY_SLUG[slug];
}

export function resolveGrokVoiceDemoSlug(
  value: unknown
): AdeccoGrokVoiceDemoSlug {
  return isAdeccoGrokVoiceDemoSlug(value)
    ? value
    : DEFAULT_ADECCO_GROK_VOICE_DEMO_SLUG;
}

export function resolveGrokVoiceDemoSlugFromPath(
  pathOrUrl: string | null | undefined
): AdeccoGrokVoiceDemoSlug {
  if (!pathOrUrl) return DEFAULT_ADECCO_GROK_VOICE_DEMO_SLUG;
  const path = parsePath(pathOrUrl);
  for (const slug of ADECCO_GROK_VOICE_DEMO_SLUGS) {
    if (path.includes(`/demo/${slug}`)) return slug;
  }
  return DEFAULT_ADECCO_GROK_VOICE_DEMO_SLUG;
}

export function isGrokVoiceDeterministicRegisteredSpeechVariant(
  variant: GrokVoiceRouterVariant
): boolean {
  return variant === "A_STRICT_FALLBACK_CONTROL" ||
    variant === "B_NARROW_FALLBACK_SEMANTIC";
}

export function isGrokVoiceNarrowFallbackVariant(
  variant: GrokVoiceRouterVariant
): boolean {
  return variant === "B_NARROW_FALLBACK_SEMANTIC" ||
    variant === "C_GUARDED_FLEXIBLE_GENERATION";
}

function parsePath(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl).pathname;
  } catch {
    return pathOrUrl;
  }
}
