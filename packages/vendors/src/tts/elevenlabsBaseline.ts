import { ElevenLabsClient } from "../elevenlabs";
import {
  checkRequiredEnv,
  classifyError,
  defaultEnvLookup,
  envFailureResult,
  vendorFailureResult,
} from "./providerHelpers";
import type {
  EnvLookup,
  TtsProvider,
  TtsProviderId,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from "./types";

/**
 * Wraps the existing ElevenLabsClient.renderSpeech() so it can participate in
 * the cross-provider benchmark when --include-elevenlabs-baseline is set.
 * The non-streaming render returns latency only on completion, so
 * requestToFirstAudioMs is reported as null per plan.
 */
export class ElevenLabsBaselineTtsProvider implements TtsProvider {
  readonly id: TtsProviderId = "elevenlabs_baseline";
  readonly requiredEnv = ["ELEVENLABS_API_KEY"] as const;

  constructor(
    private readonly env: EnvLookup = defaultEnvLookup,
    private readonly clientFactory?: (apiKey: string) => ElevenLabsClient
  ) {}

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const sampleRateHz = input.sampleRateHz || 24_000;
    const model = input.model;
    const voiceId =
      input.voiceId ?? this.env("DEFAULT_ELEVEN_VOICE_ID") ?? "";
    const format = "mp3";

    const required: string[] = [...this.requiredEnv];
    if (!input.voiceId && !this.env("DEFAULT_ELEVEN_VOICE_ID")) {
      required.push("DEFAULT_ELEVEN_VOICE_ID");
    }

    const envCheck = checkRequiredEnv(required, this.env);
    if (!envCheck.ok) {
      return envFailureResult({
        provider: this.id,
        model,
        voiceId,
        format,
        sampleRateHz,
        missing: envCheck.missing,
      });
    }

    const apiKey = this.env("ELEVENLABS_API_KEY")!;
    const client = this.clientFactory
      ? this.clientFactory(apiKey)
      : new ElevenLabsClient(apiKey);

    try {
      const rendered = await client.renderSpeech({
        text: input.text,
        modelId: model,
        voiceId,
        languageCode: "ja",
      });

      return {
        provider: this.id,
        model,
        voiceId,
        success: true,
        audio: rendered.audio,
        format,
        sampleRateHz,
        bytes: rendered.audio.length,
        requestToFirstAudioMs: null,
        requestToLastAudioMs: rendered.latencyMs,
        audioDurationMs: null,
        rtf: null,
        ...(rendered.vendorRequestId
          ? { vendorRequestId: rendered.vendorRequestId }
          : {}),
      };
    } catch (error) {
      const cls = classifyError(error);
      return vendorFailureResult({
        provider: this.id,
        model,
        voiceId,
        format,
        sampleRateHz,
        errorCode: cls.code,
        errorMessage: cls.message,
      });
    }
  }
}
