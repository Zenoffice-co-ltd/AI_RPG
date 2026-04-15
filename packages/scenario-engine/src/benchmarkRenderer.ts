import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import Papa from "papaparse";
import { z } from "zod";
import type {
  PronunciationDictionaryLocator,
  TextNormalisationType,
  VoiceSettings,
  VoiceVariationGender,
  VoiceVariationSource,
  VoiceVariationStage,
} from "@top-performer/domain";
import type { ElevenLabsClient } from "@top-performer/vendors";
import type { VoiceProfile } from "@top-performer/domain";
import {
  assertScenarioVoiceProfileAvailable,
  REPO_ROOT,
  VOICE_PROFILE_CONFIG_ROOT,
  loadVoiceProfile,
  resolveMappedVoiceProfile,
} from "./voiceProfiles";
import { normalizeJaTextForTts } from "./tts/jaTextNormalization";

const benchmarkUtteranceSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  utterance: z.string().min(1),
  containsNumber: z.boolean(),
  containsCompanyName: z.boolean(),
  containsRoleTitle: z.boolean(),
  containsLocation: z.boolean(),
  notes: z.string(),
});

export type BenchmarkUtterance = z.infer<typeof benchmarkUtteranceSchema>;

export type BenchmarkTarget = {
  source: "profile" | "raw";
  profileId?: string;
  label: string;
  language: "ja";
  modelId: string;
  voiceId: string;
  firstMessage?: string | undefined;
  textNormalisationType: TextNormalisationType;
  voiceSettings: VoiceSettings;
  pronunciationDictionaryLocators?: PronunciationDictionaryLocator[];
  candidateId?: string;
  candidateSource?: VoiceVariationSource;
  candidateGender?: VoiceVariationGender;
  voiceName?: string;
  controlGroup?: boolean;
  round?: string;
  lane?: string;
  stage?: VoiceVariationStage;
  notes?: string;
};

export type BenchmarkRenderRow = {
  runId: string;
  timestamp: string;
  scenarioId: string;
  targetLabel: string;
  profileId?: string;
  candidateId?: string;
  candidateSource?: VoiceVariationSource;
  candidateGender?: VoiceVariationGender;
  voiceName?: string;
  controlGroup?: boolean;
  round?: string;
  lane?: string;
  stage?: VoiceVariationStage;
  utteranceId: string;
  utterance: string;
  originalText: string;
  normalizedText: string;
  appliedRules: string[];
  category: string;
  model: string;
  requestedVoiceId: string;
  resolvedVoiceId: string;
  textNormalizationStrategy: TextNormalisationType;
  settingsSnapshot: VoiceSettings;
  pronunciationDictionaries?: PronunciationDictionaryLocator[];
  seed?: number;
  outputFile?: string;
  status: "success" | "failed";
  latencyMs?: number;
  error?: string;
};

export const VOICE_BENCHMARK_SOURCE_ROOT = resolve(
  REPO_ROOT,
  "data",
  "voice-benchmark"
);
export const VOICE_BENCHMARK_GENERATED_ROOT = resolve(
  REPO_ROOT,
  "data",
  "generated",
  "voice-benchmark"
);
export const DEFAULT_BENCHMARK_UTTERANCE_CSV = resolve(
  VOICE_BENCHMARK_SOURCE_ROOT,
  "utterances_ja.csv"
);
export const ACCOUNTING_BENCHMARK_UTTERANCE_CSV = resolve(
  VOICE_BENCHMARK_SOURCE_ROOT,
  "utterances_ja_accounting_clerk.csv"
);

function getDefaultBenchmarkUtteranceCsv(scenarioId: string) {
  return scenarioId === "accounting_clerk_enterprise_ap_busy_manager_medium"
    ? ACCOUNTING_BENCHMARK_UTTERANCE_CSV
    : DEFAULT_BENCHMARK_UTTERANCE_CSV;
}

function parseBooleanFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return ["true", "1", "yes", "y"].includes(normalized);
}

function sanitizeFileToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createRunId() {
  return `voice_benchmark_${new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-")}`;
}

export async function loadBenchmarkUtterances(
  utteranceCsvPath = DEFAULT_BENCHMARK_UTTERANCE_CSV
) {
  const contents = await readFile(utteranceCsvPath, "utf8");
  const parsed = Papa.parse<Record<string, string>>(contents, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(
      `Failed to parse benchmark utterance CSV ${utteranceCsvPath}: ${parsed.errors[0]?.message}`
    );
  }

  return parsed.data.map((row, index) =>
    benchmarkUtteranceSchema.parse({
      id: row["id"],
      category: row["category"],
      utterance: row["utterance"],
      containsNumber: parseBooleanFlag(row["contains_number"]),
      containsCompanyName: parseBooleanFlag(row["contains_company_name"]),
      containsRoleTitle: parseBooleanFlag(row["contains_role_title"]),
      containsLocation: parseBooleanFlag(row["contains_location"]),
      notes: row["notes"] ?? "",
    })
  );
}

export function buildReviewSheetCsv(rows: BenchmarkRenderRow[]) {
  return Papa.unparse(
    rows.map((row) => ({
      runId: row.runId,
      round: row.round ?? "",
      lane: row.lane ?? "",
      candidateId: row.candidateId ?? "",
      source: row.candidateSource ?? "",
      gender: row.candidateGender ?? "",
      profileId: row.profileId ?? "",
      targetLabel: row.targetLabel,
      utteranceId: row.utteranceId,
      category: row.category,
      utterance: row.utterance,
      originalText: row.originalText,
      normalizedText: row.normalizedText,
      appliedRules: row.appliedRules.join("|"),
      status: row.status,
      outputFile: row.outputFile ?? "",
      "自然さ": "",
      "滑らかさ": "",
      "訛り感の少なさ": "",
      "信頼感": "",
      "読みの正確さ": "",
      "電話口での聞きやすさ": "",
      "busy_manager適合度": "",
      "knockout理由": "",
      comments: "",
    }))
  );
}

export function buildSummaryCsv(rows: BenchmarkRenderRow[]) {
  return Papa.unparse(
    rows.map((row) => ({
      runId: row.runId,
      round: row.round ?? "",
      lane: row.lane ?? "",
      candidateId: row.candidateId ?? "",
      source: row.candidateSource ?? "",
      gender: row.candidateGender ?? "",
      targetLabel: row.targetLabel,
      profileId: row.profileId ?? "",
      utteranceId: row.utteranceId,
      category: row.category,
      status: row.status,
      originalText: row.originalText,
      normalizedText: row.normalizedText,
      appliedRules: row.appliedRules.join("|"),
      model: row.model,
      requestedVoiceId: row.requestedVoiceId,
      resolvedVoiceId: row.resolvedVoiceId,
      voiceName: row.voiceName ?? "",
      controlGroup: row.controlGroup ?? false,
      stage: row.stage ?? "",
      latencyMs: row.latencyMs ?? "",
      seed: row.seed ?? "",
      textNormalizationStrategy: row.textNormalizationStrategy,
      pronunciationDictionaries: row.pronunciationDictionaries
        ?.map(
          (locator) =>
            `${locator.pronunciationDictionaryId}:${locator.versionId}`
        )
        .join("|") ?? "",
      outputFile: row.outputFile ?? "",
      error: row.error ?? "",
    }))
  );
}

export function buildBenchmarkIndexHtml(args: {
  runId: string;
  scenarioId: string;
  outputDir: string;
  rows: BenchmarkRenderRow[];
}) {
  const byUtterance = new Map<string, BenchmarkRenderRow[]>();
  for (const row of args.rows) {
    const existing = byUtterance.get(row.utteranceId) ?? [];
    existing.push(row);
    byUtterance.set(row.utteranceId, existing);
  }

  const sections = [...byUtterance.values()]
    .sort((left, right) => left[0]!.utteranceId.localeCompare(right[0]!.utteranceId))
    .map((rows) => {
      const head = rows[0]!;
      const comparisons = rows
        .sort((left, right) => left.targetLabel.localeCompare(right.targetLabel))
        .map((row) => {
          const audioCell =
            row.status === "success" && row.outputFile
              ? `<audio controls preload="none" src="${escapeHtml(
                  relative(
                    args.outputDir,
                    row.outputFile
                  ).replaceAll("\\", "/")
                )}"></audio>`
              : `<span class="error">${escapeHtml(row.error ?? "render failed")}</span>`;

          return `<tr>
<td>${escapeHtml(row.targetLabel)}</td>
<td>${escapeHtml(row.candidateId ?? "")}</td>
<td>${escapeHtml(row.lane ?? "")}</td>
<td>${escapeHtml(row.model)}</td>
<td>${escapeHtml(row.resolvedVoiceId)}</td>
<td>${escapeHtml(JSON.stringify(row.settingsSnapshot))}</td>
<td>${audioCell}</td>
</tr>`;
        })
        .join("\n");

      return `<section class="utterance">
<h2>${escapeHtml(head.utteranceId)} <span>${escapeHtml(head.category)}</span></h2>
<p>${escapeHtml(head.utterance)}</p>
<table>
<thead>
<tr><th>Target</th><th>Candidate</th><th>Lane</th><th>Model</th><th>Voice</th><th>Settings</th><th>Audio</th></tr>
</thead>
<tbody>
${comparisons}
</tbody>
</table>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(args.runId)}</title>
<style>
body { font-family: "Segoe UI", sans-serif; margin: 24px; background: #f6f5ef; color: #1f2937; }
h1 { margin-bottom: 8px; }
section { background: white; border-radius: 16px; padding: 20px; margin-top: 20px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
h2 span { font-size: 0.8em; color: #6b7280; margin-left: 8px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { text-align: left; padding: 10px; border-top: 1px solid #e5e7eb; vertical-align: top; }
audio { width: 260px; }
.error { color: #b91c1c; font-weight: 600; }
</style>
</head>
<body>
<h1>${escapeHtml(args.runId)}</h1>
<p>scenario: ${escapeHtml(args.scenarioId)}</p>
${sections}
</body>
</html>`;
}

function createTargetFromProfile(profile: VoiceProfile): BenchmarkTarget {
  return {
    source: "profile",
    profileId: profile.id,
    label: profile.label,
    language: profile.language,
    modelId: profile.model,
    voiceId: profile.voiceId,
    textNormalisationType: profile.textNormalisationType,
    voiceSettings: profile.voiceSettings,
    ...(profile.firstMessageJa ? { firstMessage: profile.firstMessageJa } : {}),
    ...(profile.pronunciationDictionaryLocators
      ? {
          pronunciationDictionaryLocators:
            profile.pronunciationDictionaryLocators,
        }
      : {}),
    ...(profile.metadata?.candidateId
      ? { candidateId: profile.metadata.candidateId }
      : {}),
    ...(profile.metadata?.source
      ? { candidateSource: profile.metadata.source }
      : {}),
    ...(profile.metadata?.gender
      ? { candidateGender: profile.metadata.gender }
      : {}),
    ...(profile.metadata?.voiceName
      ? { voiceName: profile.metadata.voiceName }
      : {}),
    ...(profile.metadata?.controlGroup !== undefined
      ? { controlGroup: profile.metadata.controlGroup }
      : {}),
    ...(profile.metadata?.stage ? { stage: profile.metadata.stage } : {}),
    ...(profile.metadata?.notes ? { notes: profile.metadata.notes } : {}),
  };
}

export async function resolveBenchmarkTargets(input: {
  scenarioId: string;
  profileIds?: string[];
  targets?: BenchmarkTarget[];
  rawTarget?: BenchmarkTarget;
  configRoot?: string;
}) {
  const targets: BenchmarkTarget[] = [];
  const configRoot = input.configRoot ?? VOICE_PROFILE_CONFIG_ROOT;

  if (input.targets && input.targets.length > 0) {
    targets.push(...input.targets);
  }

  if (input.profileIds && input.profileIds.length > 0) {
    for (const profileId of input.profileIds) {
      targets.push(
        createTargetFromProfile(await loadVoiceProfile(profileId, configRoot))
      );
    }
  }

  if (targets.length === 0 && input.rawTarget) {
    targets.push(input.rawTarget);
  }

  if (targets.length === 0) {
    const mapped = assertScenarioVoiceProfileAvailable({
      scenarioId: input.scenarioId,
      purpose: "benchmark",
      profile: await resolveMappedVoiceProfile(
        input.scenarioId,
        configRoot,
        "benchmark"
      ),
    });
    if (mapped) {
      targets.push(createTargetFromProfile(mapped));
    }
  }

  if (targets.length === 0) {
    throw new Error(
      `No benchmark target was resolved for ${input.scenarioId}. Provide --profile or a raw --voice-id/--model pair.`
    );
  }

  return targets;
}

export async function writeVoiceInventoryReport(input: {
  elevenLabs: ElevenLabsClient;
  localePrefix?: string;
  outputDir?: string;
  query?: string;
}) {
  const localePrefix = input.localePrefix ?? "ja";
  const outputDir =
    input.outputDir ??
    resolve(VOICE_BENCHMARK_GENERATED_ROOT, "voices");
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const jsonPath = resolve(outputDir, `${timestamp}.json`);
  const csvPath = resolve(outputDir, `${timestamp}.csv`);
  const voices = await input.elevenLabs.listVoices(
    input.query ? { query: input.query } : undefined
  );

  const rows = voices
    .map((voice) => {
      const verifiedLanguages =
        voice.verified_languages
          ?.map((entry) => entry.locale ?? entry.language ?? "")
          .filter(Boolean)
          .join("|") ?? "";
      const shortlistTag = verifiedLanguages
        .toLowerCase()
        .includes(localePrefix.toLowerCase())
        ? "candidate"
        : "";

      return {
        voiceId: voice.voice_id,
        name: voice.name,
        category: voice.category ?? "",
        labels:
          Object.entries(voice.labels ?? {})
            .map(([key, value]) => `${key}=${value}`)
            .join("|") ?? "",
        description: voice.description ?? "",
        createdAt:
          voice.created_at_unix !== undefined && voice.created_at_unix !== null
            ? new Date(voice.created_at_unix * 1000).toISOString()
            : "",
        verifiedLanguages,
        notes: "",
        shortlistTag,
      };
    })
    .sort((left, right) => {
      if (left.shortlistTag !== right.shortlistTag) {
        return left.shortlistTag === "candidate" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  await writeFile(csvPath, `${Papa.unparse(rows)}\n`, "utf8");

  return {
    localePrefix,
    count: rows.length,
    jsonPath,
    csvPath,
  };
}

export async function renderVoiceBenchmark(input: {
  elevenLabs: ElevenLabsClient;
  scenarioId: string;
  profileIds?: string[];
  targets?: BenchmarkTarget[];
  rawTarget?: BenchmarkTarget;
  outputDir?: string;
  utteranceCsvPath?: string;
  seed?: number;
  configRoot?: string;
}) {
  const runId = createRunId();
  const outputDir =
    input.outputDir ?? resolve(VOICE_BENCHMARK_GENERATED_ROOT, runId);
  const audioDir = resolve(outputDir, "audio");
  const utteranceCsvPath =
    input.utteranceCsvPath ?? getDefaultBenchmarkUtteranceCsv(input.scenarioId);
  const utterances = await loadBenchmarkUtterances(utteranceCsvPath);
  const targets = await resolveBenchmarkTargets({
    scenarioId: input.scenarioId,
    ...(input.profileIds ? { profileIds: input.profileIds } : {}),
    ...(input.targets ? { targets: input.targets } : {}),
    ...(input.rawTarget ? { rawTarget: input.rawTarget } : {}),
    ...(input.configRoot ? { configRoot: input.configRoot } : {}),
  });

  await mkdir(audioDir, { recursive: true });

  const rows: BenchmarkRenderRow[] = [];
  for (const target of targets) {
    const resolvedVoice = await input.elevenLabs.resolveVoiceId(
      target.voiceId,
      target.language
    );

    for (const utterance of utterances) {
      const timestamp = new Date().toISOString();
      const audioFileName = `${sanitizeFileToken(
        target.profileId ?? target.label
      )}__${sanitizeFileToken(utterance.id)}.mp3`;
      const outputFile = resolve(audioDir, audioFileName);
      const normalized = normalizeJaTextForTts({
        text: utterance.utterance,
        scenarioId: input.scenarioId,
        ttsModel: target.modelId,
        textNormalisationType: target.textNormalisationType,
      });

      try {
        const rendered = await input.elevenLabs.renderSpeech({
          text: normalized.ttsText,
          modelId: target.modelId,
          voiceId: resolvedVoice.voiceId,
          languageCode: target.language,
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
          textNormalisationType: target.textNormalisationType,
          voiceSettings: target.voiceSettings,
          ...(target.pronunciationDictionaryLocators
            ? {
                pronunciationDictionaryLocators:
                  target.pronunciationDictionaryLocators,
              }
            : {}),
        });

        await writeFile(outputFile, rendered.audio);
        rows.push({
          runId,
          timestamp,
          scenarioId: input.scenarioId,
          targetLabel: target.label,
          ...(target.profileId ? { profileId: target.profileId } : {}),
          ...(target.candidateId ? { candidateId: target.candidateId } : {}),
          ...(target.candidateSource
            ? { candidateSource: target.candidateSource }
            : {}),
          ...(target.candidateGender
            ? { candidateGender: target.candidateGender }
            : {}),
          ...(target.voiceName ?? resolvedVoice.voiceName
            ? { voiceName: target.voiceName ?? resolvedVoice.voiceName }
            : {}),
          ...(target.controlGroup !== undefined
            ? { controlGroup: target.controlGroup }
            : {}),
          ...(target.round ? { round: target.round } : {}),
          ...(target.lane ? { lane: target.lane } : {}),
          ...(target.stage ? { stage: target.stage } : {}),
          utteranceId: utterance.id,
          utterance: utterance.utterance,
          originalText: normalized.displayText,
          normalizedText: normalized.ttsText,
          appliedRules: normalized.appliedRules,
          category: utterance.category,
          model: target.modelId,
          requestedVoiceId: target.voiceId,
          resolvedVoiceId: resolvedVoice.voiceId,
          textNormalizationStrategy: target.textNormalisationType,
          settingsSnapshot: target.voiceSettings,
          ...(target.pronunciationDictionaryLocators
            ? {
                pronunciationDictionaries:
                  target.pronunciationDictionaryLocators,
              }
            : {}),
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
          outputFile,
          status: "success",
          latencyMs: rendered.latencyMs,
        });
      } catch (error) {
        rows.push({
          runId,
          timestamp,
          scenarioId: input.scenarioId,
          targetLabel: target.label,
          ...(target.profileId ? { profileId: target.profileId } : {}),
          ...(target.candidateId ? { candidateId: target.candidateId } : {}),
          ...(target.candidateSource
            ? { candidateSource: target.candidateSource }
            : {}),
          ...(target.candidateGender
            ? { candidateGender: target.candidateGender }
            : {}),
          ...(target.voiceName ?? resolvedVoice.voiceName
            ? { voiceName: target.voiceName ?? resolvedVoice.voiceName }
            : {}),
          ...(target.controlGroup !== undefined
            ? { controlGroup: target.controlGroup }
            : {}),
          ...(target.round ? { round: target.round } : {}),
          ...(target.lane ? { lane: target.lane } : {}),
          ...(target.stage ? { stage: target.stage } : {}),
          utteranceId: utterance.id,
          utterance: utterance.utterance,
          originalText: normalized.displayText,
          normalizedText: normalized.ttsText,
          appliedRules: normalized.appliedRules,
          category: utterance.category,
          model: target.modelId,
          requestedVoiceId: target.voiceId,
          resolvedVoiceId: resolvedVoice.voiceId,
          textNormalizationStrategy: target.textNormalisationType,
          settingsSnapshot: target.voiceSettings,
          ...(target.pronunciationDictionaryLocators
            ? {
                pronunciationDictionaries:
                  target.pronunciationDictionaryLocators,
              }
            : {}),
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  const manifest = {
    runId,
    timestamp: new Date().toISOString(),
    scenarioId: input.scenarioId,
    utteranceCsvPath,
    outputDir,
    targets: targets.map((target) => ({
      source: target.source,
      profileId: target.profileId,
      label: target.label,
      language: target.language,
      model: target.modelId,
      voiceId: target.voiceId,
      candidateId: target.candidateId,
      candidateSource: target.candidateSource,
      candidateGender: target.candidateGender,
      voiceName: target.voiceName,
      controlGroup: target.controlGroup,
      round: target.round,
      lane: target.lane,
      stage: target.stage,
      notes: target.notes,
      firstMessage: target.firstMessage,
      textNormalisationType: target.textNormalisationType,
      voiceSettings: target.voiceSettings,
      pronunciationDictionaryLocators:
        target.pronunciationDictionaryLocators,
    })),
    results: rows,
  };

  const manifestPath = resolve(outputDir, "manifest.json");
  const summaryCsvPath = resolve(outputDir, "summary.csv");
  const reviewSheetPath = resolve(outputDir, "review-sheet.csv");
  const indexPath = resolve(outputDir, "index.html");

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(summaryCsvPath, `${buildSummaryCsv(rows)}\n`, "utf8");
  await writeFile(reviewSheetPath, `${buildReviewSheetCsv(rows)}\n`, "utf8");
  await writeFile(
    indexPath,
    buildBenchmarkIndexHtml({
      runId: basename(outputDir),
      scenarioId: input.scenarioId,
      outputDir,
      rows,
    }),
    "utf8"
  );

  return {
    runId,
    outputDir,
    manifestPath,
    summaryCsvPath,
    reviewSheetPath,
    indexPath,
    total: rows.length,
    failed: rows.filter((row) => row.status === "failed").length,
  };
}

export type RenderVoiceBenchmarkResult = Awaited<
  ReturnType<typeof renderVoiceBenchmark>
>;
