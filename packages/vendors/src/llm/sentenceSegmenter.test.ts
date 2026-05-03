import { describe, expect, it } from "vitest";
import { countSentences, detectFirstSentence } from "./sentenceSegmenter";

describe("detectFirstSentence", () => {
  it("returns null for empty input", () => {
    expect(detectFirstSentence("")).toBeNull();
  });

  it("returns null when no terminal punctuation and short text", () => {
    expect(detectFirstSentence("こんにちは")).toBeNull();
  });

  it("detects a complete sentence ending with 。", () => {
    const result = detectFirstSentence("はい、お願いします。続きの文も書きます。");
    expect(result).not.toBeNull();
    expect(result?.text).toBe("はい、お願いします。");
    expect(result?.endIndex).toBe("はい、お願いします。".length);
  });

  it("detects a sentence ending with ？", () => {
    const result = detectFirstSentence("本当ですか？追加の情報も必要です。");
    expect(result?.text).toBe("本当ですか？");
  });

  it("detects a sentence ending with ！", () => {
    const result = detectFirstSentence("素晴らしいですね！次の質問は何でしょう。");
    expect(result?.text).toBe("素晴らしいですね！");
  });

  it("does not treat 5文字未満の相槌 as first sentence and tries the next sentence", () => {
    const result = detectFirstSentence("はい。少し詳しく教えてください。");
    expect(result?.text).toBe("はい。少し詳しく教えてください。");
  });

  it("returns null when only a too-short ack exists and no further sentence", () => {
    expect(detectFirstSentence("はい。")).toBeNull();
  });

  it("falls back to 読点「、」 only when text reaches 40 chars", () => {
    const long = "条件を整理させていただくと、開始日は5月12日からスタートで、できれば3名のスタッフ";
    expect(long.length).toBeGreaterThanOrEqual(40);
    const result = detectFirstSentence(long);
    expect(result).not.toBeNull();
    expect(result?.text.endsWith("、")).toBe(true);
  });

  it("does NOT use 読点 fallback for shorter text without terminal", () => {
    const short = "条件を整理させて、いただきます";
    expect(short.length).toBeLessThan(40);
    expect(detectFirstSentence(short)).toBeNull();
  });

  it("handles half-width ! and ?", () => {
    const result = detectFirstSentence("Excelですか? はい使えます。");
    expect(result?.text).toBe("Excelですか?");
  });
});

describe("countSentences", () => {
  it("returns 0 for empty input", () => {
    expect(countSentences("")).toBe(0);
  });

  it("counts terminal punctuation", () => {
    expect(countSentences("はい。そうです。お願いします！")).toBe(3);
  });

  it("returns at least 1 for non-empty without punctuation", () => {
    expect(countSentences("条件整理中")).toBe(1);
  });
});
