import {
  AGGREGATE_PLAYBOOK_PROMPT_VERSION,
  DEFAULT_ANTI_PATTERNS,
  DEFAULT_TAXONOMY_LABELS,
  DEFAULT_WINNING_MOVES,
  RECOMMENDED_ITEM_THRESHOLD,
  REQUIRED_ITEM_THRESHOLD,
  type PlaybookNorms,
  type TaxonomyKey,
  type TranscriptBehaviorExtraction,
  type TranscriptRecord,
} from "@top-performer/domain";

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
  }
  return sorted[midpoint]!;
}

function frequency(count: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return Number((count / total).toFixed(4));
}

function lookupTurnIndex(transcript: TranscriptRecord, turnId: string) {
  return transcript.turns.findIndex((turn) => turn.turnId === turnId);
}

export function aggregatePlaybook(input: {
  family: "staffing_order_hearing";
  transcripts: TranscriptRecord[];
  extractions: TranscriptBehaviorExtraction[];
  generatedAt?: string;
}): PlaybookNorms {
  const transcriptMap = new Map(
    input.transcripts.map((transcript) => [transcript.id, transcript])
  );
  const total = input.extractions.length;
  const itemStats = new Map<
    TaxonomyKey,
    {
      transcriptIds: string[];
      firstTurnIndices: number[];
      depthScores: number[];
    }
  >();

  for (const extraction of input.extractions) {
    const transcript = transcriptMap.get(extraction.transcriptId);
    if (!transcript) {
      continue;
    }

    for (const item of extraction.capturedItems) {
      const stat = itemStats.get(item.key) ?? {
        transcriptIds: [],
        firstTurnIndices: [],
        depthScores: [],
      };

      stat.transcriptIds.push(extraction.transcriptId);
      stat.depthScores.push(item.depthScore);
      stat.firstTurnIndices.push(lookupTurnIndex(transcript, item.firstTurnId));
      itemStats.set(item.key, stat);
    }
  }

  const requiredItems = [...itemStats.entries()]
    .map(([key, stat]) => ({
      key,
      label: DEFAULT_TAXONOMY_LABELS[key],
      frequency: frequency(stat.transcriptIds.length, total),
      medianFirstTurnIndex: Math.round(median(stat.firstTurnIndices)),
      targetDepthMedian: median(stat.depthScores),
      evidenceTranscriptIds: [...new Set(stat.transcriptIds)],
    }))
    .filter((item) => item.frequency >= REQUIRED_ITEM_THRESHOLD)
    .sort((left, right) => left.medianFirstTurnIndex - right.medianFirstTurnIndex);

  const recommendedItems = [...itemStats.entries()]
    .map(([key, stat]) => ({
      key,
      label: DEFAULT_TAXONOMY_LABELS[key],
      frequency: frequency(stat.transcriptIds.length, total),
      medianFirstTurnIndex: Math.round(median(stat.firstTurnIndices)),
    }))
    .filter(
      (item) =>
        item.frequency >= RECOMMENDED_ITEM_THRESHOLD &&
        item.frequency < REQUIRED_ITEM_THRESHOLD
    )
    .sort((left, right) => left.medianFirstTurnIndex - right.medianFirstTurnIndex);

  const winningMoveCounts = new Map<string, number>();
  const antiPatternCounts = new Map<string, number>();

  for (const extraction of input.extractions) {
    for (const move of extraction.winningMoves) {
      winningMoveCounts.set(move.key, (winningMoveCounts.get(move.key) ?? 0) + 1);
    }
    for (const antiPattern of extraction.antiPatterns) {
      antiPatternCounts.set(
        antiPattern.key,
        (antiPatternCounts.get(antiPattern.key) ?? 0) + 1
      );
    }
  }

  const winningMoves = [...winningMoveCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([key, count]) => {
      const fallback = DEFAULT_WINNING_MOVES.find((move) => move.key === key);
      return {
        key,
        label: fallback?.label ?? key.replaceAll("_", " "),
        description: fallback?.description ?? "高頻度で再現された有効な進め方。",
        frequency: frequency(count, total),
      };
    });

  const antiPatterns = [...antiPatternCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([key]) => {
      const fallback = DEFAULT_ANTI_PATTERNS.find((item) => item.key === key);
      return {
        key,
        label: fallback?.label ?? key.replaceAll("_", " "),
        description: fallback?.description ?? "会話品質を落とす再現的な失点パターン。",
      };
    });

  const canonicalOrder = [...requiredItems, ...recommendedItems]
    .sort((left, right) => left.medianFirstTurnIndex - right.medianFirstTurnIndex)
    .map((item) => item.key);

  return {
    version: `pb_${new Date().toISOString().slice(0, 10).replaceAll("-", "_")}_v1`,
    family: input.family,
    taxonomyVersion: AGGREGATE_PLAYBOOK_PROMPT_VERSION,
    requiredItems,
    recommendedItems,
    winningMoves,
    antiPatterns,
    canonicalOrder,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
