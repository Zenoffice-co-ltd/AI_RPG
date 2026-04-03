import type {
  AvatarProviderStartInput,
  AvatarProviderStartOutput,
  SessionTurn,
  StopSessionOutput,
  TranscriptDelta,
} from "./schemas";

export interface AvatarConversationProvider {
  startSession(input: AvatarProviderStartInput): Promise<AvatarProviderStartOutput>;
  stopSession(sessionId: string): Promise<StopSessionOutput>;
  getTranscript(sessionId: string, cursor?: number): Promise<TranscriptDelta>;
}

export function createTurnDedupeKey(turn: Pick<SessionTurn, "role" | "text" | "relativeTimestamp">) {
  const normalizedText = turn.text.trim().toLowerCase();
  const hashSeed = `${turn.role}:${turn.relativeTimestamp}:${normalizedText}`;
  let hash = 0;

  for (const char of hashSeed) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }

  return `${turn.role}:${turn.relativeTimestamp}:${Math.abs(hash)}`;
}
