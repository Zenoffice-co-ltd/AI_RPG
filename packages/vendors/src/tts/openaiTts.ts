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
 * OpenAI TTS — POST /v1/audio/speech with `response_format=pcm` returns
 * 24 kHz mono signed-16-bit little-endian PCM as a streaming binary body.
 * Reference docs must be re-confirmed before each release; see
 * docs/OPERATIONS.md for the dated check.
 */
export class OpenAiTtsProvider implements TtsProvider {
  readonly id: TtsProviderId = "openai";
  readonly requiredEnv = ["OPENAI_API_KEY"] as const;

  constructor(
    private readonly env: EnvLookup = defaultEnvLookup,
    private readonly baseUrl = "https://api.openai.com"
  ) {}

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const sampleRateHz = input.sampleRateHz || 24_000;
    const model = input.model;
    const voiceId =
      input.voiceId ?? this.env("OPENAI_TTS_VOICE") ?? "marin";
    const format = "wav"; // we wrap PCM into WAV for fair comparison

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

    const apiKey = this.env("OPENAI_API_KEY")!;

    try {
      const stream = await fetchStreamingAudio({
        scope: "tts.openai.synthesize",
        url: `${this.baseUrl}/v1/audio/speech`,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        init: {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            accept: "application/octet-stream",
          },
          body: JSON.stringify({
            model,
            input: input.text,
            voice: voiceId,
            response_format: "pcm",
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
