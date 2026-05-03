import { estimatePcmDurationMs, wrapPcmS16LeAsWav } from "./audio";
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
 * Cartesia — POST /tts/bytes streams raw PCM. WebSocket transport (preferred
 * for production live use) intentionally deferred; the adapter interface stays
 * stable so it can be swapped without callers changing.
 *
 * The cartesia-version header date and endpoint must be re-confirmed before
 * each release; see docs/OPERATIONS.md for the dated check.
 */
export class CartesiaTtsProvider implements TtsProvider {
  readonly id: TtsProviderId = "cartesia";
  readonly requiredEnv = ["CARTESIA_API_KEY", "CARTESIA_VOICE_ID"] as const;

  constructor(
    private readonly env: EnvLookup = defaultEnvLookup,
    private readonly baseUrl = "https://api.cartesia.ai",
    private readonly cartesiaVersion = "2024-11-13"
  ) {}

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const sampleRateHz = input.sampleRateHz || 24_000;
    const model = input.model;
    const voiceId = input.voiceId ?? this.env("CARTESIA_VOICE_ID") ?? "";
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

    const apiKey = this.env("CARTESIA_API_KEY")!;

    try {
      const stream = await fetchStreamingAudio({
        scope: "tts.cartesia.synthesize",
        url: `${this.baseUrl}/tts/bytes`,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        init: {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "cartesia-version": this.cartesiaVersion,
            "content-type": "application/json",
            accept: "application/octet-stream",
          },
          body: JSON.stringify({
            model_id: model,
            transcript: input.text,
            voice: { mode: "id", id: voiceId },
            language: "ja",
            output_format: {
              container: "raw",
              encoding: "pcm_s16le",
              sample_rate: sampleRateHz,
            },
          }),
        },
      });

      const wav = wrapPcmS16LeAsWav({
        pcm: stream.audio,
        sampleRateHz,
      });
      const audioDurationMs = estimatePcmDurationMs({
        bytes: stream.audio.length,
        sampleRateHz,
      });
      const rtf =
        audioDurationMs > 0
          ? stream.requestToLastAudioMs / audioDurationMs
          : null;

      return {
        provider: this.id,
        model,
        voiceId,
        success: true,
        audio: wav,
        format,
        sampleRateHz,
        bytes: wav.length,
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
