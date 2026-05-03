import {
  checkRequiredEnv,
  classifyError,
  defaultEnvLookup,
  envFailureResult,
  vendorFailureResult,
} from "./providerHelpers";
import { fetchStreamingAudio } from "./streamingFetch";
import type {
  EnvLookup,
  TtsProvider,
  TtsProviderId,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from "./types";

/**
 * Fish Audio — POST /v1/tts streams audio (default container = WAV). The live
 * WebSocket variant is preferred for production but deferred for the MVP; the
 * adapter interface stays stable so it can be swapped without callers
 * changing.
 *
 * Endpoint, model name and reference handling must be re-confirmed before
 * each release; see docs/OPERATIONS.md for the dated check.
 */
export class FishTtsProvider implements TtsProvider {
  readonly id: TtsProviderId = "fish";
  readonly requiredEnv = ["FISH_API_KEY", "FISH_REFERENCE_ID"] as const;

  constructor(
    private readonly env: EnvLookup = defaultEnvLookup,
    private readonly baseUrl = "https://api.fish.audio"
  ) {}

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const sampleRateHz = input.sampleRateHz || 24_000;
    const model = input.model;
    const voiceId = input.voiceId ?? this.env("FISH_REFERENCE_ID") ?? "";
    const format = "wav";

    const envCheck = checkRequiredEnv(this.requiredEnv, this.env);
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

    const apiKey = this.env("FISH_API_KEY")!;

    try {
      const stream = await fetchStreamingAudio({
        scope: "tts.fish.synthesize",
        url: `${this.baseUrl}/v1/tts`,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        init: {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            model,
            "content-type": "application/json",
            accept: "audio/wav",
          },
          body: JSON.stringify({
            text: input.text,
            reference_id: voiceId,
            format: "wav",
            sample_rate: sampleRateHz,
            latency: "balanced",
          }),
        },
      });

      // Fish returns a complete WAV stream; no PCM-wrap needed but we still
      // estimate duration from the body length minus the 44-byte header.
      const audio = stream.audio;
      const dataBytes = Math.max(0, audio.length - 44);
      const audioDurationMs = dataBytes > 0
        ? Math.round((dataBytes / (sampleRateHz * 2)) * 1000)
        : null;
      const rtf =
        audioDurationMs !== null && audioDurationMs > 0
          ? stream.requestToLastAudioMs / audioDurationMs
          : null;

      return {
        provider: this.id,
        model,
        voiceId,
        success: true,
        audio,
        format,
        sampleRateHz,
        bytes: audio.length,
        requestToFirstAudioMs: stream.requestToFirstAudioMs,
        requestToLastAudioMs: stream.requestToLastAudioMs,
        audioDurationMs,
        rtf,
        ...(stream.vendorRequestId
          ? { vendorRequestId: stream.vendorRequestId }
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
