export type FirstSentenceMatch = {
  text: string;
  endIndex: number;
};

const TERMINAL_PUNCTUATION = ["。", "？", "！", "?", "!"];
const COMMA = "、";
const MIN_FIRST_SENTENCE_LENGTH = 5;
const COMMA_FALLBACK_MIN_LENGTH = 40;

function findEarliestTerminal(text: string): number {
  let earliest = -1;
  for (const mark of TERMINAL_PUNCTUATION) {
    const idx = text.indexOf(mark);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
    }
  }
  return earliest;
}

function findCommaBoundary(text: string): number {
  if (text.length < COMMA_FALLBACK_MIN_LENGTH) {
    return -1;
  }
  return text.lastIndexOf(COMMA);
}

export function detectFirstSentence(accumulated: string): FirstSentenceMatch | null {
  if (accumulated.length === 0) {
    return null;
  }

  const terminalIdx = findEarliestTerminal(accumulated);
  if (terminalIdx !== -1) {
    const candidate = accumulated.slice(0, terminalIdx + 1).trim();
    if (candidate.length >= MIN_FIRST_SENTENCE_LENGTH) {
      return { text: candidate, endIndex: terminalIdx + 1 };
    }
    const remaining = accumulated.slice(terminalIdx + 1);
    const next = detectFirstSentence(remaining);
    if (next) {
      const offset = terminalIdx + 1;
      return {
        text: `${candidate}${next.text}`.trim(),
        endIndex: offset + next.endIndex,
      };
    }
    return null;
  }

  const commaIdx = findCommaBoundary(accumulated);
  if (commaIdx !== -1) {
    const candidate = accumulated.slice(0, commaIdx + 1).trim();
    if (candidate.length >= MIN_FIRST_SENTENCE_LENGTH) {
      return { text: candidate, endIndex: commaIdx + 1 };
    }
  }

  return null;
}

export function countSentences(text: string): number {
  if (text.length === 0) return 0;
  let count = 0;
  for (const char of text) {
    if (TERMINAL_PUNCTUATION.includes(char)) {
      count += 1;
    }
  }
  return Math.max(count, 1);
}
