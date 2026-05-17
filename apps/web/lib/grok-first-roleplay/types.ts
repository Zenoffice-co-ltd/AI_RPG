import type {
  RoleplayMode,
  RoleplayStatus,
  TranscriptMessage,
} from "@/lib/roleplay/conversation-types";

export const GROK_FIRST_V50_DEMO_SLUG = "adecco-roleplay-v50" as const;
export const GROK_FIRST_V50_1_DEMO_SLUG = "adecco-roleplay-v50-1" as const;
export const GROK_FIRST_V50_4_DEMO_SLUG = "adecco-roleplay-v50-4" as const;
export const GROK_FIRST_V50_5_DEMO_SLUG = "adecco-roleplay-v50-5" as const;
export const GROK_FIRST_V50_6_DEMO_SLUG = "adecco-roleplay-v50-6" as const;
export const GROK_FIRST_V50_7_DEMO_SLUG = "adecco-roleplay-v50-7" as const;
export const GROK_FIRST_V50_7_PROMPT_ONLY_DEMO_SLUG =
  "adecco-roleplay-v50-7-prompt-only" as const;
export const GROK_FIRST_V50_8_DEMO_SLUG = "adecco-roleplay-v50-8" as const;
export const GROK_FIRST_V51_DEMO_SLUG = "adecco-roleplay-v51" as const;
export const GROK_FIRST_VFINAL_DEMO_SLUG = "adecco-roleplay-vFinal" as const;
export const GROK_FIRST_V50_BACKEND = "grok-first-v50" as const;
export const GROK_FIRST_V50_1_BACKEND = "grok-first-v50-1" as const;
export const GROK_FIRST_V50_4_BACKEND = "grok-first-v50-4" as const;
export const GROK_FIRST_V50_5_BACKEND = "grok-first-v50-5" as const;
export const GROK_FIRST_V50_6_BACKEND = "grok-first-v50-6" as const;
export const GROK_FIRST_V50_7_BACKEND = "grok-first-v50-7" as const;
export const GROK_FIRST_V50_7_PROMPT_ONLY_BACKEND =
  "grok-first-v50-7-prompt-only" as const;
export const GROK_FIRST_V50_8_BACKEND = "grok-first-v50-8" as const;
export const GROK_FIRST_V51_BACKEND = "grok-first-v51" as const;
export const GROK_FIRST_VFINAL_BACKEND = "grok-first-vFinal" as const;
export const GROK_FIRST_V50_MODEL = "grok-voice-think-fast-1.0" as const;
export const GROK_FIRST_V50_VOICE_ID = "99c95cc8a177" as const;
export const GROK_FIRST_V50_SAMPLE_RATE = 24_000 as const;

export type GrokFirstDemoSlug =
  | typeof GROK_FIRST_V50_DEMO_SLUG
  | typeof GROK_FIRST_V50_1_DEMO_SLUG
  | typeof GROK_FIRST_V50_4_DEMO_SLUG
  | typeof GROK_FIRST_V50_5_DEMO_SLUG
  | typeof GROK_FIRST_V50_6_DEMO_SLUG
  | typeof GROK_FIRST_V50_7_DEMO_SLUG
  | typeof GROK_FIRST_V50_7_PROMPT_ONLY_DEMO_SLUG
  | typeof GROK_FIRST_V50_8_DEMO_SLUG
  | typeof GROK_FIRST_V51_DEMO_SLUG
  | typeof GROK_FIRST_VFINAL_DEMO_SLUG;
export type GrokFirstBackend =
  | typeof GROK_FIRST_V50_BACKEND
  | typeof GROK_FIRST_V50_1_BACKEND
  | typeof GROK_FIRST_V50_4_BACKEND
  | typeof GROK_FIRST_V50_5_BACKEND
  | typeof GROK_FIRST_V50_6_BACKEND
  | typeof GROK_FIRST_V50_7_BACKEND
  | typeof GROK_FIRST_V50_7_PROMPT_ONLY_BACKEND
  | typeof GROK_FIRST_V50_8_BACKEND
  | typeof GROK_FIRST_V51_BACKEND
  | typeof GROK_FIRST_VFINAL_BACKEND;

export type AdeccoBrowserEvaluationSource =
  | "grok_first_v50_7_browser"
  | "grok_first_v51_browser";

export type AdeccoBrowserEvaluationRuntimeVersion = "v50-7" | "v51";

export type GrokFirstBrowserEvaluationConfig = {
  enabled: boolean;
  startEndpoint: string;
  resultBasePath: string;
  source: AdeccoBrowserEvaluationSource;
  runtimeVersion: AdeccoBrowserEvaluationRuntimeVersion;
};

export type GrokFirstV50RealtimeTransport = "mendan_cloud_run_relay_wss";

export type GrokFirstV50RealtimeAuth =
  | {
      mode: "mendan_relay_subprotocol";
      protocol: "mendan-relay-v1";
      ticket: string;
      expiresAt: string;
    }
  | {
      mode: "xai_ephemeral_subprotocol";
      token: string;
      expiresAt: string;
    };

export type GrokFirstRuntimeControl = {
  mode: "default" | "prompt_only";
  runtimeGuardrailsEnabled: boolean;
  inputGuardEnabled: boolean;
  normalInputRouterEnabled: boolean;
  negativeGuardEnabled: boolean;
  tailGuardEnabled: boolean;
  fixedGuardAudioEnabled: boolean;
  boundedRewriteEnabled: boolean;
  noiseIgnoredEnabled: boolean;
};

export type GrokFirstV50Session = {
  sessionId: string;
  demoSlug: GrokFirstDemoSlug;
  backend: GrokFirstBackend;
  scenarioId: string;
  promptVersion: string;
  promptHash: string;
  guardrailVersion: string;
  model: typeof GROK_FIRST_V50_MODEL;
  voiceId: string;
  realtimeTransport: GrokFirstV50RealtimeTransport;
  wsUrl: string;
  realtimeAuth: GrokFirstV50RealtimeAuth;
  audio: {
    inputFormat: "audio/pcm";
    outputFormat: "audio/pcm";
    sampleRate: typeof GROK_FIRST_V50_SAMPLE_RATE;
  };
  turnDetection: {
    type: "server_vad";
    threshold: 0.65;
    silence_duration_ms: 650;
    prefix_padding_ms: 333;
    create_response?: false;
  };
  tools: [];
  instructions: string;
  firstMessage: string;
  registeredSpeechPayloadIncluded: false;
  lockedResponseAudioBundleIncluded: false;
  runtimeTtsEnabled: false;
  replacementTtsEnabled: false;
  fullTurnBufferEnabled: false;
  runtimeGuardrailsEnabled: boolean;
  inputGuardEnabled?: boolean | undefined;
  normalInputRouterEnabled?: boolean | undefined;
  negativeGuardEnabled?: boolean | undefined;
  tailGuardEnabled?: boolean | undefined;
  fixedGuardAudioEnabled?: boolean | undefined;
  boundedRewriteEnabled?: boolean | undefined;
  noiseIgnoredEnabled?: boolean | undefined;
  runtimeControl?: GrokFirstRuntimeControl | undefined;
  debugTranscriptPreviewEnabled: boolean;
  browserEvaluationEnabled?: boolean;
  browserEvaluation?: GrokFirstBrowserEvaluationConfig | undefined;
};

export type GrokFirstV50ServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  response?: { id?: string };
  item?: { id?: string };
  error?: { message?: string };
};

export type GrokFirstV50Metric = {
  sessionId: string;
  turnIndex: number;
  inputMode: "voice" | "text";
  routePath: "grok_first_realtime" | "suppressed" | "noise_ignored" | "fixed_guard";
  userTextLen: number;
  agentTextLen: number;
  firstAudioDeltaMs: number | null;
  firstAudibleAudioMs: number | null;
  doneMs: number | null;
  audioBytes: number;
  audioSource: "xai_realtime_stream" | "static_guard_pcm_base64";
  sttCompletedToGuardDetectedMs: number | null;
  guardDetectedToPlaybackStartedMs: number | null;
  fixedPlaybackDurationMs: number | null;
  fixedAudioBytes: number | null;
  tailGuardHoldMs: number;
  tailAudioDroppedBytes: number;
  toolCallCount: 0;
  runtimeTtsCount: 0;
  fullTurnBufferCount: number;
  regenerationRate: 0;
  businessRegisteredSpeechHitCount: 0;
  businessPr60LockHitCount: 0;
  fixedFallbackBusinessHitCount: 0;
  registeredSpeechPayloadIncluded: false;
  lockedResponseAudioBundleIncluded: false;
  websocketReconnectCount: number;
  vadPrematureCutoffSuspected: boolean;
  forbiddenSuffixDetected: boolean;
  audibleForbiddenSuffixCount: 0 | 1;
  closingQuestionLeakCount: 0 | 1;
  customerCoachUtteranceDetected: boolean;
  customerLedSalesFlowDetected: boolean;
  cultureFitPrematureRevealDetected: boolean;
  jobLevelPrematureRevealDetected: boolean;
  guardAction: GuardAction;
  guardReasons: string[];
  runtimeControlMode?: GrokFirstRuntimeControl["mode"] | undefined;
  runtimeGuardrailsEnabled?: boolean | undefined;
  inputGuardEnabled?: boolean | undefined;
  normalInputRouterEnabled?: boolean | undefined;
  negativeGuardEnabled?: boolean | undefined;
  tailGuardEnabled?: boolean | undefined;
  fixedGuardAudioEnabled?: boolean | undefined;
  boundedRewriteEnabled?: boolean | undefined;
  noiseIgnoredEnabled?: boolean | undefined;
  runtimeControl?: GrokFirstRuntimeControl | undefined;
  responseCreateCount?: number | undefined;
  responseCancelCount?: number | undefined;
  responseCancelReasons?: string[] | undefined;
  turnDetectionCreateResponse?: boolean | undefined;
  rawAssistantTranscript?: string | undefined;
  visibleAssistantTranscript?: string | undefined;
  audibleTranscript?: string | undefined;
  audibleTranscriptPreview?: string | undefined;
  promptHash: string;
  promptVersion: string;
  guardrailVersion: string;
  model: string;
  voiceId: string;
  error: string | null;
};

export type GuardAction =
  | "pass"
  | "strip_tail"
  | "drop_sentence"
  | "cancel"
  | "suppress"
  | "metric"
  | "fixed_exit"
  | "fixed_external"
  | "normal_realtime_rewrite";

export type NegativeGuardReason =
  | "forbidden_suffix"
  | "generic_closing_question"
  | "ai_self_reference"
  | "prompt_leak"
  | "evaluation_leak"
  | "numeric_contradiction"
  | "premature_sensitive_reveal"
  | "unnatural_ai_phrase"
  | "customer_coaching"
  | "customer_led_sales_flow"
  | "low_information_input_new_topic";

export type NegativeGuardDecision = {
  action: GuardAction;
  reasons: NegativeGuardReason[];
  stripTail: boolean;
  dropSentencePatterns: RegExp[];
  hardStop: boolean;
};

export type GrokFirstV50Conversation = {
  mode: RoleplayMode;
  status: RoleplayStatus;
  messages: TranscriptMessage[];
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  isAgentSpeaking: boolean;
  isAwaitingAgentResponse: boolean;
  errorMessage: string | null;
  limitWarning: boolean;
  selectedInput: string;
  setSelectedInput: (deviceId: string) => void;
  volume: number;
  metricsLog: GrokFirstV50Metric[];
  session: GrokFirstV50Session | null;
  startConversation: () => Promise<void>;
  endConversation: () => Promise<void>;
  startNewConversation: () => Promise<void>;
  sendTextMessage: (
    text: string,
    retryClientMessageId?: string,
  ) => Promise<void>;
  toggleMute: () => Promise<void>;
  setOutputVolume: (volume: number) => Promise<void>;
  changeInputDevice: (deviceId: string) => Promise<void>;
  getInputVolume: () => number;
  getOutputVolume: () => number;
};
