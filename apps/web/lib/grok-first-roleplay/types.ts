import type {
  RoleplayMode,
  TranscriptMessage,
} from "@/lib/roleplay/conversation-types";

export const GROK_FIRST_V50_DEMO_SLUG = "adecco-roleplay-v50" as const;
export const GROK_FIRST_V50_1_DEMO_SLUG = "adecco-roleplay-v50-1" as const;
export const GROK_FIRST_V50_BACKEND = "grok-first-v50" as const;
export const GROK_FIRST_V50_1_BACKEND = "grok-first-v50-1" as const;
export const GROK_FIRST_V50_MODEL = "grok-voice-think-fast-1.0" as const;
export const GROK_FIRST_V50_VOICE_ID = "99c95cc8a177" as const;
export const GROK_FIRST_V50_SAMPLE_RATE = 24_000 as const;

export type GrokFirstDemoSlug =
  | typeof GROK_FIRST_V50_DEMO_SLUG
  | typeof GROK_FIRST_V50_1_DEMO_SLUG;
export type GrokFirstBackend =
  | typeof GROK_FIRST_V50_BACKEND
  | typeof GROK_FIRST_V50_1_BACKEND;

export type GrokFirstV50RealtimeAuth = {
  mode: "xai_ephemeral_subprotocol";
  token: string;
  expiresAt: string;
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
  };
  tools: [];
  instructions: string;
  firstMessage: string;
  registeredSpeechPayloadIncluded: false;
  lockedResponseAudioBundleIncluded: false;
  runtimeTtsEnabled: false;
  replacementTtsEnabled: false;
  fullTurnBufferEnabled: false;
  debugTranscriptPreviewEnabled: boolean;
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
  routePath: "grok_first_realtime" | "suppressed" | "noise_ignored";
  userTextLen: number;
  agentTextLen: number;
  firstAudioDeltaMs: number | null;
  firstAudibleAudioMs: number | null;
  doneMs: number | null;
  audioBytes: number;
  tailGuardHoldMs: number;
  tailAudioDroppedBytes: number;
  toolCallCount: 0;
  runtimeTtsCount: 0;
  fullTurnBufferCount: 0;
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
  promptHash: string;
  promptVersion: string;
  guardrailVersion: string;
  model: string;
  voiceId: string;
};

export type GuardAction =
  | "pass"
  | "strip_tail"
  | "drop_sentence"
  | "cancel"
  | "suppress"
  | "metric";

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
  | "customer_led_sales_flow";

export type NegativeGuardDecision = {
  action: GuardAction;
  reasons: NegativeGuardReason[];
  stripTail: boolean;
  dropSentencePatterns: RegExp[];
  hardStop: boolean;
};

export type GrokFirstV50Conversation = {
  mode: RoleplayMode;
  status: import("@/lib/roleplay/conversation-types").RoleplayStatus;
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
  sendTextMessage: (text: string, retryClientMessageId?: string) => Promise<void>;
  toggleMute: () => Promise<void>;
  setOutputVolume: (volume: number) => Promise<void>;
  changeInputDevice: (deviceId: string) => Promise<void>;
  getInputVolume: () => number;
  getOutputVolume: () => number;
};
