import { getGrokVoiceServerEnv } from "../../lib/roleplay/server-env";

export const GROK_VOICE_TTS_LANGUAGE = "ja";
export const GROK_VOICE_TTS_CODEC = "pcm";
export const GROK_VOICE_TTS_MIME_TYPE = "audio/pcm" as const;
export const GROK_VOICE_TTS_OPTIMIZE_STREAMING_LATENCY = 1;
export const GROK_VOICE_TTS_REQUEST_SHAPE_VERSION =
  "xai-tts-rest-v2026-05-06-pcm24k-optlat1";

export type GrokVoiceTtsPurpose =
  | "greeting"
  | "locked_response"
  // sanitized_response is unbounded-cardinality free-form Grok output that has
  // had stock suffixes stripped. It MUST NOT use the shared TTS cache —
  // see assertCacheableGrokVoiceTtsPurpose() in ttsCache.ts.
  | "sanitized_response";

export type GrokVoiceTtsResult = {
  audio: Buffer;
  mimeType: typeof GROK_VOICE_TTS_MIME_TYPE;
  sampleRateHz: number;
  textLen: number;
  voiceId: string;
  vendorMs: number;
  language: typeof GROK_VOICE_TTS_LANGUAGE;
  codec: typeof GROK_VOICE_TTS_CODEC;
  xaiTtsRequestShapeVersion: string;
};

export async function synthesizeGrokVoiceTts(input: {
  text: string;
  purpose: GrokVoiceTtsPurpose;
}): Promise<GrokVoiceTtsResult> {
  const env = getGrokVoiceServerEnv();
  const startedAt = Date.now();
  const response = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.XAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: input.text,
      voice_id: env.GROK_VOICE_VOICE_ID,
      language: GROK_VOICE_TTS_LANGUAGE,
      output_format: {
        codec: GROK_VOICE_TTS_CODEC,
        sample_rate: env.GROK_VOICE_SAMPLE_RATE,
      },
      optimize_streaming_latency: GROK_VOICE_TTS_OPTIMIZE_STREAMING_LATENCY,
    }),
  });

  if (!response.ok) {
    // Capture a short, redacted fragment of the xAI response body so the
    // failure is actionable in operator logs without leaking the request
    // payload. The xAI 400 path uniquely identifies an invalid key with
    // "Incorrect API key provided" — that signal was previously lost
    // because we only forwarded the status code.
    let bodyFragment = "";
    try {
      const raw = (await response.text()).trim();
      bodyFragment = redactXaiTtsBody(raw).slice(0, 240);
    } catch {
      // Ignore body read failures — status code alone is still useful.
    }
    throw new GrokVoiceTtsError(response.status, input.purpose, bodyFragment);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new GrokVoiceTtsError(502, input.purpose);
  }

  return {
    audio,
    mimeType: GROK_VOICE_TTS_MIME_TYPE,
    sampleRateHz: env.GROK_VOICE_SAMPLE_RATE,
    textLen: input.text.length,
    voiceId: env.GROK_VOICE_VOICE_ID,
    vendorMs: Date.now() - startedAt,
    language: GROK_VOICE_TTS_LANGUAGE,
    codec: GROK_VOICE_TTS_CODEC,
    xaiTtsRequestShapeVersion: GROK_VOICE_TTS_REQUEST_SHAPE_VERSION,
  };
}

export class GrokVoiceTtsError extends Error {
  readonly bodyFragment: string;
  constructor(
    readonly status: number,
    readonly purpose: GrokVoiceTtsPurpose,
    bodyFragment = ""
  ) {
    super(
      bodyFragment
        ? `xAI TTS failed for ${purpose} with status ${status}: ${bodyFragment}`
        : `xAI TTS failed for ${purpose} with status ${status}`
    );
    this.name = "GrokVoiceTtsError";
    this.bodyFragment = bodyFragment;
  }
}

// Redact substrings that look like Bearer tokens or "xai-..." key
// material out of xAI error bodies before logging. xAI's own 400
// messages include masked key fragments like "te***2e" — those are
// safe to log, so we leave them alone. We just block accidental
// substrings that would leak full credentials if xAI ever echoed the
// request back.
function redactXaiTtsBody(body: string): string {
  return body
    .replace(/Bearer [A-Za-z0-9_-]+/g, "Bearer <redacted>")
    .replace(/xai-[A-Za-z0-9_-]{16,}/g, "xai-<redacted>");
}
