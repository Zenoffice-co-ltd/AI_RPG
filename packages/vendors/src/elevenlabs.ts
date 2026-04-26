import { z } from "zod";
import type {
  PronunciationDictionaryLocator,
  TextNormalisationType,
  VoiceSettings,
} from "@top-performer/domain";
import { HttpError, requestJson } from "./http";
import { logStructured } from "./logging";

const kbDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const createAgentResponseSchema = z.object({
  agent_id: z.string().min(1),
});

const agentResponseSchema = z.object({
  agent_id: z.string().min(1),
  name: z.string().min(1).optional(),
  version_id: z.string().nullable().optional(),
  branch_id: z.string().nullable().optional(),
  conversation_config: z.record(z.string(), z.unknown()).optional(),
});

const branchesResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      current_live_percentage: z.number().optional(),
      is_archived: z.boolean().optional(),
    })
  ),
  meta: z.object({
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
  }),
});

const createBranchResponseSchema = z.object({
  created_branch_id: z.string().min(1),
  created_version_id: z.string().min(1),
});

const testsListSchema = z.object({
  tests: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    })
  ),
  has_more: z.boolean(),
  next_cursor: z.string().nullable().optional(),
});

const createTestResponseSchema = z.object({
  id: z.string().min(1),
});

const runTestsResponseSchema = z.object({
  id: z.string().min(1),
  test_runs: z.array(
    z.object({
      test_run_id: z.string().min(1),
      test_id: z.string().min(1),
      status: z.string().min(1),
      test_name: z.string().min(1).optional(),
      condition_result: z
        .object({
          result: z.string().min(1),
        })
        .nullable()
        .optional(),
    })
  ),
  agent_id: z.string().nullable().optional(),
  branch_id: z.string().nullable().optional(),
});

const knowledgeBaseListSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    })
  ),
  has_more: z.boolean(),
  next_cursor: z.string().nullable().optional(),
});

const voiceSummarySchema = z.object({
  voice_id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  preview_url: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  created_at_unix: z.number().nullable().optional(),
  verified_languages: z
    .array(
      z.object({
        language: z.string().optional(),
        locale: z.string().nullable().optional(),
      })
    )
    .optional(),
});

const sharedVoiceSummarySchema = z.object({
  public_owner_id: z.string().min(1),
  voice_id: z.string().min(1),
  date_unix: z.number().nullable().optional(),
  name: z.string().min(1),
  accent: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  age: z.string().nullable().optional(),
  descriptive: z.string().nullable().optional(),
  use_case: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  preview_url: z.string().nullable().optional(),
  rate: z.number().nullable().optional(),
  fiat_rate: z.number().nullable().optional(),
  free_users_allowed: z.boolean().nullable().optional(),
  live_moderation_enabled: z.boolean().nullable().optional(),
  featured: z.boolean().nullable().optional(),
  notice_period: z.number().nullable().optional(),
  image_url: z.string().nullable().optional(),
  is_added_by_user: z.boolean().nullable().optional(),
  is_bookmarked: z.boolean().nullable().optional(),
  verified_languages: z
    .array(
      z.object({
        language: z.string().optional(),
        model_id: z.string().nullable().optional(),
        accent: z.string().nullable().optional(),
        locale: z.string().nullable().optional(),
        preview_url: z.string().nullable().optional(),
      })
    )
    .optional(),
});

const voicesListSchema = z.object({
  voices: z.array(voiceSummarySchema),
  has_more: z.boolean().optional(),
  next_page_token: z.string().nullable().optional(),
});

const sharedVoicesListSchema = z.object({
  voices: z.array(sharedVoiceSummarySchema),
  has_more: z.boolean().optional(),
  last_sort_id: z.string().nullable().optional(),
});

const addSharedVoiceResponseSchema = z.object({
  voice_id: z.string().min(1),
});

const voiceDetailSchema = z.object({
  voice_id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  preview_url: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).nullable().optional(),
  verified_languages: voiceSummarySchema.shape.verified_languages.nullable().optional(),
  sharing: z
    .object({
      public_owner_id: z.string().min(1).optional(),
      original_voice_id: z.string().min(1).optional(),
      category: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const designVoicePreviewSchema = z.object({
  audio_base_64: z.string().optional(),
  generated_voice_id: z.string().min(1),
  media_type: z.string().nullable().optional(),
  duration_secs: z.number().nullable().optional(),
  language: z.string().nullable().optional(),
});

const designVoiceResponseSchema = z.object({
  previews: z.array(designVoicePreviewSchema),
  text: z.string().optional(),
});

const createVoiceFromPreviewResponseSchema = z.object({
  voice_id: z.string().min(1),
  name: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  preview_url: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).nullable().optional(),
  verified_languages: voiceSummarySchema.shape.verified_languages.nullable().optional(),
});

const pronunciationDictionarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  latest_version_id: z.string().min(1).nullable().optional(),
  latest_version_rules_num: z.number().int().nonnegative().optional(),
  version_id: z.string().min(1).nullable().optional(),
  version_rules_num: z.number().int().nonnegative().optional(),
  permission_on_resource: z.string().nullable().optional(),
  created_by: z.string().min(1).optional(),
  creation_time_unix: z.number().nullable().optional(),
  archived_time_unix: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
});

const pronunciationDictionaryListSchema = z.object({
  pronunciation_dictionaries: z.array(pronunciationDictionarySchema),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
});

type AgentConfigPayload = {
  name: string;
  prompt: string;
  firstMessage: string;
  knowledgeBase: Array<{ id: string; name: string; type: "text" }>;
  llmModel: string;
  language: string;
  asr?: {
    keywords?: string[];
  };
  conversation?: {
    clientEvents?: string[];
    maxDurationSeconds?: number;
  };
  turn?: {
    turnTimeoutSeconds: number;
    initialWaitTimeSeconds?: number;
    silenceEndCallTimeoutSeconds?: number;
    softTimeout?: {
      timeoutSeconds: number;
      message: string;
    };
    turnEagerness?: "auto" | "low" | "normal" | "high" | "eager" | "patient";
    spellingPatience?: "auto" | "low" | "normal" | "high";
    speculativeTurn?: boolean;
    retranscribeOnTurnTimeout?: boolean;
    mode?: "turn" | "silence";
  };
  tts: {
    modelId: string;
    voiceId: string;
    languageCode?: string;
    textNormalisationType?: TextNormalisationType;
    voiceSettings?: VoiceSettings;
    pronunciationDictionaryLocators?: PronunciationDictionaryLocator[];
  };
};

export type ElevenLabsVoiceSummary = z.infer<typeof voiceSummarySchema>;
export type ElevenLabsSharedVoiceSummary = z.infer<
  typeof sharedVoiceSummarySchema
>;
export type ElevenLabsVoiceDetail = z.infer<typeof voiceDetailSchema>;
export type ElevenLabsDesignedVoicePreview = z.infer<
  typeof designVoicePreviewSchema
>;
export type ElevenLabsDesignVoiceResponse = z.infer<
  typeof designVoiceResponseSchema
>;
export type ElevenLabsPronunciationDictionary = z.infer<
  typeof pronunciationDictionarySchema
>;

export type RenderSpeechInput = {
  text: string;
  modelId: string;
  voiceId: string;
  languageCode?: string;
  outputFormat?: string;
  seed?: number;
  textNormalisationType?: TextNormalisationType;
  voiceSettings?: VoiceSettings;
  pronunciationDictionaryLocators?: PronunciationDictionaryLocator[];
};

export type ListSharedVoicesOptions = {
  pageSize?: number;
  page?: number;
  category?: "professional" | "famous" | "high_quality";
  gender?: string;
  age?: string;
  accent?: string;
  language?: string;
  locale?: string;
  search?: string;
  useCases?: string;
  descriptives?: string;
  featured?: boolean;
  minNoticePeriodDays?: number;
  includeCustomRates?: boolean;
  includeLiveModerated?: boolean;
  readerAppEnabled?: boolean;
  ownerId?: string;
  sort?: string;
  maxPages?: number;
};

export type DesignVoiceInput = {
  voiceDescription: string;
  modelId?: "eleven_multilingual_ttv_v2" | "eleven_ttv_v3";
  text?: string;
  autoGenerateText?: boolean;
  outputFormat?: string;
  loudness?: number;
  seed?: number;
  guidanceScale?: number;
  streamPreviews?: boolean;
  shouldEnhance?: boolean;
  referenceAudioBase64?: string;
  promptStrength?: number;
};

export type CreateVoiceFromPreviewInput = {
  voiceName: string;
  voiceDescription: string;
  generatedVoiceId: string;
  labels?: Record<string, string>;
  playedNotSelectedVoiceIds?: string[];
};

export type AddPronunciationDictionaryFromFileInput = {
  name: string;
  fileName: string;
  fileContents: Uint8Array;
  description?: string;
};

type ApiKeyProvider = string | (() => Promise<string>);

function mapVoiceSettingsToAgentTts(
  voiceSettings: VoiceSettings | undefined
) {
  if (!voiceSettings) {
    return {};
  }

  return {
    ...(voiceSettings.stability !== undefined
      ? { stability: voiceSettings.stability }
      : {}),
    ...(voiceSettings.similarityBoost !== undefined
      ? { similarity_boost: voiceSettings.similarityBoost }
      : {}),
    ...(voiceSettings.speed !== undefined ? { speed: voiceSettings.speed } : {}),
    ...(voiceSettings.style !== undefined ? { style: voiceSettings.style } : {}),
    ...(voiceSettings.useSpeakerBoost !== undefined
      ? { use_speaker_boost: voiceSettings.useSpeakerBoost }
      : {}),
  };
}

function mapVoiceSettingsToRenderPayload(
  voiceSettings: VoiceSettings | undefined
) {
  if (!voiceSettings) {
    return undefined;
  }

  return {
    ...(voiceSettings.stability !== undefined
      ? { stability: voiceSettings.stability }
      : {}),
    ...(voiceSettings.similarityBoost !== undefined
      ? { similarity_boost: voiceSettings.similarityBoost }
      : {}),
    ...(voiceSettings.speed !== undefined ? { speed: voiceSettings.speed } : {}),
    ...(voiceSettings.style !== undefined ? { style: voiceSettings.style } : {}),
    ...(voiceSettings.useSpeakerBoost !== undefined
      ? { use_speaker_boost: voiceSettings.useSpeakerBoost }
      : {}),
  };
}

function mapPronunciationDictionaryLocators(
  locators: PronunciationDictionaryLocator[] | undefined
) {
  return locators?.map((locator) => ({
    pronunciation_dictionary_id: locator.pronunciationDictionaryId,
    version_id: locator.versionId,
  }));
}

export function normalizeAgentTtsModelId(modelId: string) {
  if (modelId === "eleven_v3") {
    return "eleven_v3_conversational";
  }

  return modelId;
}

function buildRenderTextNormalisationPayload(
  modelId: string,
  textNormalisationType: TextNormalisationType | undefined
) {
  if (!textNormalisationType) {
    return {};
  }

  if (modelId === "eleven_v3") {
    return textNormalisationType === "elevenlabs"
      ? { apply_text_normalization: "auto" }
      : { apply_text_normalization: "off" };
  }

  return textNormalisationType === "elevenlabs"
    ? {
        apply_text_normalization: "on",
        apply_language_text_normalization: true,
      }
    : {
        apply_text_normalization: "off",
        apply_language_text_normalization: false,
      };
}

export function buildConversationConfig(payload: AgentConfigPayload) {
  return {
    agent: {
      first_message: payload.firstMessage,
      language: payload.language,
      prompt: {
        prompt: payload.prompt,
        knowledge_base: payload.knowledgeBase,
      },
    },
    conversation: {
      text_only: false,
      ...(payload.conversation?.clientEvents
        ? { client_events: payload.conversation.clientEvents }
        : {}),
      ...(payload.conversation?.maxDurationSeconds !== undefined
        ? { max_duration_seconds: payload.conversation.maxDurationSeconds }
        : {}),
    },
    ...(payload.asr?.keywords
      ? {
          asr: {
            keywords: payload.asr.keywords,
          },
        }
      : {}),
    ...(payload.turn
      ? {
          turn: {
            turn_timeout: payload.turn.turnTimeoutSeconds,
            ...(payload.turn.initialWaitTimeSeconds !== undefined
              ? { initial_wait_time: payload.turn.initialWaitTimeSeconds }
              : {}),
            ...(payload.turn.silenceEndCallTimeoutSeconds !== undefined
              ? {
                  silence_end_call_timeout:
                    payload.turn.silenceEndCallTimeoutSeconds,
                }
              : {}),
            ...(payload.turn.softTimeout
              ? {
                  soft_timeout_config: {
                    timeout_seconds: payload.turn.softTimeout.timeoutSeconds,
                    message: payload.turn.softTimeout.message,
                  },
                }
              : {}),
            ...(payload.turn.turnEagerness
              ? { turn_eagerness: payload.turn.turnEagerness }
              : {}),
            ...(payload.turn.spellingPatience
              ? { spelling_patience: payload.turn.spellingPatience }
              : {}),
            ...(payload.turn.speculativeTurn !== undefined
              ? { speculative_turn: payload.turn.speculativeTurn }
              : {}),
            ...(payload.turn.retranscribeOnTurnTimeout !== undefined
              ? {
                  retranscribe_on_turn_timeout:
                    payload.turn.retranscribeOnTurnTimeout,
                }
              : {}),
            ...(payload.turn.mode ? { mode: payload.turn.mode } : {}),
          },
        }
      : {}),
    llm: {
      model: payload.llmModel,
      temperature: 0,
      reasoning: {
        effort: "none",
      },
    },
    tts: {
      model_id: normalizeAgentTtsModelId(payload.tts.modelId),
      voice_id: payload.tts.voiceId,
      agent_output_audio_format: "pcm_24000",
      ...(payload.tts.languageCode
        ? { language_code: payload.tts.languageCode }
        : {}),
      ...(payload.tts.textNormalisationType
        ? { text_normalisation_type: payload.tts.textNormalisationType }
        : {}),
      ...(payload.tts.pronunciationDictionaryLocators
        ? {
            pronunciation_dictionary_locators: mapPronunciationDictionaryLocators(
              payload.tts.pronunciationDictionaryLocators
            ),
          }
        : {}),
      ...mapVoiceSettingsToAgentTts(payload.tts.voiceSettings),
    },
  };
}

export class ElevenLabsClient {
  constructor(
    private readonly apiKey: ApiKeyProvider,
    private readonly baseUrl = "https://api.elevenlabs.io"
  ) {}

  private async resolveApiKey() {
    return typeof this.apiKey === "function" ? this.apiKey() : this.apiKey;
  }

  async assertConnectivity() {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.listKnowledgeBase",
      url: `${this.baseUrl}/v1/convai/knowledge-base?page_size=1`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: knowledgeBaseListSchema,
      timeoutMs: 20_000,
    });

    return response.documents;
  }

  async listKnowledgeBaseDocuments(search?: string) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams({ page_size: "100" });
    if (search) {
      query.set("search", search);
    }

    const response = await requestJson({
      scope: "elevenlabs.listKnowledgeBaseDocuments",
      url: `${this.baseUrl}/v1/convai/knowledge-base?${query.toString()}`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: knowledgeBaseListSchema,
      timeoutMs: 20_000,
    });

    return response.documents;
  }

  async createKnowledgeBaseDocumentFromText(name: string, text: string) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.createKnowledgeBaseDocumentFromText",
      url: `${this.baseUrl}/v1/convai/knowledge-base/text`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        text,
      }),
      schema: kbDocumentSchema,
      timeoutMs: 30_000,
    });

    return response;
  }

  async listVoicesPage(options?: {
    nextPageToken?: string;
    query?: string;
    pageSize?: number;
  }) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams({
      page_size: String(options?.pageSize ?? 100),
    });
    if (options?.nextPageToken) {
      query.set("next_page_token", options.nextPageToken);
    }
    if (options?.query) {
      query.set("search", options.query);
    }

    const response = await requestJson({
      scope: "elevenlabs.listVoices",
      url: `${this.baseUrl}/v1/voices?${query.toString()}`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: voicesListSchema,
      timeoutMs: 20_000,
    });

    return response;
  }

  async listVoices(options?: { query?: string; pageSize?: number }) {
    let nextPageToken: string | undefined;
    const voices: ElevenLabsVoiceSummary[] = [];

    do {
      const response = await this.listVoicesPage({
        ...(nextPageToken ? { nextPageToken } : {}),
        ...(options?.query ? { query: options.query } : {}),
        ...(options?.pageSize !== undefined
          ? { pageSize: options.pageSize }
          : {}),
      });
      voices.push(...response.voices);
      nextPageToken = response.has_more
        ? (response.next_page_token ?? undefined)
        : undefined;
    } while (nextPageToken);

    return voices;
  }

  async listSharedVoicesPage(options?: ListSharedVoicesOptions) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams({
      page_size: String(options?.pageSize ?? 30),
      page: String(options?.page ?? 0),
    });
    if (options?.category) {
      query.set("category", options.category);
    }
    if (options?.gender) {
      query.set("gender", options.gender);
    }
    if (options?.age) {
      query.set("age", options.age);
    }
    if (options?.accent) {
      query.set("accent", options.accent);
    }
    if (options?.language) {
      query.set("language", options.language);
    }
    if (options?.locale) {
      query.set("locale", options.locale);
    }
    if (options?.search) {
      query.set("search", options.search);
    }
    if (options?.useCases) {
      query.set("use_cases", options.useCases);
    }
    if (options?.descriptives) {
      query.set("descriptives", options.descriptives);
    }
    if (options?.featured !== undefined) {
      query.set("featured", String(options.featured));
    }
    if (options?.minNoticePeriodDays !== undefined) {
      query.set("min_notice_period_days", String(options.minNoticePeriodDays));
    }
    if (options?.includeCustomRates !== undefined) {
      query.set("include_custom_rates", String(options.includeCustomRates));
    }
    if (options?.includeLiveModerated !== undefined) {
      query.set("include_live_moderated", String(options.includeLiveModerated));
    }
    if (options?.readerAppEnabled !== undefined) {
      query.set("reader_app_enabled", String(options.readerAppEnabled));
    }
    if (options?.ownerId) {
      query.set("owner_id", options.ownerId);
    }
    if (options?.sort) {
      query.set("sort", options.sort);
    }

    return requestJson({
      scope: "elevenlabs.listSharedVoices",
      url: `${this.baseUrl}/v1/shared-voices?${query.toString()}`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: sharedVoicesListSchema,
      timeoutMs: 20_000,
    });
  }

  async listSharedVoices(options?: ListSharedVoicesOptions) {
    const voices: ElevenLabsSharedVoiceSummary[] = [];
    const startPage = options?.page ?? 0;
    const maxPages = options?.maxPages ?? 10;

    for (let page = startPage; page < startPage + maxPages; page += 1) {
      const response = await this.listSharedVoicesPage({
        ...options,
        page,
      });
      voices.push(...response.voices);
      if (!response.has_more) {
        break;
      }
    }

    return voices;
  }

  async getVoice(voiceId: string) {
    const apiKey = await this.resolveApiKey();
    return requestJson({
      scope: "elevenlabs.getVoice",
      url: `${this.baseUrl}/v1/voices/${voiceId}`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: voiceDetailSchema,
      timeoutMs: 20_000,
    });
  }

  async renderSpeech(input: RenderSpeechInput) {
    const apiKey = await this.resolveApiKey();
    const startedAt = Date.now();
    const query = new URLSearchParams({
      output_format: input.outputFormat ?? "mp3_44100_128",
    });
    const response = await fetch(
      `${this.baseUrl}/v1/text-to-speech/${input.voiceId}?${query.toString()}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          accept: "audio/mpeg",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: input.text,
          model_id: input.modelId,
          ...(input.languageCode ? { language_code: input.languageCode } : {}),
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
          ...buildRenderTextNormalisationPayload(
            input.modelId,
            input.textNormalisationType
          ),
          ...(input.pronunciationDictionaryLocators
            ? {
                pronunciation_dictionary_locators: mapPronunciationDictionaryLocators(
                  input.pronunciationDictionaryLocators
                ),
              }
            : {}),
          ...(input.voiceSettings
            ? {
                voice_settings: mapVoiceSettingsToRenderPayload(
                  input.voiceSettings
                ),
              }
            : {}),
        }),
      }
    );

    const vendorRequestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      const errorText = await response.text();
      throw new HttpError(
        `HTTP ${response.status} for ${response.url}`,
        response.status,
        errorText,
        vendorRequestId
      );
    }

    const audio = Buffer.from(await response.arrayBuffer());
    logStructured({
      scope: "elevenlabs.renderSpeech",
      message: "Vendor request succeeded",
      latencyMs: Date.now() - startedAt,
      ...(vendorRequestId ? { vendorRequestId } : {}),
      details: {
        modelId: input.modelId,
        voiceId: input.voiceId,
      },
    });
    return {
      audio,
      latencyMs: Date.now() - startedAt,
      vendorRequestId,
    };
  }

  async listPronunciationDictionaries(pageSize = 100) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams({
      page_size: String(pageSize),
    });

    const response = await requestJson({
      scope: "elevenlabs.listPronunciationDictionaries",
      url: `${this.baseUrl}/v1/pronunciation-dictionaries?${query.toString()}`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: pronunciationDictionaryListSchema,
      timeoutMs: 20_000,
    });

    return response.pronunciation_dictionaries;
  }

  async addPronunciationDictionaryFromFile(
    input: AddPronunciationDictionaryFromFileInput
  ) {
    const apiKey = await this.resolveApiKey();
    const form = new FormData();
    const fileBuffer = input.fileContents;
    const fileArrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    ) as ArrayBuffer;
    form.set(
      "file",
      new File([fileArrayBuffer], input.fileName, {
        type: "application/octet-stream",
      })
    );
    form.set("name", input.name);
    if (input.description) {
      form.set("description", input.description);
    }

    const response = await fetch(
      `${this.baseUrl}/v1/pronunciation-dictionaries/add-from-file`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          accept: "application/json",
        },
        body: form,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      const vendorRequestId = response.headers.get("x-request-id") ?? undefined;
      throw new HttpError(
        `HTTP ${response.status} for ${response.url}`,
        response.status,
        errorText,
        vendorRequestId
      );
    }

    return pronunciationDictionarySchema.parse(await response.json());
  }

  async findSharedVoice(voiceId: string) {
    const response = await this.listSharedVoices({
      pageSize: 100,
      search: voiceId,
      maxPages: 2,
    });

    return response.find((voice) => voice.voice_id === voiceId);
  }

  async addSharedVoice(
    publicOwnerId: string,
    voiceId: string,
    newName: string
  ) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.addSharedVoice",
      url: `${this.baseUrl}/v1/voices/add/${publicOwnerId}/${voiceId}`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        new_name: newName,
        bookmarked: true,
      }),
      schema: addSharedVoiceResponseSchema,
      timeoutMs: 30_000,
    });

    return response;
  }

  async designVoicePreviews(input: DesignVoiceInput) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams();
    if (input.outputFormat) {
      query.set("output_format", input.outputFormat);
    }

    return requestJson({
      scope: "elevenlabs.designVoicePreviews",
      url: `${this.baseUrl}/v1/text-to-voice/design${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        voice_description: input.voiceDescription,
        ...(input.modelId ? { model_id: input.modelId } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.autoGenerateText !== undefined
          ? { auto_generate_text: input.autoGenerateText }
          : {}),
        ...(input.loudness !== undefined ? { loudness: input.loudness } : {}),
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
        ...(input.guidanceScale !== undefined
          ? { guidance_scale: input.guidanceScale }
          : {}),
        ...(input.streamPreviews !== undefined
          ? { stream_previews: input.streamPreviews }
          : {}),
        ...(input.shouldEnhance !== undefined
          ? { should_enhance: input.shouldEnhance }
          : {}),
        ...(input.referenceAudioBase64
          ? { reference_audio_base64: input.referenceAudioBase64 }
          : {}),
        ...(input.promptStrength !== undefined
          ? { prompt_strength: input.promptStrength }
          : {}),
      }),
      schema: designVoiceResponseSchema,
      timeoutMs: 45_000,
    });
  }

  async createVoiceFromPreview(input: CreateVoiceFromPreviewInput) {
    const apiKey = await this.resolveApiKey();
    return requestJson({
      scope: "elevenlabs.createVoiceFromPreview",
      url: `${this.baseUrl}/v1/text-to-voice`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        voice_name: input.voiceName,
        voice_description: input.voiceDescription,
        generated_voice_id: input.generatedVoiceId,
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.playedNotSelectedVoiceIds
          ? { played_not_selected_voice_ids: input.playedNotSelectedVoiceIds }
          : {}),
      }),
      schema: createVoiceFromPreviewResponseSchema,
      timeoutMs: 45_000,
    });
  }

  async resolveVoiceId(preferredVoiceId?: string, localePrefix = "ja") {
    const voices = await this.listVoices();
    const normalizedLocalePrefix = localePrefix.toLowerCase();
    const preferred = preferredVoiceId
      ? voices.find((voice) => voice.voice_id === preferredVoiceId)
      : undefined;

    if (preferred) {
      return {
        voiceId: preferred.voice_id,
        voiceName: preferred.name,
        resolution: "preferred",
      } as const;
    }

    if (preferredVoiceId) {
      const sharedVoice = await this.findSharedVoice(preferredVoiceId);
      if (sharedVoice) {
        const addedVoice = await this.addSharedVoice(
          sharedVoice.public_owner_id,
          sharedVoice.voice_id,
          sharedVoice.name
        );

        return {
          voiceId: addedVoice.voice_id,
          voiceName: sharedVoice.name,
          resolution: "preferred_added",
        } as const;
      }

      throw new Error(
        `Preferred ElevenLabs voice ${preferredVoiceId} is not available to this workspace and was not found in the shared voice library.`
      );
    }

    const localized =
      voices.find((voice) =>
        voice.verified_languages?.some((entry) => {
          const locale = entry.locale?.toLowerCase();
          const language = entry.language?.toLowerCase();
          return (
            locale?.startsWith(normalizedLocalePrefix) ||
            language === normalizedLocalePrefix
          );
        })
      ) ?? voices[0];

    if (!localized) {
      throw new Error("No ElevenLabs voices are available to this workspace.");
    }

    return {
      voiceId: localized.voice_id,
      voiceName: localized.name,
      resolution: preferredVoiceId ? "fallback" : "auto",
    } as const;
  }

  async createAgent(input: AgentConfigPayload) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.createAgent",
      url: `${this.baseUrl}/v1/convai/agents/create?enable_versioning=true`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        conversation_config: buildConversationConfig(input),
      }),
      schema: createAgentResponseSchema,
      timeoutMs: 30_000,
      retries: 1,
    });

    return response;
  }

  async getAgent(agentId: string, branchId?: string) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams();
    if (branchId) {
      query.set("branch_id", branchId);
    }

    const response = await requestJson({
      scope: "elevenlabs.getAgent",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: agentResponseSchema,
      timeoutMs: 20_000,
    });

    return response;
  }

  async updateAgent(
    agentId: string,
    input: AgentConfigPayload,
    options?: { branchId?: string }
  ) {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams({
      enable_versioning_if_not_enabled: "true",
    });
    if (options?.branchId) {
      query.set("branch_id", options.branchId);
    }

    return requestJson({
      scope: "elevenlabs.updateAgent",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}?${query.toString()}`,
      method: "PATCH",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        conversation_config: buildConversationConfig(input),
        version_description: "Published from Top Performer Roleplay MVP",
      }),
      schema: agentResponseSchema,
      timeoutMs: 30_000,
      retries: 1,
    });
  }

  async listBranches(agentId: string) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.listBranches",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}/branches?include_archived=false&limit=100`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: branchesResponseSchema,
      timeoutMs: 20_000,
    });

    return response.results;
  }

  async createBranch(
    agentId: string,
    parentVersionId: string,
    name: string,
    description: string
  ) {
    const apiKey = await this.resolveApiKey();
    return requestJson({
      scope: "elevenlabs.createBranch",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}/branches`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        parent_version_id: parentVersionId,
        name,
        description,
      }),
      schema: createBranchResponseSchema,
      timeoutMs: 20_000,
    });
  }

  async mergeBranch(agentId: string, sourceBranchId: string, targetBranchId: string) {
    const apiKey = await this.resolveApiKey();
    await requestJson({
      scope: "elevenlabs.mergeBranch",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}/branches/${sourceBranchId}/merge?target_branch_id=${targetBranchId}`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        archive_source_branch: false,
      }),
      schema: z.union([z.record(z.string(), z.unknown()), z.null()]),
      timeoutMs: 20_000,
    });
  }

  async listTests() {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.listTests",
      url: `${this.baseUrl}/v1/convai/agent-testing?page_size=100`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: testsListSchema,
      timeoutMs: 20_000,
    });

    return response.tests;
  }

  async createTest(body: Record<string, unknown>) {
    const apiKey = await this.resolveApiKey();
    const response = await requestJson({
      scope: "elevenlabs.createTest",
      url: `${this.baseUrl}/v1/convai/agent-testing/create`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      schema: createTestResponseSchema,
      timeoutMs: 20_000,
    });

    return response.id;
  }

  async updateTest(testId: string, body: Record<string, unknown>) {
    const apiKey = await this.resolveApiKey();
    await requestJson({
      scope: "elevenlabs.updateTest",
      url: `${this.baseUrl}/v1/convai/agent-testing/${testId}`,
      method: "PUT",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      schema: z.record(z.string(), z.unknown()),
      timeoutMs: 20_000,
    });
  }

  async runTests(agentId: string, testIds: string[], branchId?: string) {
    const apiKey = await this.resolveApiKey();
    return requestJson({
      scope: "elevenlabs.runTests",
      url: `${this.baseUrl}/v1/convai/agents/${agentId}/run-tests`,
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tests: testIds.map((testId) => ({ test_id: testId })),
        ...(branchId ? { branch_id: branchId } : {}),
      }),
      schema: runTestsResponseSchema,
      timeoutMs: 30_000,
      retries: 1,
    });
  }

  async getTestInvocation(invocationId: string) {
    const apiKey = await this.resolveApiKey();
    return requestJson({
      scope: "elevenlabs.getTestInvocation",
      url: `${this.baseUrl}/v1/convai/test-invocations/${invocationId}`,
      headers: {
        "xi-api-key": apiKey,
        accept: "application/json",
      },
      schema: runTestsResponseSchema,
      timeoutMs: 10_000,
      retries: 1,
    });
  }
}
