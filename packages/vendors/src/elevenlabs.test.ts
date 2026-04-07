import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConversationConfig, ElevenLabsClient } from "./elevenlabs";
import { requestJson } from "./http";

vi.mock("./http", () => ({
  requestJson: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly body: unknown,
      readonly vendorRequestId?: string
    ) {
      super(message);
    }
  },
}));

describe("ElevenLabsClient.resolveVoiceId", () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockReset();
    vi.restoreAllMocks();
  });

  it("returns the exact preferred voice when the workspace lists it", async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({
      voices: [
        {
          voice_id: "g6xIsTj2HwM6VR4iXFCw",
          name: "Requested Voice",
          verified_languages: [{ language: "ja", locale: "ja-JP" }],
        },
      ],
      has_more: false,
      next_page_token: null,
    });

    const client = new ElevenLabsClient("test-key");
    await expect(client.resolveVoiceId("g6xIsTj2HwM6VR4iXFCw", "ja")).resolves.toEqual(
      {
        voiceId: "g6xIsTj2HwM6VR4iXFCw",
        voiceName: "Requested Voice",
        resolution: "preferred",
      }
    );
  });

  it("returns the exact preferred voice even when it is not listed", async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce({
        voices: [
          {
            voice_id: "JBFqnCBsd6RMkjVDRZzb",
            name: "George - Warm, Captivating Storyteller",
            verified_languages: [{ language: "en", locale: "en-US" }],
          },
        ],
        has_more: false,
        next_page_token: null,
      })
      .mockResolvedValueOnce({
        voices: [
          {
            voice_id: "g6xIsTj2HwM6VR4iXFCw",
            public_owner_id: "owner_123",
            name: "Requested Voice",
            language: "en",
          },
        ],
      })
      .mockResolvedValueOnce({
        voice_id: "g6xIsTj2HwM6VR4iXFCw",
      });

    const client = new ElevenLabsClient("test-key");
    await expect(client.resolveVoiceId("g6xIsTj2HwM6VR4iXFCw", "ja")).resolves.toEqual(
      {
        voiceId: "g6xIsTj2HwM6VR4iXFCw",
        voiceName: "Requested Voice",
        resolution: "preferred_added",
      }
    );
  });

  it("fails closed when the preferred voice cannot be found anywhere", async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce({
        voices: [],
        has_more: false,
        next_page_token: null,
      })
      .mockResolvedValueOnce({
        voices: [],
      });

    const client = new ElevenLabsClient("test-key");
    await expect(client.resolveVoiceId("missing_voice", "ja")).rejects.toThrow(
      "Preferred ElevenLabs voice missing_voice is not available to this workspace and was not found in the shared voice library."
    );
  });

  it("paginates the voice inventory", async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce({
        voices: [
          {
            voice_id: "voice_1",
            name: "Voice 1",
          },
        ],
        has_more: true,
        next_page_token: "next_token",
      })
      .mockResolvedValueOnce({
        voices: [
          {
            voice_id: "voice_2",
            name: "Voice 2",
          },
        ],
        has_more: false,
        next_page_token: null,
      });

    const client = new ElevenLabsClient("test-key");
    const voices = await client.listVoices();

    expect(voices.map((voice) => voice.voice_id)).toEqual(["voice_1", "voice_2"]);
  });

  it("lists shared voices with query filters and pagination", async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce({
        voices: [
          {
            public_owner_id: "owner_1",
            voice_id: "shared_1",
            name: "Shared Voice 1",
            gender: "female",
          },
        ],
        has_more: true,
        last_sort_id: "sort_1",
      })
      .mockResolvedValueOnce({
        voices: [
          {
            public_owner_id: "owner_2",
            voice_id: "shared_2",
            name: "Shared Voice 2",
            gender: "female",
          },
        ],
        has_more: false,
        last_sort_id: null,
      });

    const client = new ElevenLabsClient("test-key");
    const voices = await client.listSharedVoices({
      pageSize: 100,
      category: "professional",
      gender: "female",
      language: "ja",
      locale: "ja-JP",
      descriptives: "calm,neutral",
      maxPages: 3,
    });

    expect(voices.map((voice) => voice.voice_id)).toEqual(["shared_1", "shared_2"]);
    expect(vi.mocked(requestJson).mock.calls[0]?.[0].url).toContain(
      "category=professional"
    );
    expect(vi.mocked(requestJson).mock.calls[0]?.[0].url).toContain(
      "descriptives=calm%2Cneutral"
    );
  });
});

describe("buildConversationConfig", () => {
  it("maps internal camelCase voice settings to agent snake_case fields", () => {
    const config = buildConversationConfig({
      name: "Busy Manager",
      prompt: "prompt",
      firstMessage: "よろしくお願いします。",
      knowledgeBase: [
        {
          id: "kb_123",
          name: "kb",
          type: "text",
        },
      ],
      llmModel: "gpt-5-mini",
      language: "ja",
      tts: {
        modelId: "eleven_multilingual_v2",
        voiceId: "voice_123",
        languageCode: "ja",
        textNormalisationType: "elevenlabs",
        voiceSettings: {
          stability: 0.7,
          similarityBoost: 0.82,
          speed: 0.97,
          style: 0,
          useSpeakerBoost: true,
        },
        pronunciationDictionaryLocators: [
          {
            pronunciationDictionaryId: "dict_123",
            versionId: "ver_123",
          },
        ],
      },
    });

    expect(config.llm.model).toBe("gpt-5-mini");
    expect(config.tts.model_id).toBe("eleven_multilingual_v2");
    expect(config.tts.voice_id).toBe("voice_123");
    expect(config.tts.text_normalisation_type).toBe("elevenlabs");
    expect(config.tts.similarity_boost).toBe(0.82);
    expect(config.tts.pronunciation_dictionary_locators).toEqual([
      {
        pronunciation_dictionary_id: "dict_123",
        version_id: "ver_123",
      },
    ]);
  });
});

describe("ElevenLabsClient.renderSpeech", () => {
  it("sends render payloads with normalization and nested voice settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://api.elevenlabs.io/v1/text-to-speech/voice_123",
      headers: new Headers({
        "x-request-id": "req_123",
      }),
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ElevenLabsClient("test-key");
    const result = await client.renderSpeech({
      text: "よろしくお願いします。",
      modelId: "eleven_flash_v2_5",
      voiceId: "voice_123",
      languageCode: "ja",
      textNormalisationType: "elevenlabs",
      voiceSettings: {
        similarityBoost: 0.82,
      },
      seed: 42,
    });

    expect(result.audio).toBeInstanceOf(Buffer);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model_id: "eleven_flash_v2_5",
      language_code: "ja",
      apply_text_normalization: "on",
      apply_language_text_normalization: true,
      seed: 42,
      voice_settings: {
        similarity_boost: 0.82,
      },
    });
  });

  it("uses v3-compatible normalization flags and Voice Design payloads", async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce({
        previews: [
          {
            generated_voice_id: "gen_1",
            audio_base_64: "AQID",
          },
        ],
        text: "preview text",
      })
      .mockResolvedValueOnce({
        voice_id: "voice_123",
        name: "Designed Voice",
      });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://api.elevenlabs.io/v1/text-to-speech/voice_123",
      headers: new Headers(),
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ElevenLabsClient("test-key");
    await client.renderSpeech({
      text: "要点だけ確認させてください。",
      modelId: "eleven_v3",
      voiceId: "voice_123",
      textNormalisationType: "elevenlabs",
    });
    await client.designVoicePreviews({
      voiceDescription: "A calm Japanese business voice",
      modelId: "eleven_ttv_v3",
      text: "お時間ありがとうございます。要点だけ確認させてください。",
      autoGenerateText: false,
    });
    await client.createVoiceFromPreview({
      voiceName: "JA Rescue",
      voiceDescription: "A calm Japanese business voice",
      generatedVoiceId: "gen_1",
      labels: {
        accent: "Japanese",
      },
    });

    const [, renderInit] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(renderInit?.body))).toMatchObject({
      model_id: "eleven_v3",
      apply_text_normalization: "auto",
    });
    expect(JSON.parse(String(renderInit?.body))).not.toHaveProperty(
      "apply_language_text_normalization"
    );
    const requestCalls = vi.mocked(requestJson).mock.calls.map(([request]) => request);
    const designCall = requestCalls.find(
      (request) => request.scope === "elevenlabs.designVoicePreviews"
    );
    const createCall = requestCalls.find(
      (request) => request.scope === "elevenlabs.createVoiceFromPreview"
    );

    expect(designCall).toBeTruthy();
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String(designCall?.body))).toMatchObject({
      voice_description: "A calm Japanese business voice",
      model_id: "eleven_ttv_v3",
      auto_generate_text: false,
    });
    expect(JSON.parse(String(createCall?.body))).toMatchObject({
      voice_name: "JA Rescue",
      generated_voice_id: "gen_1",
      labels: {
        accent: "Japanese",
      },
    });
  });
});
