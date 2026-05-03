export type TtsProviderId =
  | "cartesia"
  | "inworld"
  | "fish"
  | "google_gemini"
  | "openai"
  | "elevenlabs_baseline";

export type TtsLanguage = "ja" | "ja-JP";

export type TtsOutputFormat = "pcm_s16le" | "wav" | "mp3" | "ogg_opus";

export type TtsSynthesisInput = {
  provider: TtsProviderId;
  model: string;
  voiceId?: string;
  text: string;
  language: TtsLanguage;
  outputFormat: TtsOutputFormat;
  sampleRateHz: number;
  stylePrompt?: string;
  timeoutMs?: number;
};

export type TtsSynthesisResult = {
  provider: TtsProviderId;
  model: string;
  voiceId?: string;
  success: boolean;
  audio?: Buffer;
  format: string;
  sampleRateHz: number;
  bytes: number;
  requestToFirstAudioMs: number | null;
  requestToLastAudioMs: number | null;
  audioDurationMs: number | null;
  rtf: number | null;
  vendorRequestId?: string;
  errorCode?: string;
  errorMessage?: string;
};

export interface TtsProvider {
  readonly id: TtsProviderId;
  readonly requiredEnv: readonly string[];
  synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult>;
}

export type EnvLookup = (key: string) => string | undefined;

export const defaultEnvLookup: EnvLookup = (key) => process.env[key];
