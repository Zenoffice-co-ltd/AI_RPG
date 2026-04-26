/**
 * Manual orb v3 (2026-04-26) — DoD doc-level guard.
 *
 * Asserts that the manual orb test procedure documented in OPERATIONS.md
 * and memo.md includes Test 5.5 (conditions confirmation: 開始時期, 就業時間,
 * 残業, 請求単価, 優先したい経験, 人物面) before Test 6 (closing summary +
 * Adecco reverse question).
 *
 * Why a doc-level test exists: the manual orb v3 P0 was that Test 6 fired
 * the closing_summary trigger before the learner had a chance to gather the
 * conditions needed to summarise. Test 5.5 is the missing step. This test
 * locks the procedure into the runbook so a future docs edit cannot quietly
 * delete it.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const operationsPath = resolve(repoRoot, "docs/OPERATIONS.md");
const memoPath = resolve(
  repoRoot,
  "docs/references/adecco_manufacturer_order_hearing_memo.md"
);

describe("Manual orb test procedure (Test 5.5 before Test 6)", () => {
  it("manual-test-5-5-before-test-6: OPERATIONS.md documents Test 5.5 with the six condition items", () => {
    const text = readFileSync(operationsPath, "utf8");

    const test55Index = text.indexOf("Test 5.5");
    expect(test55Index, "OPERATIONS.md must contain a Test 5.5 section").toBeGreaterThan(
      -1
    );

    // Test 5.5 must come before the FIRST occurrence of "Test 6" that
    // appears AFTER Test 5.5 starts (i.e., Test 5.5 introduces Test 6).
    const test6IndexAfter55 = text.indexOf("Test 6", test55Index);
    expect(
      test6IndexAfter55,
      "OPERATIONS.md must mention Test 6 after Test 5.5"
    ).toBeGreaterThan(test55Index);

    // Within the Test 5.5 block (up to the next ## or ### heading or Test 6),
    // all six condition keywords must appear.
    const blockEnd = test6IndexAfter55;
    const block = text.slice(test55Index, blockEnd);
    for (const keyword of [
      "開始時期",
      "就業時間",
      "残業",
      "請求単価",
      "優先",
      "人物",
    ]) {
      expect(
        block,
        `Test 5.5 block must include the keyword「${keyword}」 to confirm the condition is hearable before Test 6`
      ).toContain(keyword);
    }
  });

  it("manual-test-5-5-before-test-6: memo.md documents the manual orb v3 fix and Test 5.5 rationale", () => {
    const text = readFileSync(memoPath, "utf8");

    // Manual orb v3 section must exist
    expect(text, "memo.md must contain a Manual Orb v3 section").toContain(
      "Manual Orb v3"
    );

    // Closing-summary early-fire bug must be documented
    expect(
      text,
      "memo.md must document the closing_summary early-fire bug from manual orb v3"
    ).toMatch(/closing_summary.*(早期|early)/i);

    // Test 5.5 rationale must be documented
    expect(
      text,
      "memo.md must mention why Test 5.5 was added"
    ).toContain("Test 5.5");

    // Test 1 unchanged note must be present (per user instruction)
    expect(
      text,
      "memo.md must record that Test 1 opening line is unchanged per user instruction"
    ).toMatch(/Test 1.*(unchanged|変更しない|修正しない|ユーザー承認)/);
  });

  it("manual-test-5-5-before-test-6: OPERATIONS.md keeps Test 1〜8 manual orb gate text", () => {
    const text = readFileSync(operationsPath, "utf8");
    // The runbook still references the full 1〜8 (or 1-8) span, possibly with 5.5 inserted.
    // We accept either bracket form: "Test 1〜8", "Test 1-8", "Test 1 through 8", or
    // the explicit "Test 1〜5, 5.5, 6〜8".
    expect(text).toMatch(
      /Test 1\s*[〜\-]\s*8|Test 1 through 8|Test 1\s*〜\s*5,\s*5\.5,\s*6\s*〜\s*8/
    );
  });
});
