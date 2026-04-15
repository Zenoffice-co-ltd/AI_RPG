import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNTING_SCENARIO_FAMILY,
  type TextNormalisationType,
} from "@top-performer/domain";

type PronunciationLexeme = {
  grapheme: string;
  alias: string;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(currentDir, "../../../..");

const LOCAL_PRONUNCIATION_LEXICONS: Record<string, string> = {
  staffing_order_hearing: resolve(
    REPO_ROOT,
    "data",
    "pronunciation",
    "adecco-ja-business-v1.pls"
  ),
  [ACCOUNTING_SCENARIO_FAMILY]: resolve(
    REPO_ROOT,
    "data",
    "pronunciation",
    "adecco-ja-accounting-v1.pls"
  ),
};

const pronunciationLexiconCache = new Map<string, Promise<PronunciationLexeme[]>>();

function getScenarioFamilyFromId(scenarioId: string) {
  const delimiterIndex = scenarioId.lastIndexOf("_busy_manager_medium");
  if (delimiterIndex > 0) {
    return scenarioId.slice(0, delimiterIndex);
  }

  return scenarioId.split("_").slice(0, -2).join("_");
}

async function loadPronunciationLexemes(path: string) {
  const cached = pronunciationLexiconCache.get(path);
  if (cached) {
    return cached;
  }

  const pending = readFile(path, "utf8").then((contents) => {
    const matches = contents.matchAll(
      /<lexeme>\s*<grapheme>([^<]+)<\/grapheme>\s*<alias>([^<]+)<\/alias>\s*<\/lexeme>/g
    );

    return [...matches].map((match) => ({
      grapheme: match[1]!.trim(),
      alias: match[2]!.trim(),
    }));
  });

  pronunciationLexiconCache.set(path, pending);
  return pending;
}

export async function buildLivePronunciationGuide(input: {
  scenarioId: string;
  textNormalisationType?: TextNormalisationType;
  referenceTexts: string[];
  maxEntries?: number;
}) {
  if (input.textNormalisationType !== "system_prompt") {
    return "";
  }

  const family = getScenarioFamilyFromId(input.scenarioId);
  const lexiconPath = LOCAL_PRONUNCIATION_LEXICONS[family];
  if (!lexiconPath) {
    return "";
  }

  const joinedText = input.referenceTexts.join("\n");
  const lexemes = await loadPronunciationLexemes(lexiconPath);
  const matchedLexemes = lexemes
    .filter((lexeme) => joinedText.includes(lexeme.grapheme))
    .slice(0, input.maxEntries ?? 12);

  if (matchedLexemes.length === 0) {
    return "";
  }

  const lines = matchedLexemes.map(
    (lexeme) => `- 「${lexeme.grapheme}」は「${lexeme.alias}」の読みを優先する`
  );

  return [
    "# Pronunciation Guide",
    "日本語で音声化するときは、以下の読みを優先してください。",
    ...lines,
    "略語やスラッシュ区切りの表現は、自然な区切りで読み上げてください。",
  ].join("\n");
}
