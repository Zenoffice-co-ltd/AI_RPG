import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildJaVoiceInventoryRows,
  buildJaVoiceVariationRoundTargets,
  scoreJaVoiceInventoryRow,
  selectJaVoiceVariationCandidates,
  summarizeJaVoiceReviewSheet,
} from "./jaVoiceVariations";
import {
  JA_VOICE_VARIATION_COHORT_PATH,
  listVoiceVariationProfiles,
  loadVoiceVariationCohort,
} from "./voiceProfiles";

describe("jaVoiceVariations inventory", () => {
  it("scores calm professional Japanese voices above playful or foreign-accented ones", () => {
    const calmScore = scoreJaVoiceInventoryRow({
      category: "professional",
      accent: "standard",
      description: "calm neutral professional Japanese voice",
      descriptive: "calm",
      useCase: "conversational",
      verifiedLanguages: "ja-JP|ja-JP",
      locale: "ja-JP",
    });
    const playfulScore = scoreJaVoiceInventoryRow({
      category: "professional",
      accent: "american",
      description: "playful anime character voice",
      descriptive: "playful",
      useCase: "characters_animation",
      verifiedLanguages: "ja-JP",
      locale: "en-US",
    });

    expect(calmScore).toBeGreaterThan(playfulScore);
  });

  it("builds inventory rows and selects a 15-slot cohort", () => {
    const rows = buildJaVoiceInventoryRows({
      workspaceVoices: [],
      sharedVoices: [
        ...Array.from({ length: 8 }, (_, index) => ({
          public_owner_id: `owner_f_${index}`,
          voice_id: `voice_f_${index}`,
          name: `Female ${index}`,
          accent: index < 4 ? "standard" : "kanto",
          gender: "female",
          category: "professional",
          language: "ja",
          locale: "ja-JP",
          description: "calm professional Japanese voice",
          preview_url: "https://example.com/preview.mp3",
          descriptive: "calm",
          use_case: "conversational",
          verified_languages: [{ language: "ja", locale: "ja-JP" }],
        })),
        ...Array.from({ length: 8 }, (_, index) => ({
          public_owner_id: `owner_m_${index}`,
          voice_id: `voice_m_${index}`,
          name: `Male ${index}`,
          accent: index < 4 ? "standard" : "kanto",
          gender: "male",
          category: "professional",
          language: "ja",
          locale: "ja-JP",
          description: "calm professional Japanese voice",
          preview_url: "https://example.com/preview.mp3",
          descriptive: "calm",
          use_case: "conversational",
          verified_languages: [{ language: "ja", locale: "ja-JP" }],
        })),
      ],
    });

    const selected = selectJaVoiceVariationCandidates(rows);

    expect(selected).toHaveLength(15);
    expect(selected.filter((row) => row.slotId.startsWith("F"))).toHaveLength(6);
    expect(selected.filter((row) => row.slotId.startsWith("M"))).toHaveLength(6);
    expect(selected.filter((row) => row.slotId.startsWith("R"))).toHaveLength(3);
  });
});

describe("jaVoiceVariations rounds", () => {
  async function createConfigRoot() {
    const root = await mkdtemp(resolve(tmpdir(), "voice15-"));
    await mkdir(resolve(root, "ja_voice_variations"), { recursive: true });
    await writeFile(
      resolve(root, "busy_manager_ja_baseline_v1.json"),
      JSON.stringify({
        id: "busy_manager_ja_baseline_v1",
        label: "Baseline",
        language: "ja",
        model: "eleven_flash_v2_5",
        voiceId: "voice_control",
        textNormalisationType: "elevenlabs",
        voiceSettings: {},
      }),
      "utf8"
    );
    await writeFile(
      resolve(root, "busy_manager_ja_multilingual_candidate_v1.json"),
      JSON.stringify({
        id: "busy_manager_ja_multilingual_candidate_v1",
        label: "Multilingual Control",
        language: "ja",
        model: "eleven_multilingual_v2",
        voiceId: "voice_control_multi",
        textNormalisationType: "elevenlabs",
        voiceSettings: {},
      }),
      "utf8"
    );
    await writeFile(
      resolve(root, "busy_manager_ja_v3_candidate_v1.json"),
      JSON.stringify({
        id: "busy_manager_ja_v3_candidate_v1",
        label: "V3 Control",
        language: "ja",
        model: "eleven_v3",
        voiceId: "voice_control_v3",
        textNormalisationType: "elevenlabs",
        voiceSettings: {},
      }),
      "utf8"
    );
    await writeFile(
      resolve(root, "ja_voice_variations", "busy_manager_ja_voice15_f01.json"),
      JSON.stringify({
        id: "busy_manager_ja_voice15_f01",
        label: "Voice F01",
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
          voiceName: "Voice F01",
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
            voiceId: "voice_f01",
            voiceName: "Voice F01",
            stage: "round1",
            controlGroup: false,
            finalist: true,
            liveCandidate: false,
          },
        ],
      }),
      "utf8"
    );
    return root;
  }

  it("resolves round targets for control and round2 lanes", async () => {
    const root = await createConfigRoot();
    const control = await buildJaVoiceVariationRoundTargets({
      round: "control",
      cohortPath: resolve(root, "ja_voice_variations", "cohort.json"),
      configRoot: root,
    });
    const round2 = await buildJaVoiceVariationRoundTargets({
      round: "round2-v3",
      cohortPath: resolve(root, "ja_voice_variations", "cohort.json"),
      configRoot: root,
    });

    expect(control.targets).toHaveLength(3);
    expect(round2.targets[0]?.modelId).toBe("eleven_v3");
    expect(round2.targets[0]?.candidateId).toBe("F01");
  });
});

describe("jaVoiceVariations review summary", () => {
  it("aggregates weighted review scores and knockout flags", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "voice-review-"));
    const csvPath = resolve(root, "review.csv");
    await writeFile(
      csvPath,
      [
        "runId,round,lane,candidateId,source,gender,profileId,targetLabel,utteranceId,category,utterance,status,outputFile,自然さ,滑らかさ,訛り感の少なさ,信頼感,読みの正確さ,電話口での聞きやすさ,busy_manager適合度,knockout理由,comments",
        "run_1,round1-sanity,multilingual,F01,shared,female,busy_manager_ja_voice15_f01,Voice F01,u1,opening,よろしくお願いします,success,audio/u1.mp3,5,4,5,4,5,4,5,,good",
        "run_1,round1-sanity,multilingual,F01,shared,female,busy_manager_ja_voice15_f01,Voice F01,u2,closing,またお願いします,success,audio/u2.mp3,4,4,5,4,4,4,4,,steady",
      ].join("\n"),
      "utf8"
    );

    const summary = await summarizeJaVoiceReviewSheet({ csvPath });

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]?.knockout).toBe(false);
    expect(summary.rows[0]?.overallScore).toBeGreaterThan(80);
  });
});

describe("jaVoiceVariations repo cohort", () => {
  it("keeps all 15 candidate voiceIds unique and includes both genders", async () => {
    const cohort = await loadVoiceVariationCohort(JA_VOICE_VARIATION_COHORT_PATH);
    const uniqueVoiceIds = new Set(cohort.candidates.map((candidate) => candidate.voiceId));
    const genders = new Set(cohort.candidates.map((candidate) => candidate.gender));

    expect(cohort.candidates).toHaveLength(15);
    expect(uniqueVoiceIds.size).toBe(15);
    expect(genders.has("female")).toBe(true);
    expect(genders.has("male")).toBe(true);
  });

  it("marks F06 as primary and M03 as fallback in the live shortlist", async () => {
    const cohort = await loadVoiceVariationCohort(JA_VOICE_VARIATION_COHORT_PATH);
    const profiles = await listVoiceVariationProfiles(JA_VOICE_VARIATION_COHORT_PATH);
    const primary = cohort.candidates.find((candidate) => candidate.stage === "primary");
    const fallback = cohort.candidates.find((candidate) => candidate.stage === "fallback");
    const primaryProfile = profiles.find(
      (entry) => entry.candidate.candidateId === "F06"
    )?.profile;
    const fallbackProfile = profiles.find(
      (entry) => entry.candidate.candidateId === "M03"
    )?.profile;

    expect(primary?.candidateId).toBe("F06");
    expect(fallback?.candidateId).toBe("M03");
    expect(primaryProfile?.metadata?.stage).toBe("primary");
    expect(fallbackProfile?.metadata?.stage).toBe("fallback");
  });
});
