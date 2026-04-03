import {
  createTurnDedupeKey,
  type AvatarConversationProvider,
  type AvatarProviderStartInput,
  type AvatarProviderStartOutput,
  type StopSessionOutput,
  type TranscriptDelta,
} from "@top-performer/domain";
import type { LiveAvatarClient } from "@top-performer/vendors";

export class LiveAvatarElevenPluginProvider implements AvatarConversationProvider {
  constructor(private readonly client: LiveAvatarClient) {}

  async startSession(
    input: AvatarProviderStartInput
  ): Promise<AvatarProviderStartOutput> {
    const avatars = await this.client.listPublicAvatars();
    const token = await this.client.createSessionTokenWithFallback(
      {
        avatarId: input.avatarId,
        sandbox: input.sandbox,
        elevenlabsAgentConfig: {
          secretId: input.sessionNamespace ?? input.avatarId,
          agentId: input.elevenAgentId,
        },
      },
      avatars
        .map((avatar) => avatar.avatar_id)
        .filter((avatarId) => avatarId !== input.avatarId)
    );

    const started = await this.client.startSession(token.session_token);
    return {
      liveavatarSessionId: started.session_id,
      roomUrl: started.livekit_url,
      roomToken: started.livekit_client_token,
      avatarId: token.avatarId,
    };
  }

  async stopSession(sessionId: string): Promise<StopSessionOutput> {
    await this.client.stopSession(sessionId);
    return {
      stoppedAt: new Date().toISOString(),
    };
  }

  async getTranscript(sessionId: string, cursor = 0): Promise<TranscriptDelta> {
    const delta = await this.client.getTranscript(sessionId, cursor);
    return {
      ...delta,
      turns: delta.turns.map((turn) => {
        const dedupeKey = createTurnDedupeKey(turn);
        return {
          ...turn,
          dedupeKey,
          turnId: `turn_${dedupeKey.replaceAll(":", "_")}`,
        };
      }),
    };
  }
}

export class StaticPortraitProvider implements AvatarConversationProvider {
  startSession(): Promise<AvatarProviderStartOutput> {
    return Promise.resolve({
      liveavatarSessionId: "static_provider",
      roomUrl: "wss://static.invalid",
      roomToken: "static-token",
      avatarId: "static_provider",
    });
  }

  stopSession(): Promise<StopSessionOutput> {
    return Promise.resolve({
      stoppedAt: new Date().toISOString(),
    });
  }

  getTranscript(sessionId: string, cursor = 0): Promise<TranscriptDelta> {
    return Promise.resolve({
      sessionId,
      cursor,
      sessionActive: false,
      turns: [],
    });
  }
}
