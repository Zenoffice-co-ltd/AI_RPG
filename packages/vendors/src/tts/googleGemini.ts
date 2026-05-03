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
 * Google Gemini TTS (Vertex AI preview) — non-streaming generateContent with
 * audio modality. ADC is used by way of `gcloud auth print-access-token` resolved
 * at request time via a token-fetcher hook. The MVP does not stream, so
 * `requestToFirstAudioMs` is reported as null per plan.
 *
 * Endpoint, model name, voice catalog and authentication scope must be
 * re-confirmed before each release; see docs/OPERATIONS.md for the dated check.
 */
export type GoogleAccessTokenProvider = () => Promise<string>;

export class GoogleGeminiTtsProvider implements TtsProvider {
  readonly id: TtsProviderId = "google_gemini";
  readonly requiredEnv = ["GOOGLE_CLOUD_PROJECT", "GOOGLE_TTS_VOICE"] as const;

  constructor(
    private readonly env: EnvLookup = defaultEnvLookup,
    private readonly tokenProvider?: GoogleAccessTokenProvider
  ) {}

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const sampleRateHz = input.sampleRateHz || 24_000;
    const model = input.model;
    const voiceId = input.voiceId ?? this.env("GOOGLE_TTS_VOICE") ?? "";
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

    const project = this.env("GOOGLE_CLOUD_PROJECT")!;
    const location =
      this.env("GOOGLE_CLOUD_LOCATION") ?? this.env("GCLOUD_LOCATION") ?? "global";
    const startedAt = nowMs();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.timeoutMs ?? 30_000
    );

    try {
      const accessToken = await this.resolveAccessToken();
      const host =
        location === "global"
          ? "aiplatform.googleapis.com"
          : `${location}-aiplatform.googleapis.com`;
      const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: input.text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } },
            },
          },
        }),
      });

      const vendorRequestId =
        response.headers.get("x-request-id") ??
        response.headers.get("x-goog-request-id") ??
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

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { data?: string } }> };
        }>;
      };
      const totalMs = nowMs() - startedAt;
      const base64 =
        json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? "";
      const pcm = Buffer.from(base64, "base64");
      const wav = wrapPcmS16LeAsWav({ pcm, sampleRateHz });
      const audioDurationMs = estimatePcmDurationMs({
        bytes: pcm.length,
        sampleRateHz,
      });
      const rtf = audioDurationMs > 0 ? totalMs / audioDurationMs : null;

      logStructured({
        scope: "tts.google_gemini.synthesize",
        message: "Vendor request succeeded",
        latencyMs: totalMs,
        ...(vendorRequestId ? { vendorRequestId } : {}),
        details: { bytes: wav.length, location },
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

  private async resolveAccessToken(): Promise<string> {
    if (this.tokenProvider) {
      return this.tokenProvider();
    }
    const fromEnv = this.env("GOOGLE_ACCESS_TOKEN");
    if (fromEnv && fromEnv.trim().length > 0) {
      return fromEnv;
    }
    // Fall back to invoking gcloud at the OS level. The CLI runner injects a
    // tokenProvider when running outside a developer machine.
    const { spawn } = await import("node:child_process");
    return await new Promise<string>((resolvePromise, reject) => {
      const child = spawn("gcloud", ["auth", "print-access-token"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (code === 0) {
          resolvePromise(stdout.trim());
        } else {
          reject(
            new Error(
              `gcloud auth print-access-token exited with code ${code}: ${stderr.trim()}`
            )
          );
        }
      });
    });
  }
}
