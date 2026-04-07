import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import XLSX from "xlsx";
import {
  ACCOUNTING_CORPUS_SOT_ID,
  ACCOUNTING_SCENARIO_FAMILY,
  ACCOUNTING_ACCEPTANCE_REFERENCE_ARTIFACT,
  ACCOUNTING_HUMAN_REFERENCE_MEMO,
  canonicalTranscriptSchema,
  corpusManifestSchema,
  transcriptSourceRecordSchema,
  type CanonicalTranscript,
  type CorpusManifest,
  type CorpusManifestEntry,
  type TranscriptSourceRecord,
} from "@top-performer/domain";

type SourceRow = Record<string, unknown>;

function hashOriginal(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function toArrayBufferPath(workbookPath: string) {
  return XLSX.readFile(workbookPath, { cellDates: false, dense: true });
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function timecodeToMs(input: string) {
  const [hh, mm, ss] = input.split(":").map((part) => Number(part));
  return ((hh ?? 0) * 3600 + (mm ?? 0) * 60 + (ss ?? 0)) * 1000;
}

function normalizeSourceRecord(
  workbookPath: string,
  sheetName: string,
  dataRow: number,
  row: SourceRow,
  importedAt: string
) {
  return transcriptSourceRecordSchema.parse({
    id: `sheet1_row_${dataRow}`,
    sourcePath: workbookPath,
    sheetName,
    dataRow,
    excelRow: dataRow + 1,
    executedAt: asString(row["実施日時"]),
    ownerName: asString(row["CA名/RA名"]),
    meetingType: asString(row["面談種別"]),
    companyOrCandidateName: asString(row["求職者名/企業名"]),
    title: asString(row["タイトル"]),
    transcriptText: asString(row["トランスクリプト"]),
    documentUrl: asString(row["ドキュメントURL"]),
    importedAt,
  });
}

export function loadWorkbookSourceRecords(input: {
  workbookPath: string;
  sheetName?: string;
  importedAt?: string;
}): TranscriptSourceRecord[] {
  const workbook = toArrayBufferPath(input.workbookPath);
  const sheetName = input.sheetName ?? workbook.SheetNames[0] ?? "シート1";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Worksheet not found: ${sheetName}`);
  }

  const importedAt = input.importedAt ?? new Date().toISOString();
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as SourceRow[];
  return rows
    .map((row, index) => ({
      row,
      index,
      transcriptText: asString(row["トランスクリプト"]),
    }))
    .filter((entry) => entry.transcriptText.length > 0)
    .map((entry) =>
      normalizeSourceRecord(
        input.workbookPath,
        sheetName,
        entry.index + 1,
        entry.row,
        importedAt
      )
    );
}

export async function loadCorpusManifestFromFile(path: string): Promise<CorpusManifest> {
  const contents = await readFile(path, "utf8");
  return corpusManifestSchema.parse(JSON.parse(contents));
}

export function buildDefaultAccountingCorpusManifest(input: {
  workbookPath: string;
  sheetName?: string;
  createdAt?: string;
}) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return corpusManifestSchema.parse({
    corpusId: ACCOUNTING_CORPUS_SOT_ID,
    family: ACCOUNTING_SCENARIO_FAMILY,
    sourcePath: input.workbookPath,
    sheetName: input.sheetName ?? "シート1",
    version: "enterprise_accounting_ap_gold_v1@2026-04-08.v1",
    createdAt,
    entries: [
      {
        sourceRecordId: "sheet1_row_67",
        transcriptId: "rx_japan_20260331",
        tier: "gold",
        reviewStatus: "approved",
        humanApproved: true,
        sellerLabelHints: ["RA", "CA", "鶴田", "齊藤"],
        clientLabelHints: ["池田", "様"],
      },
      {
        sourceRecordId: "sheet1_row_155",
        transcriptId: "ep_pharmaline_20260317",
        tier: "gold",
        reviewStatus: "approved",
        humanApproved: true,
        sellerLabelHints: ["RA", "CA", "鈴木"],
        clientLabelHints: ["安川", "様"],
      },
      {
        sourceRecordId: "sheet1_row_254",
        transcriptId: "tepco_realestate_20260304",
        tier: "gold",
        reviewStatus: "approved",
        humanApproved: true,
        sellerLabelHints: ["RA", "CA", "佐藤"],
        clientLabelHints: ["東電不動産", "様"],
      },
      {
        sourceRecordId: "sheet1_row_565",
        transcriptId: "mol_logistics_20260128",
        tier: "gold",
        reviewStatus: "approved",
        humanApproved: true,
        sellerLabelHints: ["RA", "CA", "藤田"],
        clientLabelHints: ["上田", "様"],
      },
      {
        sourceRecordId: "sheet1_row_610",
        transcriptId: "medirom_aoki",
        tier: "gold",
        reviewStatus: "approved",
        humanApproved: true,
        sellerLabelHints: ["RA", "CA", "松岡"],
        clientLabelHints: ["青木", "様"],
      },
      {
        sourceRecordId: "sheet1_row_2",
        transcriptId: "nihon_waso_20260407",
        tier: "gold",
        reviewStatus: "approved",
        humanApproved: true,
        sellerLabelHints: ["RA", "CA", "近藤"],
        clientLabelHints: ["柴崎", "様"],
      },
      {
        sourceRecordId: "sheet1_row_34",
        transcriptId: "tepco_realestate_20260403",
        tier: "silver",
        reviewStatus: "approved",
        humanApproved: true,
        sellerLabelHints: ["RA", "CA", "佐藤"],
        clientLabelHints: ["由野", "様"],
      },
      {
        sourceRecordId: "sheet1_row_475",
        transcriptId: "emplus_20260204",
        tier: "silver",
        reviewStatus: "approved",
        humanApproved: true,
        sellerLabelHints: ["RA", "CA", "鈴木"],
        clientLabelHints: ["中田", "様"],
      },
    ],
  });
}

function findSegments(transcriptText: string) {
  const timestampPattern = /\d{2}:\d{2}:\d{2}/g;
  const matches = [...transcriptText.matchAll(timestampPattern)];
  if (matches.length === 0) {
    return [];
  }

  return matches.map((match, index) => {
    const startedAt = match.index ?? 0;
    const endedAt =
      index + 1 < matches.length
        ? (matches[index + 1]?.index ?? transcriptText.length)
        : transcriptText.length;
    const timestamp = match[0];
    const rawSegment = transcriptText.slice(startedAt + timestamp.length, endedAt).trim();
    return { timestamp, rawSegment };
  });
}

function extractSpeakerAndText(rawSegment: string) {
  const cleaned = rawSegment
    .replace(/^[-~\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/^([^:]{1,40}):\s*(.+)$/);
  if (!match) {
    return {
      speakerLabel: "unknown",
      text: cleaned,
    };
  }

  return {
    speakerLabel: match[1]!.trim(),
    text: match[2]!.trim(),
  };
}

function resolveSpeakerRole(
  speakerLabel: string,
  manifestEntry: CorpusManifestEntry
): "seller" | "client" | "unknown" {
  const normalized = speakerLabel.toLowerCase();

  if (
    manifestEntry.sellerLabelHints.some((hint) => normalized.includes(hint.toLowerCase()))
  ) {
    return "seller";
  }
  if (
    manifestEntry.clientLabelHints.some((hint) => normalized.includes(hint.toLowerCase()))
  ) {
    return "client";
  }
  if (normalized.includes("ra") || normalized.includes("ca") || normalized.includes("営業")) {
    return "seller";
  }
  if (speakerLabel.includes("様") || speakerLabel.includes("上田") || speakerLabel.includes("池田")) {
    return "client";
  }
  return "unknown";
}

function buildAbstractedMeta(source: TranscriptSourceRecord) {
  const haystack = `${source.title}\n${source.transcriptText}`;
  const industry =
    haystack.includes("ファーマ")
      ? "製薬"
      : haystack.includes("不動産")
        ? "不動産"
        : haystack.includes("ロジスティクス") || haystack.includes("物流")
          ? "物流"
          : haystack.includes("和装")
            ? "小売"
            : haystack.includes("展示会") || haystack.includes("RX")
              ? "展示会運営"
              : haystack.includes("メディロム")
                ? "ヘルスケア"
                : undefined;

  const systemContext = [
    haystack.includes("Oracle") ? "Oracle" : "",
    haystack.includes("SAP") ? "SAP" : "",
    haystack.includes("Fusion") ? "Fusion" : "",
    haystack.includes("楽々精算") ? "楽々精算" : "",
    haystack.includes("ERP") ? "ERP" : "",
  ].filter(Boolean);

  const workflowCharacteristics = [
    haystack.includes("支払") ? "支払" : "",
    haystack.includes("AP") ? "AP" : "",
    haystack.includes("経費精算") ? "経費精算" : "",
    haystack.includes("固定資産") ? "固定資産" : "",
    haystack.includes("月次") ? "月次" : "",
    haystack.includes("請求書") ? "請求書処理" : "",
  ].filter(Boolean);

  const businessContext = [
    haystack.includes("グループ") ? "グループ会社運営" : "",
    haystack.includes("移行") ? "システム移行" : "",
    haystack.includes("内製") ? "内製強化" : "",
    haystack.includes("外注") || haystack.includes("アウトソーシング")
      ? "外部委託連携"
      : "",
  ].filter(Boolean);

  return {
    industry,
    companyScale:
      haystack.includes("大手") || haystack.includes("グループ")
        ? ("enterprise" as const)
        : ("unknown" as const),
    businessContext,
    systemContext,
    workflowCharacteristics,
  };
}

function redactText(
  input: string,
  speakerLabel: string,
  source: TranscriptSourceRecord
) {
  const redactions: CanonicalTranscript["turns"][number]["redactions"] = [];
  let text = input;

  const replacements = [
    {
      pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      type: "email" as const,
      replacement: "[REDACTED_EMAIL]",
    },
    {
      pattern: /https?:\/\/[^\s]+/gi,
      type: "url" as const,
      replacement: "[REDACTED_URL]",
    },
    {
      pattern: /\b(?:\+?81[-\s]?)?(?:0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})\b/g,
      type: "phone" as const,
      replacement: "[REDACTED_PHONE]",
    },
  ];

  for (const item of replacements) {
    text = text.replace(item.pattern, (match) => {
      redactions.push({
        type: item.type,
        originalHash: hashOriginal(match),
        replacement: item.replacement,
      });
      return item.replacement;
    });
  }

  for (const proper of [source.companyOrCandidateName, speakerLabel]) {
    if (!proper || proper === "unknown" || proper.length < 2) {
      continue;
    }
    if (text.includes(proper)) {
      const replacement = proper === speakerLabel ? "[REDACTED_PERSON]" : "[REDACTED_COMPANY]";
      text = text.split(proper).join(replacement);
      redactions.push({
        type: proper === speakerLabel ? "person" : "company",
        originalHash: hashOriginal(proper),
        replacement,
      });
    }
  }

  return {
    normalizedText: text.replace(/\s+/g, " ").trim(),
    redactions,
  };
}

function computeQuality(turnCount: number, unknownSpeakerRatio: number, sellerResolved: boolean, clientResolved: boolean) {
  const completenessScore = Math.min(1, turnCount / 18);
  const noiseScore = unknownSpeakerRatio > 0.2 ? 0.7 : unknownSpeakerRatio > 0.1 ? 0.4 : 0.15;
  const rejectReasons = [];
  if (!sellerResolved || !clientResolved) {
    rejectReasons.push("speaker_mapping_failed");
  }
  if (unknownSpeakerRatio > 0.2) {
    rejectReasons.push("unknown_ratio_too_high");
  }
  return {
    completenessScore,
    noiseScore,
    unknownSpeakerRatio,
    sellerResolved,
    clientResolved,
    usableForMvp: turnCount >= 4 && sellerResolved && clientResolved && unknownSpeakerRatio <= 0.2,
    speakerQuality:
      !sellerResolved || !clientResolved || unknownSpeakerRatio > 0.2
        ? ("reject" as const)
        : unknownSpeakerRatio > 0.1
          ? ("silver_only" as const)
          : ("gold_eligible" as const),
    rejectReasons,
  };
}

function tierRank(input: "gold" | "silver" | "reject") {
  return input === "gold" ? 2 : input === "silver" ? 1 : 0;
}

function minTier(left: "gold" | "silver" | "reject", right: "gold" | "silver" | "reject") {
  return tierRank(left) <= tierRank(right) ? left : right;
}

export function canonicalizeSourceRecord(
  source: TranscriptSourceRecord,
  manifestEntry: CorpusManifestEntry,
  corpusId: string
): CanonicalTranscript {
  const segments = findSegments(source.transcriptText);
  const speakerIds = new Map<string, string>();
  let nextSpeakerIndex = 1;

  const turns = segments
    .map(({ timestamp, rawSegment }, index) => {
      const { speakerLabel, text } = extractSpeakerAndText(rawSegment);
      if (!text) {
        return null;
      }
      const role = resolveSpeakerRole(speakerLabel, manifestEntry);
      const speakerId =
        speakerIds.get(speakerLabel) ??
        `spk_${String(nextSpeakerIndex++).padStart(2, "0")}`;
      speakerIds.set(speakerLabel, speakerId);
      const { normalizedText, redactions } = redactText(text, speakerLabel, source);
      return {
        turnId: `t_${String(index + 1).padStart(3, "0")}`,
        index,
        speakerId,
        speakerLabel,
        role,
        startedAtMs: timecodeToMs(timestamp),
        text,
        normalizedText,
        redactions,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const unknownSpeakerRatio =
    turns.length === 0
      ? 1
      : turns.filter((turn) => turn.role === "unknown").length / turns.length;
  const sellerResolved = turns.some((turn) => turn.role === "seller");
  const clientResolved = turns.some((turn) => turn.role === "client");
  const quality = computeQuality(
    turns.length,
    unknownSpeakerRatio,
    sellerResolved,
    clientResolved
  );

  const computedTier =
    !sellerResolved || !clientResolved || unknownSpeakerRatio > 0.2
      ? ("reject" as const)
      : unknownSpeakerRatio > 0.1
        ? ("silver" as const)
        : ("gold" as const);

  const qualityTier = minTier(manifestEntry.tier, computedTier);
  const participants = [...speakerIds.entries()].map(([label, speakerId]) => ({
    speakerId,
    label,
    role: resolveSpeakerRole(label, manifestEntry),
  }));

  return canonicalTranscriptSchema.parse({
    id: manifestEntry.transcriptId,
    sourceRecordId: source.id,
    corpusId,
    family: ACCOUNTING_SCENARIO_FAMILY,
    language: "ja",
    qualityTier,
    createdAt: source.executedAt || source.importedAt,
    importedAt: source.importedAt,
    redactVersion: "phase34-redact-v1",
    normalizationVersion: "phase34-normalize-v1",
    sourceMeta: {
      executedAt: source.executedAt,
      ownerName: source.ownerName,
      meetingType: source.meetingType,
      title: source.title,
      documentUrl: source.documentUrl,
    },
    abstractedMeta: buildAbstractedMeta(source),
    participants,
    turns,
    quality,
  });
}

export async function importCorpusFromWorkbook(input: {
  workbookPath: string;
  manifestPath?: string;
}) {
  const manifest = input.manifestPath
    ? await loadCorpusManifestFromFile(input.manifestPath)
    : buildDefaultAccountingCorpusManifest({
        workbookPath: input.workbookPath,
      });
  const sourceRecords = loadWorkbookSourceRecords({
    workbookPath: input.workbookPath,
    sheetName: manifest.sheetName,
  });
  const sourceRecordMap = new Map(sourceRecords.map((record) => [record.id, record]));

  const canonicalTranscripts = manifest.entries
    .filter((entry) => entry.tier !== "reject")
    .map((entry) => {
      const source = sourceRecordMap.get(entry.sourceRecordId);
      if (!source) {
        throw new Error(`Manifest entry ${entry.sourceRecordId} not found in workbook`);
      }
      return canonicalizeSourceRecord(source, entry, manifest.corpusId);
    });

  return {
    manifest,
    sourceRecords,
    canonicalTranscripts,
  };
}

export function renderCanonicalTranscriptReview(transcript: CanonicalTranscript) {
  return [
    `# ${transcript.id}`,
    "",
    `- corpusId: ${transcript.corpusId}`,
    `- qualityTier: ${transcript.qualityTier}`,
    `- speakerQuality: ${transcript.quality.speakerQuality}`,
    `- unknownSpeakerRatio: ${transcript.quality.unknownSpeakerRatio.toFixed(3)}`,
    `- usableForMvp: ${transcript.quality.usableForMvp}`,
    `- industry: ${transcript.abstractedMeta.industry ?? "unknown"}`,
    `- companyScale: ${transcript.abstractedMeta.companyScale}`,
    `- acceptanceReference: ${ACCOUNTING_ACCEPTANCE_REFERENCE_ARTIFACT}`,
    `- designMemo: ${ACCOUNTING_HUMAN_REFERENCE_MEMO}`,
    "",
    "## Turns",
    ...transcript.turns.map(
      (turn) =>
        `- ${turn.turnId} [${turn.role}] ${turn.normalizedText.slice(0, 160)}`
    ),
  ].join("\n");
}
