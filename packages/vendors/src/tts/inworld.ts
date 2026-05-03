import { logStructured } from "../logging";
import { estimatePcmDurationMs, nowMs, wrapPcmS16LeAsWav } from "./audio";
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
 * Inworld — POST /tts/v1/voice. The non-stream variant returns a base64-encoded
 * WAV/MP3 in the JSON body; first-audio latency is therefore not measurable on
 * this transport (reported as null per plan). Streaming SSE deferred to a
 * follow-up task once the WS variant ships.
 *
 * Endpoint, model name and voice catalog must be re-confirmed before each
 * release; see docs/OPERATIONS.md for the dated check.
 */
export class InworldTtsProvider implements TtsProvider {
  readonly id: TtsProviderId = "inworld";
  readonly requiredEnv = ["INWORLD_API_KEY", "INWORLD_VOICE_ID"] as const;

  constructor(
    private readonly env: EnvLookup = defaultEnvLookup,
    private readonly baseUrl = "https://api.inworld.ai"
  ) {}

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const sampleRateHz = input.sampleRateHz || 24_000;
    const model = input.model;
    const voiceId = input.voiceId ?? this.env("INWORLD_VOICE_ID") ?? "";
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

    const apiKey = this.env("INWORLD_API_KEY")!;
    const startedAt = nowMs();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.timeoutMs ?? 30_000
    );

    try {
      const response = await fetch(`${this.baseUrl}/tts/v1/voice`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Basic ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          text: input.text,
          voiceId,
          modelId: model,
          audioConfig: {
            audioEncoding: "LINEAR16",
            sampleRateHertz: sampleRateHz,
          },
        }),
      });

      const vendorRequestId =
        response.headers.get("x-request-id") ??
        response.headers.get("request-id") ??
        undefined;

      if (!response.ok) {
        const text = await response.text();
        throw Object.assign(
          new Error(
            `HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`
          ),
          { status: response.status }
        );
      }

      const json = (await response.json()) as { audioContent?: string };
      const totalMs = nowMs() - startedAt;
      const base64 = json.audioContent ?? "";
      const pcm = Buffer.from(base64, "base64");
      const wav = wrapPcmS16LeAsWav({ pcm, sampleRateHz });
      const audioDurationMs = estimatePcmDurationMs({
        bytes: pcm.length,
        sampleRateHz,
      });
      const rtf = audioDurationMs > 0 ? totalMs / audioDurationMs : null;

      logStructured({
        scope: "tts.inworld.synthesize",
        message: "Vendor request succeeded",
        latencyMs: totalMs,
        ...(vendorRequestId ? { vendorRequestId } : {}),
        details: { bytes: wav.length },
      });

      return {
        provider: this.id,
        model,
        voiceId,
        success: true,
        audio: wav,
        format,
        sampleRateHz,
        bytes: wav.length,
        requestToFirstAudioMs: null,
        requestToLastAudioMs: totalMs,
        audioDurationMs,
        rtf,
        ...(vendorRequestId ? { vendorRequestId } : {}),
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
    } finally {
      clearTimeout(timeout);
    }
  }
}
