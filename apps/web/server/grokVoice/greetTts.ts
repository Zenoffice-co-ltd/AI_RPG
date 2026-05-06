import { getGrokVoiceServerEnv } from "@/lib/roleplay/server-env";

export type GrokVoiceGreetingTtsResult = {
  audio: Buffer;
  mimeType: "audio/pcm";
  sampleRateHz: number;
  textLen: number;
  voiceId: string;
  vendorMs: number;
};

export async function synthesizeGrokVoiceGreeting(input: {
  text: string;
}): Promise<GrokVoiceGreetingTtsResult> {
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
      language: "ja",
      output_format: {
        codec: "pcm",
        sample_rate: env.GROK_VOICE_SAMPLE_RATE,
      },
    }),
  });

  if (!response.ok) {
    throw new GrokVoiceGreetingTtsError(response.status);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new GrokVoiceGreetingTtsError(502);
  }

  return {
    audio,
    mimeType: "audio/pcm",
    sampleRateHz: env.GROK_VOICE_SAMPLE_RATE,
    textLen: input.text.length,
    voiceId: env.GROK_VOICE_VOICE_ID,
    vendorMs: Date.now() - startedAt,
  };
}

export class GrokVoiceGreetingTtsError extends Error {
  constructor(readonly status: number) {
    super(`xAI TTS failed with status ${status}`);
    this.name = "GrokVoiceGreetingTtsError";
  }
}
