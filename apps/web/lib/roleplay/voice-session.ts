import { z } from "zod";
import { logStructured } from "@top-performer/vendors";
import { ADECCO_SCENARIO_ID } from "./scenario";
import type { VoiceServerEnv } from "./server-env";

export const SAFE_SESSION_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";
export const MIC_PERMISSION_ERROR =
  "マイクの使用が許可されていません。ブラウザのマイク設定を確認してから再試行してください。";

export const sessionTokenRequestSchema = z.object({
  scenarioId: z.literal(ADECCO_SCENARIO_ID),
  participantName: z.string().trim().min(1).max(80).optional(),
});

const tokenResponseSchema = z.object({
  token: z.string().min(1),
});

export async function issueConversationToken(input: {
  env: VoiceServerEnv;
  scenarioId: typeof ADECCO_SCENARIO_ID;
  participantName?: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const query = new URLSearchParams({
    agent_id: input.env.ELEVENLABS_AGENT_ID,
    branch_id: input.env.ELEVENLABS_BRANCH_ID,
    environment: input.env.ELEVENLABS_ENVIRONMENT,
  });
  if (input.participantName) {
    query.set("participant_name", input.participantName);
  }

  logStructured({
    level: "info",
    scope: "web.voice-session.issueConversationToken",
    message: "Issuing ElevenLabs conversation token",
    scenarioId: input.scenarioId,
    elevenAgentId: input.env.ELEVENLABS_AGENT_ID,
    details: {
      branchId: input.env.ELEVENLABS_BRANCH_ID,
      environment: input.env.ELEVENLABS_ENVIRONMENT,
      voiceProfileId: input.env.ELEVENLABS_VOICE_PROFILE_ID ?? "unknown",
    },
  });

  const url = `https://api.elevenlabs.io/v1/convai/conversation/token?${query.toString()}`;
  const attempts = 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "xi-api-key": input.env.ELEVENLABS_API_KEY,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (attempt + 1 < attempts) {
          continue;
        }
        throw new Error(`Voice token upstream status ${response.status}`);
      }

      const parsed = tokenResponseSchema.parse(await response.json());
      return parsed.token;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Voice token upstream failed.");
}

export function getSafeClientSessionError(error: unknown) {
  if (isMicrophonePermissionError(error)) {
    return MIC_PERMISSION_ERROR;
  }
  return SAFE_SESSION_ERROR;
}

function isMicrophonePermissionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { name?: unknown; message?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    message.toLowerCase().includes("permission denied")
  );
}
