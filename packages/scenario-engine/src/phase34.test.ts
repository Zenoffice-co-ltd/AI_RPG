import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import XLSX from "xlsx";
import { importCorpusFromWorkbook, loadWorkbookSourceRecords } from "./phase34";

const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const path of cleanupPaths.splice(0)) {
    try {
      await writeFile(path, "");
    } catch {
      // ignore temp cleanup failures on Windows test sandbox
    }
  }
});

async function createWorkbook() {
  const dir = await mkdtemp(join(tmpdir(), "phase34-"));
  const workbookPath = join(dir, "sample.xlsx");
  const sheet = XLSX.utils.json_to_sheet([
    {
      実施日時: "2026/04/07 17:02 JST",
      "CA名/RA名": "近藤健之",
      面談種別: "派遣SA",
      "求職者名/企業名": "日本和装ホールディングス株式会社",
      タイトル:
        "日本和装ホールディングス株式会社柴崎様 358437＠六本木 - 2026/04/07 17:02 JST",
      トランスクリプト:
        "2026年4月7日文字起こし00:00:00RA: 本日はありがとうございます。00:00:05柴崎様: 楽々精算と支払対応が中心です。00:00:10RA: 支払や経費精算の件数感も伺いたいです。00:00:15柴崎様: 月末はかなり集中します。00:00:20RA: 初期は出社前提でしょうか。00:00:25柴崎様: 最初の数か月は出社前提です。",
      ドキュメントURL: "https://example.com/doc",
    },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "シート1");
  XLSX.writeFile(workbook, workbookPath);
  cleanupPaths.push(workbookPath);
  return workbookPath;
}

describe("phase34 workbook ingest", () => {
  it("loads source records from workbook rows", async () => {
    const workbookPath = await createWorkbook();
    const sourceRecords = loadWorkbookSourceRecords({ workbookPath });
    expect(sourceRecords).toHaveLength(1);
    expect(sourceRecords[0]?.id).toBe("sheet1_row_1");
    expect(sourceRecords[0]?.ownerName).toBe("近藤健之");
  });

  it("imports manifest-targeted canonical transcripts", async () => {
    const workbookPath = await createWorkbook();
    const manifestPath = join(tmpdir(), "phase34-manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          corpusId: "enterprise_accounting_ap_gold_v1",
          family: "accounting_clerk_enterprise_ap",
          sourcePath: workbookPath,
          sheetName: "シート1",
          version: "test-v1",
          createdAt: new Date().toISOString(),
          entries: [
            {
              sourceRecordId: "sheet1_row_1",
              transcriptId: "nihon_waso_20260407",
              tier: "gold",
              reviewStatus: "approved",
              humanApproved: true,
              sellerLabelHints: ["RA"],
              clientLabelHints: ["柴崎"],
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );
    cleanupPaths.push(manifestPath);

    const imported = await importCorpusFromWorkbook({ workbookPath, manifestPath });
    expect(imported.canonicalTranscripts).toHaveLength(1);
    expect(imported.canonicalTranscripts[0]?.quality.usableForMvp).toBe(true);
    expect(imported.canonicalTranscripts[0]?.qualityTier).toBe("gold");
    expect(imported.canonicalTranscripts[0]?.participants.some((p) => p.role === "seller")).toBe(
      true
    );
    expect(imported.canonicalTranscripts[0]?.participants.some((p) => p.role === "client")).toBe(
      true
    );
  });
});
