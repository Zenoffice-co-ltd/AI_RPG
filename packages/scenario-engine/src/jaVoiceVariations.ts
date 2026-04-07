import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import Papa from "papaparse";
import type {
  TextNormalisationType,
  VoiceProfile,
  VoiceVariationCandidate,
  VoiceVariationCohort,
  VoiceVariationGender,
  VoiceVariationSource,
} from "@top-performer/domain";
import type {
  ElevenLabsClient,
  ElevenLabsSharedVoiceSummary,
  ElevenLabsVoiceSummary,
} from "@top-performer/vendors";
import {
  JA_VOICE_VARIATION_COHORT_PATH,
  JA_VOICE_VARIATIONS_CONFIG_ROOT,
  listVoiceVariationProfiles,
  loadVoiceProfile,
  loadVoiceVariationCohort,
} from "./voiceProfiles";
import {
  type BenchmarkTarget,
  VOICE_BENCHMARK_GENERATED_ROOT,
  VOICE_BENCHMARK_SOURCE_ROOT,
  renderVoiceBenchmark,
} from "./benchmarkRenderer";

export const JA_VOICE_VARIATION_COHORT_ID = "busy_manager_ja_voice15";
export const JA_VOICE_CONTROL_PROFILE_IDS = [
  "busy_manager_ja_baseline_v1",
  "busy_manager_ja_multilingual_candidate_v1",
  "busy_manager_ja_v3_candidate_v1",
] as const;
export const JA_VOICE_ROUND1_FIRST_MESSAGE =
  "お時間ありがとうございます。要点だけ確認させてください。";
export const JA_VOICE_SANITY_UTTERANCE_CSV = resolve(
  VOICE_BENCHMARK_SOURCE_ROOT,
  "utterances_ja_busy_manager_sanity.csv"
);
export const JA_VOICE_FULL_UTTERANCE_CSV = resolve(
  VOICE_BENCHMARK_SOURCE_ROOT,
  "utterances_ja_busy_manager.csv"
);
export const JA_VOICE_INVENTORY_GENERATED_ROOT = resolve(
  VOICE_BENCHMARK_GENERATED_ROOT,
  "ja-voice-inventory"
);
export const JA_VOICE_REVIEW_SUMMARY_ROOT = resolve(
  VOICE_BENCHMARK_GENERATED_ROOT,
  "ja-voice-review"
);
export const JA_VOICE_ROUND1_SETTINGS = {
  stability: 0.7,
  similarityBoost: 0.82,
  speed: 0.96,
  style: 0,
  useSpeakerBoost: true,
} as const;
export const JA_VOICE_V3_SETTINGS = {
  speed: 0.96,
  style: 0,
} as const;
export const JA_VOICE_FLASH_SETTINGS = {
  stability: 0.7,
  similarityBoost: 0.82,
  speed: 0.96,
  style: 0,
  useSpeakerBoost: true,
} as const;
export const JA_VOICE_DICTIONARY_TOKENS = [
  "Adecco",
  "WMS",
  "Excel",
  "BPO",
  "KPI",
] as const;
export const JA_VOICE_RESCUE_PROMPTS = {
  R01: "A native Japanese adult female voice for B2B staffing phone conversations. Calm, clear, warm, trustworthy, neutral Tokyo-style Japanese, measured pace, low breathiness, not cute, not chatty, not overly bright, not dramatic. She sounds like a competent operations manager speaking politely but efficiently on a busy workday.",
  R02: "A native Japanese adult male voice for B2B staffing phone conversations. Calm, composed, direct, trustworthy, neutral Tokyo-style Japanese, smooth cadence, not gruff, not announcer-like, not dramatic, not overly deep. He sounds like a practical logistics manager who is busy but professional.",
  R03: "A native Japanese office professional voice for business calls. Very natural and smooth, neutral Tokyo-style Japanese, clear articulation, measured pace, trustworthy and composed, neither too bright nor too cold, suitable for a busy decision-maker in a staffing discussion. No regional dialect, no foreign accent, no cartoon-like tone.",
} as const;
export const JA_VOICE_RESCUE_PREVIEW_TEXT =
  "お時間ありがとうございます。かなり立て込んでいるので、結論からお願いできますか。開始は5月12日ですが、理想は4月30日までに3名そろえたいです。決裁は私だけではなく、物流部長と人事の確認が入ります。Excel と WMS の基本操作ができる方だと助かります。では、明日の14時までに候補者の見立てを送ってください。";
export const JA_VOICE_SCORE_WEIGHTS = {
  "自然さ": 25,
  "滑らかさ": 20,
  "訛り感の少なさ": 20,
  "信頼感": 15,
  "読みの正確さ": 10,
  "電話口での聞きやすさ": 10,
} as const;

const POSITIVE_TOKENS = [
  "calm",
  "neutral",
  "warm",
  "clear",
  "professional",
  "conversational",
  "measured",
  "composed",
  "mature",
];

const NEGATIVE_TOKENS = [
  "chatty",
  "quirky",
  "playful",
  "cute",
  "child",
  "anime",
  "cartoon",
  "dramatic",
  "seductive",
  "sexy",
  "shouting",
  "over-energetic",
  "energetic",
  "character-heavy",
  "character",
];

const FOREIGN_ACCENTS = [
  "american",
  "british",
  "australian",
  "irish",
  "scottish",
  "indian",
  "french",
  "german",
];

export type JaVoiceInventoryRow = {
  candidateId: string;
  source: Exclude<VoiceVariationSource, "control" | "designed">;
  voiceId: string;
  name: string;
  gender: VoiceVariationGender;
  accent: string;
  category: string;
  description: string;
  previewUrl: string;
  autoScore: number;
  humanPreviewPass: string;
  notes: string;
  verifiedLanguages: string;
  locale: string;
  descriptive: string;
  useCase: string;
  publicOwnerId: string;
  isAddedByUser: boolean;
};

export type JaVoiceSelectionRow = JaVoiceInventoryRow & {
  slotId: string;
  rescueFallback?: boolean;
};

export type JaVoiceBenchmarkRound =
  | "control"
  | "round1-sanity"
  | "round1-full"
  | "round2-multilingual"
  | "round2-v3"
  | "round2-flash";

export type JaVoiceReviewSummaryRow = {
  targetLabel: string;
  candidateId: string;
  profileId: string;
  rowCount: number;
  overallScore: number;
  roleFitAverage: number;
  knockout: boolean;
  knockoutReasons: string;
  comments: string;
};

function sourcePriority(source: JaVoiceInventoryRow["source"]) {
  return source === "workspace" ? 0 : 1;
}

function normalizeGender(value?: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("f")) {
    return "female" as const;
  }
  if (normalized.startsWith("m")) {
    return "male" as const;
  }
  return "unknown" as const;
}

function normalizeText(value?: string | null) {
  return value?.trim() ?? "";
}

function tokenize(...values: Array<string | null | undefined>) {
  return values
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function nextInventoryId(
  source: JaVoiceInventoryRow["source"],
  index: number
) {
  const prefix = source === "workspace" ? "workspace" : "shared";
  return `${prefix}_${String(index + 1).padStart(3, "0")}`;
}

export function scoreJaVoiceInventoryRow(input: {
  category: string;
  accent: string;
  description: string;
  descriptive: string;
  useCase: string;
  verifiedLanguages: string;
  locale: string;
  labels?: string;
}) {
  const haystack = tokenize(
    input.category,
    input.accent,
    input.description,
    input.descriptive,
    input.useCase,
    input.verifiedLanguages,
    input.locale,
    input.labels
  );

  let score = 0;
  if (input.category === "professional") {
    score += 12;
  } else if (input.category === "high_quality") {
    score += 10;
  }
  if (haystack.includes("ja") || haystack.includes("japanese")) {
    score += 15;
  }
  if (
    input.accent.toLowerCase().includes("japanese") ||
    input.accent.toLowerCase().includes("tokyo") ||
    input.accent.toLowerCase().includes("neutral")
  ) {
    score += 8;
  }
  for (const token of POSITIVE_TOKENS) {
    if (haystack.includes(token)) {
      score += 4;
    }
  }
  for (const token of NEGATIVE_TOKENS) {
    if (haystack.includes(token)) {
      score -= 7;
    }
  }
  for (const accent of FOREIGN_ACCENTS) {
    if (input.accent.toLowerCase().includes(accent)) {
      score -= 10;
    }
  }

  return score;
}

function extractWorkspaceAccent(voice: ElevenLabsVoiceSummary) {
  return (
    voice.labels?.["accent"] ??
    voice.verified_languages?.[0]?.locale ??
    voice.verified_languages?.[0]?.language ??
    ""
  );
}

function extractWorkspaceGender(voice: ElevenLabsVoiceSummary) {
  return normalizeGender(voice.labels?.["gender"]);
}

export function buildJaVoiceInventoryRows(input: {
  workspaceVoices: ElevenLabsVoiceSummary[];
  sharedVoices: ElevenLabsSharedVoiceSummary[];
}) {
  const workspaceRows = input.workspaceVoices.map((voice, index) => {
    const verifiedLanguages =
      voice.verified_languages
        ?.map((entry) => entry.locale ?? entry.language ?? "")
        .filter(Boolean)
        .join("|") ?? "";
    const accent = extractWorkspaceAccent(voice);
    const category = normalizeText(voice.category);
    const description = normalizeText(voice.description);
    const labels =
      Object.entries(voice.labels ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join("|") ?? "";

    return {
      candidateId: nextInventoryId("workspace", index),
      source: "workspace" as const,
      voiceId: voice.voice_id,
      name: voice.name,
      gender: extractWorkspaceGender(voice),
      accent,
      category,
      description,
      previewUrl: normalizeText(voice.preview_url),
      autoScore: scoreJaVoiceInventoryRow({
        category,
        accent,
        description,
        descriptive: "",
        useCase: "",
        verifiedLanguages,
        locale: verifiedLanguages,
        labels,
      }),
      humanPreviewPass: "",
      notes: "",
      verifiedLanguages,
      locale: voice.verified_languages?.[0]?.locale ?? "",
      descriptive: "",
      useCase: "",
      publicOwnerId: "",
      isAddedByUser: true,
    } satisfies JaVoiceInventoryRow;
  });

  const sharedRows = input.sharedVoices.map((voice, index) => {
    const verifiedLanguages =
      voice.verified_languages
        ?.map((entry) => entry.locale ?? entry.language ?? "")
        .filter(Boolean)
        .join("|") ?? "";
    const accent = normalizeText(voice.accent);
    const category = normalizeText(voice.category);
    const description = normalizeText(voice.description);
    const descriptive = normalizeText(voice.descriptive);
    const useCase = normalizeText(voice.use_case);
    const locale = normalizeText(voice.locale);

    return {
      candidateId: nextInventoryId("shared", index),
      source: "shared" as const,
      voiceId: voice.voice_id,
      name: voice.name,
      gender: normalizeGender(voice.gender),
      accent,
      category,
      description,
      previewUrl: normalizeText(voice.preview_url),
      autoScore: scoreJaVoiceInventoryRow({
        category,
        accent,
        description,
        descriptive,
        useCase,
        verifiedLanguages,
        locale,
      }),
      humanPreviewPass: "",
      notes: "",
      verifiedLanguages,
      locale,
      descriptive,
      useCase,
      publicOwnerId: voice.public_owner_id,
      isAddedByUser: Boolean(voice.is_added_by_user),
    } satisfies JaVoiceInventoryRow;
  });

  return [...workspaceRows, ...sharedRows].sort((left, right) => {
    if (left.autoScore !== right.autoScore) {
      return right.autoScore - left.autoScore;
    }
    if (sourcePriority(left.source) !== sourcePriority(right.source)) {
      return sourcePriority(left.source) - sourcePriority(right.source);
    }
    return left.name.localeCompare(right.name);
  });
}

export async function writeJaVoiceInventoryReport(input: {
  elevenLabs: ElevenLabsClient;
  outputDir?: string;
  search?: string;
}) {
  const outputDir = input.outputDir ?? JA_VOICE_INVENTORY_GENERATED_ROOT;
  const workspaceVoices = await input.elevenLabs.listVoices({
    ...(input.search ? { query: input.search } : {}),
    pageSize: 100,
  });
  const sharedVoices = [
    ...(await input.elevenLabs.listSharedVoices({
      pageSize: 100,
      category: "professional",
      language: "ja",
      locale: "ja-JP",
      gender: "female",
      descriptives: "calm,neutral,warm,clear",
    })),
    ...(await input.elevenLabs.listSharedVoices({
      pageSize: 100,
      category: "professional",
      language: "ja",
      locale: "ja-JP",
      gender: "male",
      descriptives: "calm,neutral,warm,clear",
    })),
    ...(await input.elevenLabs.listSharedVoices({
      pageSize: 100,
      category: "high_quality",
      language: "ja",
      locale: "ja-JP",
      gender: "female",
      descriptives: "calm,neutral,warm,clear",
    })),
    ...(await input.elevenLabs.listSharedVoices({
      pageSize: 100,
      category: "high_quality",
      language: "ja",
      locale: "ja-JP",
      gender: "male",
      descriptives: "calm,neutral,warm,clear",
    })),
  ];
  const dedupedShared = [...new Map(sharedVoices.map((voice) => [voice.voice_id, voice])).values()];
  const rows = buildJaVoiceInventoryRows({
    workspaceVoices,
    sharedVoices: dedupedShared,
  });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const jsonPath = resolve(outputDir, `${timestamp}.json`);
  const csvPath = resolve(outputDir, `${timestamp}.csv`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  await writeFile(csvPath, `${Papa.unparse(rows)}\n`, "utf8");

  return {
    count: rows.length,
    jsonPath,
    csvPath,
  };
}

function dedupeByVoice(rows: JaVoiceInventoryRow[]) {
  const seen = new Set<string>();
  const deduped: JaVoiceInventoryRow[] = [];
  for (const row of rows) {
    if (seen.has(row.voiceId)) {
      continue;
    }
    seen.add(row.voiceId);
    deduped.push(row);
  }
  return deduped;
}

function pickSlotRows(
  rows: JaVoiceInventoryRow[],
  gender: VoiceVariationGender,
  count: number,
  usedVoiceIds: Set<string>
) {
  const selected: JaVoiceInventoryRow[] = [];
  for (const row of dedupeByVoice(rows)) {
    if (row.gender !== gender || usedVoiceIds.has(row.voiceId)) {
      continue;
    }
    selected.push(row);
    usedVoiceIds.add(row.voiceId);
    if (selected.length === count) {
      break;
    }
  }
  return selected;
}

export function selectJaVoiceVariationCandidates(rows: JaVoiceInventoryRow[]) {
  const usedVoiceIds = new Set<string>();
  const female = pickSlotRows(rows, "female", 6, usedVoiceIds);
  const male = pickSlotRows(rows, "male", 6, usedVoiceIds);

  if (female.length < 6 || male.length < 6) {
    throw new Error(
      `Not enough Japanese candidates to build a 12-voice cohort. female=${female.length}, male=${male.length}`
    );
  }

  const remaining = dedupeByVoice(rows).filter((row) => !usedVoiceIds.has(row.voiceId));
  const rescueFemale = remaining.find((row) => row.gender === "female");
  if (rescueFemale) {
    usedVoiceIds.add(rescueFemale.voiceId);
  }
  const rescueMale = remaining.find(
    (row) => row.gender === "male" && !usedVoiceIds.has(row.voiceId)
  );
  if (rescueMale) {
    usedVoiceIds.add(rescueMale.voiceId);
  }
  const rescueFlex = remaining.find((row) => !usedVoiceIds.has(row.voiceId));
  const rescueRows = [rescueFemale, rescueMale, rescueFlex].filter(
    (row): row is JaVoiceInventoryRow => Boolean(row)
  );

  if (rescueRows.length < 3) {
    throw new Error(
      `Not enough remaining candidates to build rescue fallback rows. remaining=${rescueRows.length}`
    );
  }

  const withSlots: JaVoiceSelectionRow[] = [
    ...female.map((row, index) => ({ ...row, slotId: `F${String(index + 1).padStart(2, "0")}` })),
    ...male.map((row, index) => ({ ...row, slotId: `M${String(index + 1).padStart(2, "0")}` })),
    { ...rescueRows[0]!, slotId: "R01", rescueFallback: true },
    { ...rescueRows[1]!, slotId: "R02", rescueFallback: true },
    { ...rescueRows[2]!, slotId: "R03", rescueFallback: true },
  ];

  return withSlots;
}

function buildProfileTarget(
  profile: VoiceProfile,
  candidate?: VoiceVariationCandidate,
  round?: JaVoiceBenchmarkRound,
  lane?: string
): BenchmarkTarget {
  return {
    source: "profile",
    profileId: profile.id,
    label: profile.label,
    language: profile.language,
    modelId: profile.model,
    voiceId: profile.voiceId,
    ...(profile.firstMessageJa ? { firstMessage: profile.firstMessageJa } : {}),
    textNormalisationType: profile.textNormalisationType,
    voiceSettings: profile.voiceSettings,
    ...(profile.pronunciationDictionaryLocators
      ? {
          pronunciationDictionaryLocators:
            profile.pronunciationDictionaryLocators,
        }
      : {}),
    ...(candidate ? { candidateId: candidate.candidateId } : {}),
    ...(candidate ? { candidateSource: candidate.source } : {}),
    ...(candidate ? { candidateGender: candidate.gender } : {}),
    ...(profile.metadata?.voiceName ? { voiceName: profile.metadata.voiceName } : {}),
    ...(candidate ? { controlGroup: candidate.controlGroup } : {}),
    ...(round ? { round } : {}),
    ...(lane ? { lane } : {}),
    ...(candidate?.stage ? { stage: candidate.stage } : {}),
    ...(candidate?.notes ? { notes: candidate.notes } : {}),
  };
}

function buildLaneTarget(
  profile: VoiceProfile,
  candidate: VoiceVariationCandidate,
  lane: "multilingual" | "v3" | "flash"
): BenchmarkTarget {
  const laneConfig =
    lane === "v3"
      ? {
          modelId: "eleven_v3",
          voiceSettings: { ...JA_VOICE_V3_SETTINGS },
          textNormalisationType: "elevenlabs" as TextNormalisationType,
        }
      : lane === "flash"
        ? {
            modelId: "eleven_flash_v2_5",
            voiceSettings: { ...JA_VOICE_FLASH_SETTINGS },
            textNormalisationType: "elevenlabs" as TextNormalisationType,
          }
        : {
            modelId: "eleven_multilingual_v2",
            voiceSettings: { ...JA_VOICE_ROUND1_SETTINGS },
            textNormalisationType: "elevenlabs" as TextNormalisationType,
          };

  return {
    source: "raw",
    profileId: profile.id,
    label: `${profile.label} (${lane})`,
    language: profile.language,
    modelId: laneConfig.modelId,
    voiceId: profile.voiceId,
    firstMessage: JA_VOICE_ROUND1_FIRST_MESSAGE,
    textNormalisationType: laneConfig.textNormalisationType,
    voiceSettings: laneConfig.voiceSettings,
    ...(profile.pronunciationDictionaryLocators
      ? {
          pronunciationDictionaryLocators:
            profile.pronunciationDictionaryLocators,
        }
      : {}),
    candidateId: candidate.candidateId,
    candidateSource: candidate.source,
    candidateGender: candidate.gender,
    ...(profile.metadata?.voiceName
      ? { voiceName: profile.metadata.voiceName }
      : {}),
    controlGroup: candidate.controlGroup,
    round:
      lane === "multilingual"
        ? "round2-multilingual"
        : lane === "v3"
          ? "round2-v3"
          : "round2-flash",
    lane,
    stage: candidate.stage,
    ...(candidate.notes ? { notes: candidate.notes } : {}),
  };
}

export async function buildJaVoiceVariationRoundTargets(input: {
  round: JaVoiceBenchmarkRound;
  cohortPath?: string;
  configRoot?: string;
}) {
  const cohortPath = input.cohortPath ?? JA_VOICE_VARIATION_COHORT_PATH;
  const configRoot = input.configRoot ?? dirname(JA_VOICE_VARIATIONS_CONFIG_ROOT);
  const cohort = await loadVoiceVariationCohort(cohortPath);
  const variationProfiles = await listVoiceVariationProfiles(cohortPath, configRoot);

  if (input.round === "control") {
    const controlProfiles = await Promise.all(
      cohort.controlProfileIds.map((profileId) => loadVoiceProfile(profileId, configRoot))
    );

    return {
      cohort,
      targets: controlProfiles
        .filter((profile): profile is VoiceProfile => Boolean(profile))
        .map((profile) =>
          buildProfileTarget(
            profile,
            {
              candidateId: profile.metadata?.candidateId ?? "CONTROL",
              profileId: profile.id,
              source: "control",
              gender: profile.metadata?.gender ?? "unknown",
              voiceId: profile.voiceId,
              voiceName: profile.metadata?.voiceName ?? profile.label,
              stage: "control",
              controlGroup: true,
              finalist: false,
              liveCandidate: false,
            },
            "control",
            "control"
          )
        ),
    };
  }

  const finalistEntries = variationProfiles.filter((entry) => entry.candidate.finalist);
  const round1Entries = variationProfiles.filter(
    (entry) => !entry.candidate.controlGroup
  );

  if (
    (input.round === "round1-full" ||
      input.round === "round2-multilingual" ||
      input.round === "round2-v3" ||
      input.round === "round2-flash") &&
    finalistEntries.length === 0
  ) {
    throw new Error(
      `No finalists are marked in ${cohortPath}. Update cohort.json before running ${input.round}.`
    );
  }

  const targets =
    input.round === "round1-sanity"
      ? round1Entries.map((entry) =>
          buildProfileTarget(entry.profile, entry.candidate, "round1-sanity", "multilingual")
        )
      : input.round === "round1-full"
        ? finalistEntries.map((entry) =>
            buildProfileTarget(entry.profile, entry.candidate, "round1-full", "multilingual")
          )
        : finalistEntries.map((entry) =>
            buildLaneTarget(
              entry.profile,
              entry.candidate,
              input.round === "round2-v3"
                ? "v3"
                : input.round === "round2-flash"
                  ? "flash"
                  : "multilingual"
            )
          );

  return {
    cohort,
    targets,
  };
}

export async function renderJaVoiceVariationBenchmark(input: {
  elevenLabs: ElevenLabsClient;
  scenarioId: string;
  round: JaVoiceBenchmarkRound;
  outputDir?: string;
  cohortPath?: string;
  configRoot?: string;
  seed?: number;
  includeProfileIds?: string[];
}) {
  const { targets } = await buildJaVoiceVariationRoundTargets({
    round: input.round,
    ...(input.cohortPath ? { cohortPath: input.cohortPath } : {}),
    ...(input.configRoot ? { configRoot: input.configRoot } : {}),
  });
  const utteranceCsvPath =
    input.round === "round1-full" ||
    input.round === "round2-multilingual" ||
    input.round === "round2-v3" ||
    input.round === "round2-flash"
      ? JA_VOICE_FULL_UTTERANCE_CSV
      : JA_VOICE_SANITY_UTTERANCE_CSV;

  return renderVoiceBenchmark({
    elevenLabs: input.elevenLabs,
    scenarioId: input.scenarioId,
    targets,
    ...(input.includeProfileIds && input.includeProfileIds.length > 0
      ? { profileIds: input.includeProfileIds }
      : {}),
    ...(input.outputDir ? { outputDir: input.outputDir } : {}),
    utteranceCsvPath,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.configRoot ? { configRoot: input.configRoot } : {}),
  });
}

type ReviewCsvRow = {
  targetLabel: string;
  candidateId: string;
  profileId: string;
  [key: string]: string;
};

function parseReviewNumber(value: string | undefined) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function summarizeJaVoiceReviewSheet(input: {
  csvPath: string;
  outputDir?: string;
}) {
  const contents = await readFile(input.csvPath, "utf8");
  const parsed = Papa.parse<ReviewCsvRow>(contents, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(
      `Failed to parse review sheet ${input.csvPath}: ${parsed.errors[0]?.message}`
    );
  }

  const grouped = new Map<string, ReviewCsvRow[]>();
  for (const row of parsed.data) {
    const key = `${row.profileId}|${row.targetLabel}`;
    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }

  const summaryRows: JaVoiceReviewSummaryRow[] = [...grouped.values()]
    .map((rows) => {
      const head = rows[0]!;
      const overallScore =
        rows.reduce((total, row) => {
          const weighted =
            (parseReviewNumber(row["自然さ"]) / 5) * JA_VOICE_SCORE_WEIGHTS["自然さ"] +
            (parseReviewNumber(row["滑らかさ"]) / 5) * JA_VOICE_SCORE_WEIGHTS["滑らかさ"] +
            (parseReviewNumber(row["訛り感の少なさ"]) / 5) *
              JA_VOICE_SCORE_WEIGHTS["訛り感の少なさ"] +
            (parseReviewNumber(row["信頼感"]) / 5) * JA_VOICE_SCORE_WEIGHTS["信頼感"] +
            (parseReviewNumber(row["読みの正確さ"]) / 5) *
              JA_VOICE_SCORE_WEIGHTS["読みの正確さ"] +
            (parseReviewNumber(row["電話口での聞きやすさ"]) / 5) *
              JA_VOICE_SCORE_WEIGHTS["電話口での聞きやすさ"];
          return total + weighted;
        }, 0) / rows.length;

      const roleFitAverage =
        rows.reduce((total, row) => total + parseReviewNumber(row["busy_manager適合度"]), 0) /
        rows.length;
      const knockoutReasons = rows
        .map((row) => row["knockout理由"]?.trim() ?? "")
        .filter(Boolean)
        .join(" | ");
      const comments = rows
        .map((row) => row["comments"]?.trim() ?? row["コメント"]?.trim() ?? "")
        .filter(Boolean)
        .join(" | ");

      return {
        targetLabel: head.targetLabel,
        candidateId: head.candidateId,
        profileId: head.profileId,
        rowCount: rows.length,
        overallScore: Number(overallScore.toFixed(2)),
        roleFitAverage: Number(roleFitAverage.toFixed(2)),
        knockout: Boolean(knockoutReasons),
        knockoutReasons,
        comments,
      } satisfies JaVoiceReviewSummaryRow;
    })
    .sort((left, right) => {
      if (left.knockout !== right.knockout) {
        return left.knockout ? 1 : -1;
      }
      if (left.overallScore !== right.overallScore) {
        return right.overallScore - left.overallScore;
      }
      return right.roleFitAverage - left.roleFitAverage;
    });

  const outputDir = input.outputDir ?? JA_VOICE_REVIEW_SUMMARY_ROOT;
  const runId = basename(input.csvPath).replace(/\.csv$/i, "");
  const jsonPath = resolve(outputDir, `${runId}.json`);
  const csvPath = resolve(outputDir, `${runId}.csv`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(summaryRows, null, 2)}\n`, "utf8");
  await writeFile(csvPath, `${Papa.unparse(summaryRows)}\n`, "utf8");

  return {
    jsonPath,
    csvPath,
    rows: summaryRows,
  };
}

export async function writeJaVoiceVariationCohort(input: {
  cohort: VoiceVariationCohort;
  cohortPath?: string;
}) {
  const cohortPath = input.cohortPath ?? JA_VOICE_VARIATION_COHORT_PATH;
  await mkdir(dirname(cohortPath), { recursive: true });
  await writeFile(cohortPath, `${JSON.stringify(input.cohort, null, 2)}\n`, "utf8");
  return cohortPath;
}
