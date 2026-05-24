import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const promptsRoot = resolve(
  process.cwd(),
  "..",
  "..",
  "scripts",
  "adecco_order_hearing_eval",
  "prompts"
);

describe("Adecco order hearing eval v2 prompt bundle", () => {
  it("requires v2 browser evaluation fields in schema.json", () => {
    const schema = JSON.parse(
      readFileSync(resolve(promptsRoot, "schema.json"), "utf8")
    ) as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.properties?.["schema_version"]).toMatchObject({
      enum: ["adecco_order_hearing_eval_v2"],
    });
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "must_capture_groups",
        "next_training_actions",
        "modality_limitations",
        "sales_compliance_flags",
      ])
    );
  });

  it("captures customer criteria, compliance, and modality limitations", () => {
    const system = readFileSync(resolve(promptsRoot, "system.md"), "utf8");
    expect(system).toContain("初回アデコ発注");
    expect(system).toContain("既存派遣会社への不満");
    expect(system).toContain("人材供給力");
    expect(system).toContain("レスポンス速度");
    expect(system).toContain("質問への回答精度");
    expect(system).toContain("アデコの特徴と強み");
    expect(system).toContain("他社との違い");
    expect(system).toContain("年齢・性別・容姿");
    expect(system).toContain("直接評価しない");
    expect(system).toContain("現場課長・営業管理課などへの確認");
    expect(system).toContain("must_capture_groups は必ず8グループ");
    expect(system).toContain("evidence.turn_id は構造化データ上の参照ID");
    expect(system).toContain("利用者向け説明文には");
    expect(system).toContain("turn_id、turn 12、t012");
  });
});
