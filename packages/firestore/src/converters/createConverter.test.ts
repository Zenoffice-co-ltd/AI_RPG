import { describe, expect, it } from "vitest";
import { transcriptRecordSchema } from "@top-performer/domain";
import { createConverter } from "./createConverter";

describe("createConverter", () => {
  it("parses documents through the provided schema", () => {
    const converter = createConverter(transcriptRecordSchema);
    const snapshot = {
      data: () => ({
        id: "tr_1",
        sourceFile: "sample.json",
        family: "staffing_order_hearing",
        performanceTier: "top",
        language: "ja",
        metadata: {},
        turns: [{ turnId: "t_001", speaker: "sales", text: "hello" }],
        importedAt: new Date().toISOString(),
        redactionStatus: "redacted",
      }),
    };

    const parsed = converter.fromFirestore(snapshot as never);
    expect(parsed.id).toBe("tr_1");
  });
});
