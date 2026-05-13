export const ADECCO_GROK_VOICE_DEMO_SLUGS = [
  "adecco-roleplay-v3",
  "adecco-roleplay-v4",
  "adecco-roleplay-v5",
  "adecco-roleplay-v6",
  "adecco-roleplay-v7",
  "adecco-roleplay-v8",
  "adecco-roleplay-v9",
  "adecco-roleplay-v10",
  "adecco-roleplay-v11",
  "adecco-roleplay-v12",
  "adecco-roleplay-v13",
  "adecco-roleplay-v14",
  "adecco-roleplay-v15",
  "adecco-roleplay-v16",
  "adecco-roleplay-v17",
  "adecco-roleplay-v18",
  "adecco-roleplay-v19",
  "adecco-roleplay-v20",
  "adecco-roleplay-v21",
  "adecco-roleplay-v23",
  "adecco-roleplay-v24",
  "adecco-roleplay-v25",
] as const;

export type AdeccoGrokVoiceDemoSlug =
  (typeof ADECCO_GROK_VOICE_DEMO_SLUGS)[number];

export type GrokVoiceRouterVariant =
  | "A_STRICT_FALLBACK_CONTROL"
  | "B_NARROW_FALLBACK_SEMANTIC"
  | "C_GUARDED_FLEXIBLE_GENERATION"
  | "D_FIXED_SHALLOW_BUSINESS"
  | "E_GROK_NATURAL_SHALLOW_GOVERNED"
  | "F_GROK_NATURAL_SHORT_GOVERNED"
  | "G_HYBRID_FAST_GOVERNED"
  | "H_V3_STYLE_FAST_REGISTERED_GUARDED"
  | "I_V10_RECRUIT_UNKNOWN_GROK_GUARDED"
  | "J_V10_PR92_UNKNOWN_FALLBACK"
  | "K_V12_RECRUIT_UNKNOWN_GROK_GUARDED"
  | "L_V13_MANUFACTURER_EXPERIENCE_FAST_GUARDED"
  | "M_V10_HARUTO_FAST_META_UNKNOWN_ONLY"
  | "N_V14_FAST_MATCHER_TEXT_GUARDED"
  | "O_V14_RECRUIT_UNKNOWN_ALL_GROK_GUARDED"
  | "P_V17_UNKNOWN_GROK_UNGUARDED"
  | "Q_V17_META_SAFETY_ONLY_FIXED_FALLBACK"
  | "R_V18_LEGACY_HARUTO_23_BASE"
  | "S_V20_LEGACY_HARUTO_SHORT_STREAMING_RUNTIME"
  | "T_V21_ACK_STREAM_COMPACT_PROMPT"
  | "U_V23_SERVER_RELAYED_WSS";

export type GrokVoiceRealtimeTransport =
  | "xai_direct_wss"
  | "mendan_cloud_run_relay_wss";

export const DEFAULT_ADECCO_GROK_VOICE_DEMO_SLUG: AdeccoGrokVoiceDemoSlug =
  "adecco-roleplay-v3";

export const ADECCO_GROK_VOICE_VARIANT_BY_SLUG: Record<
  AdeccoGrokVoiceDemoSlug,
  GrokVoiceRouterVariant
> = {
  "adecco-roleplay-v3": "A_STRICT_FALLBACK_CONTROL",
  "adecco-roleplay-v4": "B_NARROW_FALLBACK_SEMANTIC",
  "adecco-roleplay-v5": "C_GUARDED_FLEXIBLE_GENERATION",
  "adecco-roleplay-v6": "D_FIXED_SHALLOW_BUSINESS",
  "adecco-roleplay-v7": "E_GROK_NATURAL_SHALLOW_GOVERNED",
  "adecco-roleplay-v8": "F_GROK_NATURAL_SHORT_GOVERNED",
  "adecco-roleplay-v9": "G_HYBRID_FAST_GOVERNED",
  "adecco-roleplay-v10": "H_V3_STYLE_FAST_REGISTERED_GUARDED",
  "adecco-roleplay-v11": "I_V10_RECRUIT_UNKNOWN_GROK_GUARDED",
  "adecco-roleplay-v12": "J_V10_PR92_UNKNOWN_FALLBACK",
  "adecco-roleplay-v13": "K_V12_RECRUIT_UNKNOWN_GROK_GUARDED",
  "adecco-roleplay-v14": "L_V13_MANUFACTURER_EXPERIENCE_FAST_GUARDED",
  "adecco-roleplay-v15": "M_V10_HARUTO_FAST_META_UNKNOWN_ONLY",
  "adecco-roleplay-v16": "N_V14_FAST_MATCHER_TEXT_GUARDED",
  "adecco-roleplay-v17": "O_V14_RECRUIT_UNKNOWN_ALL_GROK_GUARDED",
  "adecco-roleplay-v18": "P_V17_UNKNOWN_GROK_UNGUARDED",
  "adecco-roleplay-v19": "Q_V17_META_SAFETY_ONLY_FIXED_FALLBACK",
  "adecco-roleplay-v20": "R_V18_LEGACY_HARUTO_23_BASE",
  "adecco-roleplay-v21": "S_V20_LEGACY_HARUTO_SHORT_STREAMING_RUNTIME",
  "adecco-roleplay-v23": "T_V21_ACK_STREAM_COMPACT_PROMPT",
  "adecco-roleplay-v24": "U_V23_SERVER_RELAYED_WSS",
  "adecco-roleplay-v25": "B_NARROW_FALLBACK_SEMANTIC",
};

export const ADECCO_GROK_VOICE_TRANSPORT_BY_SLUG: Record<
  AdeccoGrokVoiceDemoSlug,
  GrokVoiceRealtimeTransport
> = {
  "adecco-roleplay-v3": "xai_direct_wss",
  "adecco-roleplay-v4": "xai_direct_wss",
  "adecco-roleplay-v5": "xai_direct_wss",
  "adecco-roleplay-v6": "xai_direct_wss",
  "adecco-roleplay-v7": "xai_direct_wss",
  "adecco-roleplay-v8": "xai_direct_wss",
  "adecco-roleplay-v9": "xai_direct_wss",
  "adecco-roleplay-v10": "xai_direct_wss",
  "adecco-roleplay-v11": "xai_direct_wss",
  "adecco-roleplay-v12": "xai_direct_wss",
  "adecco-roleplay-v13": "xai_direct_wss",
  "adecco-roleplay-v14": "xai_direct_wss",
  "adecco-roleplay-v15": "xai_direct_wss",
  "adecco-roleplay-v16": "xai_direct_wss",
  "adecco-roleplay-v17": "xai_direct_wss",
  "adecco-roleplay-v18": "xai_direct_wss",
  "adecco-roleplay-v19": "xai_direct_wss",
  "adecco-roleplay-v20": "xai_direct_wss",
  "adecco-roleplay-v21": "xai_direct_wss",
  "adecco-roleplay-v23": "xai_direct_wss",
  "adecco-roleplay-v24": "xai_direct_wss",
  "adecco-roleplay-v25": "mendan_cloud_run_relay_wss",
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

export function getGrokVoiceRealtimeTransportForDemoSlug(
  slug: AdeccoGrokVoiceDemoSlug
): GrokVoiceRealtimeTransport {
  return ADECCO_GROK_VOICE_TRANSPORT_BY_SLUG[slug];
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
    variant === "B_NARROW_FALLBACK_SEMANTIC" ||
    variant === "D_FIXED_SHALLOW_BUSINESS" ||
    variant === "H_V3_STYLE_FAST_REGISTERED_GUARDED" ||
    variant === "J_V10_PR92_UNKNOWN_FALLBACK" ||
    variant === "M_V10_HARUTO_FAST_META_UNKNOWN_ONLY";
}

export function isGrokVoiceNarrowFallbackVariant(
  variant: GrokVoiceRouterVariant
): boolean {
  return variant === "B_NARROW_FALLBACK_SEMANTIC" ||
    variant === "C_GUARDED_FLEXIBLE_GENERATION" ||
    variant === "D_FIXED_SHALLOW_BUSINESS" ||
    isGrokVoiceNaturalGovernedVariant(variant) ||
    variant === "H_V3_STYLE_FAST_REGISTERED_GUARDED" ||
    variant === "J_V10_PR92_UNKNOWN_FALLBACK" ||
    variant === "M_V10_HARUTO_FAST_META_UNKNOWN_ONLY";
}

export function isGrokVoiceNaturalGovernedVariant(
  variant: GrokVoiceRouterVariant | undefined
): boolean {
  return (
    variant === "E_GROK_NATURAL_SHALLOW_GOVERNED" ||
    variant === "F_GROK_NATURAL_SHORT_GOVERNED" ||
    variant === "G_HYBRID_FAST_GOVERNED" ||
    variant === "I_V10_RECRUIT_UNKNOWN_GROK_GUARDED" ||
    variant === "K_V12_RECRUIT_UNKNOWN_GROK_GUARDED" ||
    variant === "L_V13_MANUFACTURER_EXPERIENCE_FAST_GUARDED" ||
    variant === "N_V14_FAST_MATCHER_TEXT_GUARDED" ||
    variant === "O_V14_RECRUIT_UNKNOWN_ALL_GROK_GUARDED" ||
    variant === "P_V17_UNKNOWN_GROK_UNGUARDED" ||
    variant === "Q_V17_META_SAFETY_ONLY_FIXED_FALLBACK" ||
    variant === "R_V18_LEGACY_HARUTO_23_BASE" ||
    variant === "S_V20_LEGACY_HARUTO_SHORT_STREAMING_RUNTIME" ||
    variant === "T_V21_ACK_STREAM_COMPACT_PROMPT" ||
    variant === "U_V23_SERVER_RELAYED_WSS"
  );
}

export function isGrokVoiceShortGovernedVariant(
  variant: GrokVoiceRouterVariant | undefined
): boolean {
  return (
    variant === "F_GROK_NATURAL_SHORT_GOVERNED" ||
    variant === "G_HYBRID_FAST_GOVERNED" ||
    variant === "I_V10_RECRUIT_UNKNOWN_GROK_GUARDED" ||
    variant === "K_V12_RECRUIT_UNKNOWN_GROK_GUARDED" ||
    variant === "L_V13_MANUFACTURER_EXPERIENCE_FAST_GUARDED" ||
    variant === "N_V14_FAST_MATCHER_TEXT_GUARDED" ||
    variant === "O_V14_RECRUIT_UNKNOWN_ALL_GROK_GUARDED" ||
    variant === "P_V17_UNKNOWN_GROK_UNGUARDED" ||
    variant === "Q_V17_META_SAFETY_ONLY_FIXED_FALLBACK" ||
    variant === "R_V18_LEGACY_HARUTO_23_BASE" ||
    variant === "S_V20_LEGACY_HARUTO_SHORT_STREAMING_RUNTIME" ||
    variant === "T_V21_ACK_STREAM_COMPACT_PROMPT" ||
    variant === "U_V23_SERVER_RELAYED_WSS"
  );
}

function parsePath(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl).pathname;
  } catch {
    return pathOrUrl;
  }
}
