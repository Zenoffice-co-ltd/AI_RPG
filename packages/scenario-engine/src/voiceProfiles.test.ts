import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertVoiceProfileProductionReady,
  buildLegacyVoiceSelection,
  buildProfileVoiceSelection,
  listVoiceProfiles,
  listVoiceVariationProfiles,
  loadVoiceProfile,
  loadScenarioVoiceProfileMap,
  loadVoiceVariationCohort,
  resolveMappedVoiceProfile,
} from "./voiceProfiles";

async function createConfigRoot() {
  const root = await mkdtemp(resolve(tmpdir(), "voice-profiles-"));
  await mkdir(root, { recursive: true });
  await mkdir(resolve(root, "ja_voice_variations"), { recursive: true });
  await writeFile(
    resolve(root, "scenario-map.json"),
    JSON.stringify({
      activeProfiles: {
        staffing_order_hearing_busy_manager_medium: "busy_manager_ja_baseline_v1",
      },
    }),
    "utf8"
  );
  await writeFile(
    resolve(root, "busy_manager_ja_baseline_v1.json"),
    JSON.stringify({
      id: "busy_manager_ja_baseline_v1",
      label: "Busy Manager JA Baseline v1",
      language: "ja",
      model: "eleven_flash_v2_5",
      voiceId: "voice_123",
      firstMessageJa: "よろしくお願いします。",
      textNormalisationType: "elevenlabs",
      voiceSettings: {
        stability: 0.7,
      },
    }),
    "utf8"
  );
  await writeFile(
    resolve(root, "ja_voice_variations", "busy_manager_ja_voice15_f01.json"),
    JSON.stringify({
      id: "busy_manager_ja_voice15_f01",
      label: "Busy Manager JA Voice15 F01",
      language: "ja",
      model: "eleven_multilingual_v2",
      voiceId: "voice_f01",
      firstMessageJa: "要点だけ確認させてください。",
      textNormalisationType: "elevenlabs",
      voiceSettings: {
        stability: 0.7,
        similarityBoost: 0.82,
        speed: 0.96,
        style: 0,
        useSpeakerBoost: true,
      },
      metadata: {
        candidateId: "F01",
        source: "shared",
        gender: "female",
        voiceName: "Professional Voice",
        cohortId: "busy_manager_ja_voice15",
        stage: "round1",
      },
    }),
    "utf8"
  );
  await writeFile(
    resolve(root, "ja_voice_variations", "cohort.json"),
    JSON.stringify({
      id: "busy_manager_ja_voice15",
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      personaKey: "busy_manager_medium",
      controlProfileIds: ["busy_manager_ja_baseline_v1"],
      candidates: [
        {
          candidateId: "F01",
          profileId: "busy_manager_ja_voice15_f01",
          source: "shared",
          gender: "female",
          voiceId: "voice_f01",
          voiceName: "Professional Voice",
          stage: "round1",
          controlGroup: false,
          finalist: false,
          liveCandidate: false,
        },
      ],
    }),
    "utf8"
  );

  return root;
}

describe("voice profile resolver", () => {
  it("loads the active scenario mapping", async () => {
    const root = await createConfigRoot();
    const mapping = await loadScenarioVoiceProfileMap(root);

    expect(
      mapping.activeProfiles.staffing_order_hearing_busy_manager_medium
    ).toBe("busy_manager_ja_baseline_v1");
  });

  it("resolves a mapped voice profile", async () => {
    const root = await createConfigRoot();
    const profile = await resolveMappedVoiceProfile(
      "staffing_order_hearing_busy_manager_medium",
      root
    );

    expect(profile?.id).toBe("busy_manager_ja_baseline_v1");
    expect(profile?.voiceId).toBe("voice_123");
  });

  it("returns null when the scenario is unmapped", async () => {
    const root = await createConfigRoot();
    await expect(
      resolveMappedVoiceProfile("staffing_order_hearing_friendly_manager_easy", root)
    ).resolves.toBeNull();
  });

  it("loads profiles from nested directories", async () => {
    const root = await createConfigRoot();

    await expect(loadVoiceProfile("busy_manager_ja_voice15_f01", root)).resolves.toMatchObject({
      id: "busy_manager_ja_voice15_f01",
      voiceId: "voice_f01",
    });
    await expect(listVoiceProfiles(root)).resolves.toHaveLength(2);
  });

  it("loads the voice variation cohort and candidate profiles", async () => {
    const root = await createConfigRoot();

    const cohort = await loadVoiceVariationCohort(
      resolve(root, "ja_voice_variations", "cohort.json")
    );
    const profiles = await listVoiceVariationProfiles(
      resolve(root, "ja_voice_variations", "cohort.json"),
      root
    );

    expect(cohort.id).toBe("busy_manager_ja_voice15");
    expect(profiles[0]?.candidate.candidateId).toBe("F01");
    expect(profiles[0]?.profile.id).toBe("busy_manager_ja_voice15_f01");
  });

  it("builds profile-backed and legacy voice selections", async () => {
    const root = await createConfigRoot();
    const profile = await resolveMappedVoiceProfile(
      "staffing_order_hearing_busy_manager_medium",
      root
    );

    const mappedSelection = buildProfileVoiceSelection({
      scenarioId: "staffing_order_hearing_busy_manager_medium",
      scenarioOpeningLine: "時間がありません。",
      profile: profile!,
      resolvedVoiceId: "voice_resolved",
    });
    const legacySelection = buildLegacyVoiceSelection({
      scenarioId: "staffing_order_hearing_friendly_manager_easy",
      scenarioOpeningLine: "よろしくお願いします。",
      resolvedVoiceId: "voice_fallback",
    });

    expect(mappedSelection.mode).toBe("profile");
    expect(mappedSelection.voiceId).toBe("voice_resolved");
    expect(legacySelection.mode).toBe("legacy");
    expect(legacySelection.ttsModel).toBe("eleven_flash_v2_5");
  });

  it("fails closed when an approved profile is missing dictionary locators", async () => {
    expect(() =>
      assertVoiceProfileProductionReady({
        id: "busy_manager_ja_primary_v3_f06",
        label: "Busy Manager JA Primary V3 F06",
        language: "ja",
        model: "eleven_v3",
        voiceId: "voice_approved",
        textNormalisationType: "elevenlabs",
        voiceSettings: {
          speed: 0.96,
          style: 0,
        },
        metadata: {
          benchmarkStatus: "approved",
        },
      })
    ).toThrow("pronunciationDictionaryLocators");
  });
});

describe("voice profile resolver against repo config", () => {
  it("resolves the active approved profile and the fallback profile from the repo", async () => {
    const activeProfile = await resolveMappedVoiceProfile(
      "staffing_order_hearing_busy_manager_medium"
    );
    const fallbackProfile = await loadVoiceProfile("busy_manager_ja_fallback_v3_m03");

    expect(activeProfile?.id).toBe("busy_manager_ja_baseline_v1");
    expect(activeProfile?.metadata?.benchmarkStatus).toBe("candidate");
    expect(fallbackProfile.id).toBe("busy_manager_ja_fallback_v3_m03");
    expect(fallbackProfile.metadata?.benchmarkStatus).toBe("approved");
  });

  it("builds a fallback-capable matrix where the active mapped profile exists", async () => {
    const mapping = await loadScenarioVoiceProfileMap();
    const activeProfileId =
      mapping.activeProfiles.staffing_order_hearing_busy_manager_medium;

    await expect(loadVoiceProfile(activeProfileId)).resolves.toMatchObject({
      id: "busy_manager_ja_baseline_v1",
    });
  });
});
