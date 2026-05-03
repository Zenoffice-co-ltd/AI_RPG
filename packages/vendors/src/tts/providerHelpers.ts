import type { EnvLookup, TtsProviderId, TtsSynthesisResult } from "./types";
import { defaultEnvLookup } from "./types";

export function checkRequiredEnv(
  required: readonly string[],
  env: EnvLookup
): { ok: true } | { ok: false; missing: string[] } {
  const missing = required.filter((key) => {
    const value = env(key);
    return value === undefined || value.trim().length === 0;
  });
  if (missing.length === 0) {
    return { ok: true };
  }
  return { ok: false, missing };
}

export function envFailureResult(args: {
  provider: TtsProviderId;
  model: string;
  voiceId?: string;
  format: string;
  sampleRateHz: number;
  missing: string[];
}): TtsSynthesisResult {
  return {
    provider: args.provider,
    model: args.model,
    ...(args.voiceId ? { voiceId: args.voiceId } : {}),
    success: false,
    format: args.format,
    sampleRateHz: args.sampleRateHz,
    bytes: 0,
    requestToFirstAudioMs: null,
    requestToLastAudioMs: null,
    audioDurationMs: null,
    rtf: null,
    errorCode: "ENV_MISSING",
    errorMessage: `Missing env: ${args.missing.join(", ")}`,
  };
}

export function vendorFailureResult(args: {
  provider: TtsProviderId;
  model: string;
  voiceId?: string;
  format: string;
  sampleRateHz: number;
  errorCode: string;
  errorMessage: string;
  vendorRequestId?: string;
}): TtsSynthesisResult {
  return {
    provider: args.provider,
    model: args.model,
    ...(args.voiceId ? { voiceId: args.voiceId } : {}),
    success: false,
    format: args.format,
    sampleRateHz: args.sampleRateHz,
    bytes: 0,
    requestToFirstAudioMs: null,
    requestToLastAudioMs: null,
    audioDurationMs: null,
    rtf: null,
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
    ...(args.vendorRequestId ? { vendorRequestId: args.vendorRequestId } : {}),
  };
}

export function classifyError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    if (error.name === "AbortError") return { code: "TIMEOUT", message: error.message };
    const status = (error as Error & { status?: number }).status;
    if (status) return { code: `HTTP_${status}`, message: error.message };
    return { code: "VENDOR_ERROR", message: error.message };
  }
  return { code: "VENDOR_ERROR", message: String(error) };
}

export { defaultEnvLookup };
