import { transcriptDeltaSchema } from "@top-performer/domain";
import { z } from "zod";
import { HttpError, requestJson } from "./http";

const liveAvatarEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    code: z.number(),
    data: dataSchema,
    message: z.string().nullable().optional(),
  });

const sessionTokenResponseSchema = liveAvatarEnvelopeSchema(
  z.object({
    session_id: z.string().min(1),
    session_token: z.string().min(1),
  })
);

const sessionStartResponseSchema = liveAvatarEnvelopeSchema(
  z.object({
    session_id: z.string().min(1),
    livekit_url: z.string().min(1),
    livekit_client_token: z.string().min(1),
    livekit_agent_token: z.string().nullable().optional(),
    max_session_duration: z.number().optional(),
    ws_url: z.string().nullable().optional(),
  })
);

const transcriptResponseSchema = liveAvatarEnvelopeSchema(
  z.object({
    session_active: z.boolean(),
    transcript_data: z.array(
      z.object({
        role: z.enum(["user", "avatar"]),
        transcript: z.string(),
        absolute_timestamp: z.number().int().nonnegative(),
        relative_timestamp: z.number().int().nonnegative(),
      })
    ),
    next_timestamp: z.number().int().nonnegative(),
  })
);

const listPublicAvatarsResponseSchema = liveAvatarEnvelopeSchema(
  z.object({
    count: z.number().int().nonnegative(),
    next: z.string().nullable().optional(),
    previous: z.string().nullable().optional(),
    results: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        preview_url: z.string().optional(),
      })
    ),
  })
);

const createSecretResponseSchema = liveAvatarEnvelopeSchema(
  z.object({
    id: z.string().min(1).optional(),
    secret_id: z.string().min(1).optional(),
    secret_name: z.string().min(1).optional(),
  })
);

const stopSessionResponseSchema = liveAvatarEnvelopeSchema(z.object({}).passthrough());

export type LiveAvatarSessionTokenRequest = {
  avatarId: string;
  sandbox: boolean;
  elevenlabsAgentConfig?: {
    secretId: string;
    agentId: string;
  };
};

type ApiKeyProvider = string | (() => Promise<string>);

export class LiveAvatarClient {
  constructor(
    private readonly apiKey: ApiKeyProvider,
    private readonly baseUrl = "https://api.liveavatar.com"
  ) {}

  private async resolveApiKey() {
    return typeof this.apiKey === "function" ? this.apiKey() : this.apiKey;
  }

  async assertConnectivity() {
    return this.listPublicAvatars();
  }

  async listPublicAvatars() {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "liveavatar.listPublicAvatars",
      url: `${this.baseUrl}/v1/avatars/public`,
      headers: {
        "X-API-KEY": apiKey,
        accept: "application/json",
      },
      schema: listPublicAvatarsResponseSchema,
      timeoutMs: 20_000,
    });

    return response.data.results.map((avatar) => ({
      avatar_id: avatar.id,
      name: avatar.name,
      preview_image_url: avatar.preview_url,
    }));
  }

  async createSecret(secretName: string, secretValue: string) {
    const apiKey = await this.resolveApiKey();
    let response;
    try {
      response = await requestJson({
        scope: "liveavatar.createSecret",
        url: `${this.baseUrl}/v1/secrets`,
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          secret_type: "ELEVENLABS_API_KEY",
          secret_name: secretName,
          secret_value: secretValue,
        }),
        schema: createSecretResponseSchema,
        timeoutMs: 20_000,
      });
    } catch (error) {
      const vendorMessage =
        error instanceof HttpError &&
        typeof error.body === "object" &&
        error.body &&
        "message" in error.body &&
        typeof error.body.message === "string"
          ? error.body.message
          : "";

      if (
        error instanceof HttpError &&
        error.status === 400 &&
        vendorMessage.includes("third-party voice integration is only available to Elevenlabs' paid users")
      ) {
        throw new Error(
          "LiveAvatar で ElevenLabs secret を作成できません。接続中の ElevenLabs workspace が free tier のため、third-party voice integration が拒否されています。paid plan の ElevenLabs API key に切り替えて再実行してください。"
        );
      }

      throw error;
    }

    return {
      ...response.data,
      id: response.data.id ?? response.data.secret_id ?? "",
    };
  }

  async createSessionToken(input: LiveAvatarSessionTokenRequest) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "liveavatar.createSessionToken",
      url: `${this.baseUrl}/v1/sessions/token`,
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "LITE",
        avatar_id: input.avatarId,
        is_sandbox: input.sandbox,
        ...(input.elevenlabsAgentConfig
          ? {
              elevenlabs_agent_config: {
                secret_id: input.elevenlabsAgentConfig.secretId,
                agent_id: input.elevenlabsAgentConfig.agentId,
              },
            }
          : {}),
      }),
      schema: sessionTokenResponseSchema,
      timeoutMs: 30_000,
      retries: 2,
    });

    return response.data;
  }

  async startSession(sessionToken: string) {
    const response = await requestJson({
      scope: "liveavatar.startSession",
      url: `${this.baseUrl}/v1/sessions/start`,
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${sessionToken}`,
      },
      schema: sessionStartResponseSchema,
      timeoutMs: 45_000,
      retries: 2,
    });

    return response.data;
  }

  async stopSession(sessionId: string) {
    const apiKey = await this.resolveApiKey();
    await requestJson({
      scope: "liveavatar.stopSession",
      url: `${this.baseUrl}/v1/sessions/stop`,
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        reason: "USER_DISCONNECTED",
      }),
      schema: stopSessionResponseSchema,
      timeoutMs: 20_000,
      retries: 1,
    });
  }

  async getTranscript(sessionId: string, cursor = 0) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "liveavatar.getTranscript",
      url: `${this.baseUrl}/v1/sessions/${sessionId}/transcript?start_timestamp=${cursor}`,
      headers: {
        "X-API-KEY": apiKey,
        accept: "application/json",
      },
      schema: transcriptResponseSchema,
      timeoutMs: 20_000,
      retries: 1,
    });

    const delta = transcriptDeltaSchema.parse({
      sessionId,
      cursor: response.data.next_timestamp,
      sessionActive: response.data.session_active,
      turns: response.data.transcript_data.map((turn, index) => ({
        turnId: `${sessionId}_${turn.role}_${turn.relative_timestamp}_${index}`,
        role: turn.role,
        text: turn.transcript,
        relativeTimestamp: turn.relative_timestamp,
        absoluteTimestamp: turn.absolute_timestamp,
        dedupeKey: `${turn.role}:${turn.relative_timestamp}:${index}`,
        source: "transcript_api",
      })),
    });

    return delta;
  }
}
