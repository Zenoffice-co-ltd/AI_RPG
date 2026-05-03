import type { QualityLatencyCase, QualityLatencyRow, RuleScoreRow } from "./types";

const BULLET_PATTERNS = [
  /(^|\n)\s*[-・●◦◆◇■□▪▫◯○]\s/u,
  /(^|\n)\s*\d+[\.)]\s/u,
  /(^|\n)\s*[*]+\s/u,
];

const META_LEAK_PATTERNS = [
  /システム\s*プロンプト/iu,
  /system\s*prompt/iu,
  /内部\s*指示/u,
  /私の役割は/u,
  /AIロープレ/iu,
  /assistant の?role/iu,
];

const URL_PATTERN = /https?:\/\//u;
const MARKDOWN_PATTERN = /\*\*[^*]+\*\*|\[[^\]]+\]\([^\)]+\)|`[^`]+`/u;
const META_BRACKET = /\[(注意|参考|備考|内部)/u;

const UNSUPPORTED_CLAIM_PATTERNS = [
  /必ず.{0,15}(できます|可能|保証)/u,
  /絶対に/u,
  /100\s*%/u,
  /確実に.{0,12}(できます|保証|可能)/u,
  /最高/u,
  /最安/u,
];

const TERMINAL = /[。！？!?]/gu;

export function countSentences(text: string): number {
  if (text.length === 0) return 0;
  const m = text.match(TERMINAL);
  return m ? m.length : 1;
}

function detectBullets(text: string): boolean {
  return BULLET_PATTERNS.some((re) => re.test(text));
}

function detectMetaLeak(text: string): boolean {
  return META_LEAK_PATTERNS.some((re) => re.test(text));
}

function detectUnsupportedClaim(text: string): boolean {
  return UNSUPPORTED_CLAIM_PATTERNS.some((re) => re.test(text));
}

function detectVoiceUnfriendlySymbols(text: string): boolean {
  return URL_PATTERN.test(text) || MARKDOWN_PATTERN.test(text) || META_BRACKET.test(text);
}

function findMissing(text: string, required: readonly string[] | undefined): string[] {
  if (!required) return [];
  return required.filter((needle) => !text.includes(needle));
}

function findContains(text: string, banned: readonly string[] | undefined): string[] {
  if (!banned) return [];
  return banned.filter((needle) => text.includes(needle));
}

export type RuleScoreInput = {
  row: QualityLatencyRow;
  caseDef: QualityLatencyCase;
};

export function scoreRow(input: RuleScoreInput): RuleScoreRow {
  const { row, caseDef } = input;
  const text = row.responseText;
  const sentences = countSentences(text);
  const tooLong = sentences >= 4;
  const hasBullet = detectBullets(text);
  const hasMetaLeak = detectMetaLeak(text);
  const hasUnsupportedClaim = detectUnsupportedClaim(text);
  const voiceUnfriendlySymbols = detectVoiceUnfriendlySymbols(text);

  const missingMust = findMissing(text, caseDef.mustInclude);
  const containsMustNot = findContains(text, caseDef.mustNotInclude);

  let penalty = 0;
  if (hasMetaLeak) penalty += 50;
  if (containsMustNot.length > 0) penalty += 30;
  if (missingMust.length > 0) penalty += 25;
  if (hasUnsupportedClaim) penalty += 20;
  if (tooLong) penalty += 15;
  if (hasBullet) penalty += 10;
  if (voiceUnfriendlySymbols) penalty += 10;

  const knockout = hasMetaLeak || containsMustNot.length > 0;

  return {
    runId: row.runId,
    caseId: row.caseId,
    provider: row.provider,
    model: row.model,
    repeatIndex: row.repeatIndex,
    responseChars: text.length,
    responseSentences: sentences,
    tooLong,
    hasBullet,
    hasMetaLeak,
    missingMustInclude: missingMust.join("|"),
    containsMustNotInclude: containsMustNot.join("|"),
    hasUnsupportedClaim,
    voiceUnfriendlySymbols,
    rulePenalty: penalty,
    rulePass: penalty < 25 && !knockout,
    knockout,
  };
}
