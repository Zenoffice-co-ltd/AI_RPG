import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { transcriptRecordSchema, type TranscriptRecord } from "@top-performer/domain";
import Papa from "papaparse";

type RawTurn = {
  speaker?: string;
  role?: string;
  text?: string;
  message?: string;
  transcript?: string;
  timestampSec?: number | string;
  timestamp?: number | string;
  transcriptId?: string;
};

export type NormalizeTranscriptOptions = {
  companyAliasMap?: Record<string, string>;
  importedAt?: string;
};

const SPEAKER_ALIASES: Record<string, "sales" | "client"> = {
  sales: "sales",
  seller: "sales",
  rep: "sales",
  recruiter: "sales",
  agent: "sales",
  staffing: "sales",
  client: "client",
  customer: "client",
  contact: "client",
  employer: "client",
  manager: "client",
};

function normalizeSpeaker(input?: string) {
  if (!input) {
    return "client" as const;
  }

  const normalized = input.trim().toLowerCase();
  return SPEAKER_ALIASES[normalized] ?? (normalized.includes("sales") ? "sales" : "client");
}

function redactText(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/https?:\/\/[^\s]+/gi, "[REDACTED_URL]")
    .replace(/\b(?:\+?81[-\s]?)?(?:0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})\b/g, "[REDACTED_PHONE]");
}

function replaceCompanyAliases(text: string, aliasMap?: Record<string, string>) {
  if (!aliasMap) {
    return text;
  }

  return Object.entries(aliasMap).reduce(
    (current, [source, alias]) => current.replaceAll(source, alias),
    text
  );
}

function normalizeTurns(
  turns: RawTurn[],
  companyAliasMap?: Record<string, string>
) {
  const merged: Array<{
    speaker: "sales" | "client";
    text: string;
    timestampSec?: number;
  }> = [];

  for (const rawTurn of turns) {
    const text = (rawTurn.text ?? rawTurn.message ?? rawTurn.transcript ?? "").trim();
    if (!text) {
      continue;
    }

    const normalizedSpeaker = normalizeSpeaker(rawTurn.speaker ?? rawTurn.role);
    const normalizedText = replaceCompanyAliases(
      redactText(text),
      companyAliasMap
    );
    const timestampValue = rawTurn.timestampSec ?? rawTurn.timestamp;
    const timestampSec =
      typeof timestampValue === "number"
        ? timestampValue
        : typeof timestampValue === "string" && timestampValue.length > 0
          ? Number(timestampValue)
          : undefined;

    const previous = merged.at(-1);
    if (previous && previous.speaker === normalizedSpeaker) {
      previous.text = `${previous.text}\n${normalizedText}`;
      if (previous.timestampSec === undefined && timestampSec !== undefined) {
        previous.timestampSec = timestampSec;
      }
      continue;
    }

    merged.push({
      speaker: normalizedSpeaker,
      text: normalizedText,
      ...(timestampSec !== undefined ? { timestampSec } : {}),
    });
  }

  return merged.map((turn, index) => ({
    turnId: `t_${String(index + 1).padStart(3, "0")}`,
    speaker: turn.speaker,
    text: turn.text,
    ...(turn.timestampSec !== undefined ? { timestampSec: turn.timestampSec } : {}),
  }));
}

function createTranscriptId(sourceFile: string, suffix = "") {
  const digest = createHash("sha1").update(`${sourceFile}:${suffix}`).digest("hex");
  return `tr_${digest.slice(0, 12)}`;
}

function normalizeTranscriptRecord(
  sourceFile: string,
  turns: RawTurn[],
  options: NormalizeTranscriptOptions
): TranscriptRecord {
  return transcriptRecordSchema.parse({
    id: createTranscriptId(sourceFile),
    sourceFile,
    family: "staffing_order_hearing",
    performanceTier: "top",
    language: "ja",
    metadata: {},
    turns: normalizeTurns(turns, options.companyAliasMap),
    importedAt: options.importedAt ?? new Date().toISOString(),
    redactionStatus: "redacted",
  });
}

function parseJsonFile(
  sourceFile: string,
  contents: string,
  options: NormalizeTranscriptOptions
): TranscriptRecord[] {
  const parsed = JSON.parse(contents) as unknown;

  if (Array.isArray(parsed)) {
    if (parsed.every((item) => typeof item === "object" && item && "turns" in item)) {
      return parsed.map((item, index) =>
        normalizeTranscriptRecord(
          `${sourceFile}#${index}`,
          (item as { turns: RawTurn[] }).turns,
          options
        )
      );
    }

    return [normalizeTranscriptRecord(sourceFile, parsed as RawTurn[], options)];
  }

  if (
    typeof parsed === "object" &&
    parsed &&
    "transcripts" in parsed &&
    Array.isArray((parsed as { transcripts: unknown[] }).transcripts)
  ) {
    return (parsed as { transcripts: Array<{ turns: RawTurn[] }> }).transcripts.map(
      (transcript, index) =>
        normalizeTranscriptRecord(
          `${sourceFile}#${index}`,
          transcript.turns,
          options
        )
    );
  }

  if (
    typeof parsed === "object" &&
    parsed &&
    "turns" in parsed &&
    Array.isArray((parsed as { turns: unknown[] }).turns)
  ) {
    return [
      normalizeTranscriptRecord(
        sourceFile,
        (parsed as { turns: RawTurn[] }).turns,
        options
      ),
    ];
  }

  throw new Error(`Unsupported JSON transcript format for ${sourceFile}`);
}

function parseJsonLinesFile(
  sourceFile: string,
  contents: string,
  options: NormalizeTranscriptOptions
): TranscriptRecord[] {
  const rows = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RawTurn | { turns: RawTurn[] });

  if (rows.every((row) => "turns" in row)) {
    return rows.map((row, index) =>
      normalizeTranscriptRecord(
        `${sourceFile}#${index}`,
        (row as { turns: RawTurn[] }).turns,
        options
      )
    );
  }

  const grouped = new Map<string, RawTurn[]>();
  for (const row of rows as RawTurn[]) {
    const transcriptId = row.transcriptId ?? sourceFile;
    grouped.set(transcriptId, [...(grouped.get(transcriptId) ?? []), row]);
  }

  return [...grouped.entries()].map(([transcriptId, turns]) =>
    normalizeTranscriptRecord(transcriptId, turns, options)
  );
}

function parseCsvFile(
  sourceFile: string,
  contents: string,
  options: NormalizeTranscriptOptions
): TranscriptRecord[] {
  const result = Papa.parse<RawTurn>(contents, {
    header: true,
    skipEmptyLines: true,
  });

  const grouped = new Map<string, RawTurn[]>();
  for (const row of result.data) {
    const transcriptId = row.transcriptId ?? basename(sourceFile, extname(sourceFile));
    grouped.set(transcriptId, [...(grouped.get(transcriptId) ?? []), row]);
  }

  return [...grouped.entries()].map(([transcriptId, turns], index) =>
    transcriptRecordSchema.parse({
      ...normalizeTranscriptRecord(`${sourceFile}#${transcriptId}`, turns, options),
      id: createTranscriptId(sourceFile, `${transcriptId}:${index}`),
    })
  );
}

export async function importTranscriptsFromDirectory(
  directoryPath: string,
  options: NormalizeTranscriptOptions = {}
) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const transcripts: TranscriptRecord[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await importTranscriptsFromDirectory(
        resolve(directoryPath, entry.name),
        options
      );
      transcripts.push(...nested);
      continue;
    }

    const filePath = resolve(directoryPath, entry.name);
    const ext = extname(entry.name).toLowerCase();
    const contents = await readFile(filePath, "utf8");

    if (ext === ".json") {
      transcripts.push(...parseJsonFile(filePath, contents, options));
    } else if (ext === ".jsonl") {
      transcripts.push(...parseJsonLinesFile(filePath, contents, options));
    } else if (ext === ".csv") {
      transcripts.push(...parseCsvFile(filePath, contents, options));
    }
  }

  return transcripts;
}
