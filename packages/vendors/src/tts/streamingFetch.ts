import { logStructured } from "../logging";
import { nowMs } from "./audio";

export type StreamingResult = {
  audio: Buffer;
  requestToFirstAudioMs: number | null;
  requestToLastAudioMs: number;
  vendorRequestId?: string;
  status: number;
  contentType: string;
};

/**
 * POSTs a request and reads the response as a streaming binary body, stamping
 * the elapsed time to the first non-empty chunk and the elapsed time to the
 * final chunk. Throws on non-2xx with parsed text body for caller diagnosis.
 */
export async function fetchStreamingAudio(args: {
  scope: string;
  url: string;
  init: RequestInit;
  timeoutMs?: number;
}): Promise<StreamingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 30_000);
  const startedAt = nowMs();

  try {
    const init: RequestInit = { ...args.init, signal: controller.signal };
    const response = await fetch(args.url, init);
    const vendorRequestId =
      response.headers.get("x-request-id") ??
      response.headers.get("openai-request-id") ??
      response.headers.get("request-id") ??
      undefined;
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      const text = await response.text();
      logStructured({
        scope: args.scope,
        level: "error",
        message: "Streaming TTS request failed",
        latencyMs: nowMs() - startedAt,
        ...(vendorRequestId ? { vendorRequestId } : {}),
        details: { status: response.status, body: text.slice(0, 500) },
      });
      const error = new Error(
        `HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`
      );
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }

    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const total = nowMs() - startedAt;
      return {
        audio: buffer,
        requestToFirstAudioMs: buffer.length > 0 ? total : null,
        requestToLastAudioMs: total,
        ...(vendorRequestId ? { vendorRequestId } : {}),
        status: response.status,
        contentType,
      };
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let firstAudioMs: number | null = null;
    let totalBytes = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        if (firstAudioMs === null) {
          firstAudioMs = nowMs() - startedAt;
        }
        const buf = Buffer.from(value);
        chunks.push(buf);
        totalBytes += buf.length;
      }
    }

    const audio = Buffer.concat(chunks, totalBytes);
    const lastAudioMs = nowMs() - startedAt;

    logStructured({
      scope: args.scope,
      message: "Streaming TTS request succeeded",
      latencyMs: lastAudioMs,
      ...(vendorRequestId ? { vendorRequestId } : {}),
      details: { bytes: audio.length, firstAudioMs },
    });

    return {
      audio,
      requestToFirstAudioMs: firstAudioMs,
      requestToLastAudioMs: lastAudioMs,
      ...(vendorRequestId ? { vendorRequestId } : {}),
      status: response.status,
      contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
}
