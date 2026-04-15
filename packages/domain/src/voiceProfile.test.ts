import { describe, expect, it } from "vitest";
import {
  scenarioVoiceProfileMapSchema,
  voiceProfileSchema,
  voiceVariationCohortSchema,
} from "./voiceProfile";

describe("voiceProfileSchema", () => {
  it("accepts a valid Japanese voice profile", () => {
    expect(() =>
      voiceProfileSchema.parse({
        id: "busy_manager_ja_baseline_v1",
        label: "Busy Manager JA Baseline v1",
        language: "ja",
        model: "eleven_flash_v2_5",
        voiceId: "voice_123",
        firstMessageJa: "よろしくお願いします。",
        textNormalisationType: "elevenlabs",
        voiceSettings: {
          stability: 0.7,
          similarityBoost: 0.82,
          speed: 0.97,
          style: 0,
          useSpeakerBoost: true,
        },
      })
    ).not.toThrow();
  });

  it("fails when voiceId is empty", () => {
    expect(() =>
      voiceProfileSchema.parse({
        id: "bad_profile",
        label: "Bad Profile",
        language: "ja",
        model: "eleven_flash_v2_5",
        voiceId: "",
        textNormalisationType: "elevenlabs",
        voiceSettings: {},
      })
    ).toThrow();
  });

  it("fails when speed is not positive", () => {
    expect(() =>
      voiceProfileSchema.parse({
        id: "bad_speed",
        label: "Bad Speed",
        language: "ja",
        model: "eleven_flash_v2_5",
        voiceId: "voice_123",
        textNormalisationType: "elevenlabs",
        voiceSettings: {
          speed: 0,
        },
      })
    ).toThrow();
  });

  it("fails when a dictionary locator is missing versionId", () => {
    expect(() =>
      voiceProfileSchema.parse({
        id: "bad_dictionary",
        label: "Bad Dictionary",
        language: "ja",
        model: "eleven_flash_v2_5",
        voiceId: "voice_123",
        textNormalisationType: "elevenlabs",
        voiceSettings: {},
        pronunciationDictionaryLocators: [
          {
            pronunciationDictionaryId: "dict_123",
          },
        ],
      })
    ).toThrow();
  });

  it("accepts cohort metadata for voice variation candidates", () => {
    expect(() =>
      voiceProfileSchema.parse({
        id: "busy_manager_ja_voice15_f01",
        label: "Busy Manager JA Voice 15 F01",
        language: "ja",
        model: "eleven_multilingual_v2",
        voiceId: "voice_123",
        textNormalisationType: "elevenlabs",
        voiceSettings: {
          stability: 0.7,
          similarityBoost: 0.82,
          speed: 0.96,
          style: 0,
          useSpeakerBoost: true,
        },
        metadata: {
          personaKey: "busy_manager_medium",
          candidateId: "F01",
          source: "shared",
          gender: "female",
          voiceName: "Professional Voice",
          cohortId: "busy_manager_ja_voice15",
          stage: "round1",
          controlGroup: false,
        },
      })
    ).not.toThrow();
  });

  it("accepts scenario voice maps with preview and benchmark profiles", () => {
    expect(() =>
      scenarioVoiceProfileMapSchema.parse({
        activeProfiles: {
          staffing_order_hearing_busy_manager_medium: "busy_manager_ja_baseline_v1",
        },
        previewProfiles: {
          accounting_clerk_enterprise_ap_busy_manager_medium:
            "accounting_clerk_enterprise_ap_ja_v3_candidate_v1",
        },
        benchmarkProfiles: {
          accounting_clerk_enterprise_ap_busy_manager_medium:
            "accounting_clerk_enterprise_ap_ja_v3_candidate_v1",
        },
      })
    ).not.toThrow();
  });
});

describe("voiceVariationCohortSchema", () => {
  it("accepts a cohort manifest with control and shortlist metadata", () => {
    expect(() =>
      voiceVariationCohortSchema.parse({
        cohortId: "busy_manager_ja_voice15",
        scenarioId: "staffing_order_hearing_busy_manager_medium",
        model: "eleven_multilingual_v2",
        language: "ja",
        firstMessageJa: "要点だけ確認させてください。",
        textNormalisationType: "elevenlabs",
        voiceSettings: {
          stability: 0.7,
          similarityBoost: 0.82,
          speed: 0.96,
          style: 0,
          useSpeakerBoost: true,
        },
        controlProfileIds: [
          "busy_manager_ja_baseline_v1",
          "busy_manager_ja_multilingual_candidate_v1",
          "busy_manager_ja_v3_candidate_v1",
        ],
        candidates: [
          {
            candidateId: "F01",
            profileId: "busy_manager_ja_voice15_f01",
            source: "shared",
            gender: "female",
            voiceId: "voice_123",
            voiceName: "Professional Voice",
            stage: "round1",
            controlGroup: false,
            finalist: true,
            liveCandidate: false,
          },
        ],
      })
    ).not.toThrow();
  });
});
