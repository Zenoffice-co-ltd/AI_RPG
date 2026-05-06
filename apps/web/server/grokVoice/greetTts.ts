import {
  synthesizeGrokVoiceTts,
  GrokVoiceTtsError,
  type GrokVoiceTtsResult,
} from "./tts";

export type GrokVoiceGreetingTtsResult = GrokVoiceTtsResult;

export async function synthesizeGrokVoiceGreeting(input: {
  text: string;
}): Promise<GrokVoiceGreetingTtsResult> {
  return synthesizeGrokVoiceTts({ text: input.text, purpose: "greeting" });
}

export class GrokVoiceGreetingTtsError extends GrokVoiceTtsError {}
