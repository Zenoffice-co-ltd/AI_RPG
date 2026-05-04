// Lane B: microphone -> GCP Speech-to-Text v2 -> Claude (handled by /respond) -> Fish.
// This module owns only the STT step. The browser captures audio via MediaRecorder
// (WebM Opus by default), POSTs the bytes to /api/haiku-fish/transcribe, and the
// route handler pipes them through here.

export const HAIKU_FISH_MIC_DISABLED_PAYLOAD = {
  error: "mic_input_disabled",
  message:
    "音声入力は現在無効化されています。テキスト入力でテストしてください。",
} as const;

export type HaikuFishSttInput = {
  audioBase64: string;
  /** Optional content hint for STT auto-decoding. Currently unused (auto_decoding_config). */
  audioMimeType?: string;
  languageCode?: string;
  model?: string;
};

export type HaikuFishSttResult = {
  text: string;
  confidence: number | null;
  vendorRequestMs: number;
};

export type HaikuFishSttDeps = {
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string>;
  projectId?: string;
  location?: string;
};

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

let cachedToken: { token: string; expiresAt: number } | null = null;

// Cloud Run injects an OAuth-capable SA token via the metadata server. Outside
// GCP (local dev) this fetch fails fast — mic input is production-only for v1.
async function defaultGetAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const response = await fetch(METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!response.ok) {
    throw new Error(`Metadata token fetch failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof data.access_token !== "string") {
    throw new Error("Metadata token response missing access_token.");
  }
  const ttlSec = typeof data.expires_in === "number" ? data.expires_in : 300;
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, ttlSec - 30) * 1000,
  };
  return data.access_token;
}

export function clearHaikuFishSttTokenCache() {
  cachedToken = null;
}

export async function transcribeHaikuFishAudio(
  input: HaikuFishSttInput,
  deps: HaikuFishSttDeps = {}
): Promise<HaikuFishSttResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const projectId = deps.projectId ?? process.env["GOOGLE_CLOUD_PROJECT"];
  const location = deps.location ?? process.env["GOOGLE_CLOUD_LOCATION"] ?? "global";
  const languageCode =
    input.languageCode ?? process.env["GOOGLE_STT_LANGUAGE"] ?? "ja-JP";
  const model = input.model ?? process.env["GOOGLE_STT_MODEL"] ?? "latest_short";

  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT not configured for STT.");
  }
  const token = await (deps.getAccessToken ?? defaultGetAccessToken)();

  const url =
    location === "global"
      ? `https://speech.googleapis.com/v2/projects/${projectId}/locations/global/recognizers/_:recognize`
      : `https://${location}-speech.googleapis.com/v2/projects/${projectId}/locations/${location}/recognizers/_:recognize`;

  const startedAt = Date.now();
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      config: {
        auto_decoding_config: {},
        model,
        language_codes: [languageCode],
      },
      content: input.audioBase64,
    }),
  });
  const vendorRequestMs = Date.now() - startedAt;

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GCP STT request failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      alternatives?: Array<{ transcript?: string; confidence?: number }>;
    }>;
  };

  let text = "";
  let confidence: number | null = null;
  if (Array.isArray(data.results)) {
    for (const result of data.results) {
      const top = result.alternatives?.[0];
      if (top?.transcript) {
        text += top.transcript;
        if (typeof top.confidence === "number") {
          confidence =
            confidence === null ? top.confidence : Math.min(confidence, top.confidence);
        }
      }
    }
  }

  return {
    text: text.trim(),
    confidence,
    vendorRequestMs,
  };
}
