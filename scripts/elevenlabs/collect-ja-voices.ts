import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Papa from "papaparse";
import {
  JA_VOICE_INVENTORY_GENERATED_ROOT,
  selectJaVoiceVariationCandidates,
  writeJaVoiceInventoryReport,
  type JaVoiceInventoryRow,
} from "../../packages/scenario-engine/src/jaVoiceVariations";
import { getAppContext } from "../../apps/web/server/appContext";

function getArg(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const outputDir = getArg("--output-dir") ?? JA_VOICE_INVENTORY_GENERATED_ROOT;
  const ctx = getAppContext();
  const result = await writeJaVoiceInventoryReport({
    elevenLabs: ctx.vendors.elevenLabs,
    outputDir,
    ...(getArg("--search") ? { search: getArg("--search") } : {}),
  });

  const rows = JSON.parse(
    await readFile(result.jsonPath, "utf8")
  ) as JaVoiceInventoryRow[];
  const recommended = selectJaVoiceVariationCandidates(rows);
  const selectionJsonPath = resolve(
    outputDir,
    `${new Date().toISOString().replaceAll(":", "-")}.selection.json`
  );
  const selectionCsvPath = selectionJsonPath.replace(/\.json$/i, ".csv");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    selectionJsonPath,
    `${JSON.stringify(recommended, null, 2)}\n`,
    "utf8"
  );
  await writeFile(selectionCsvPath, `${Papa.unparse(recommended)}\n`, "utf8");

  console.info(
    JSON.stringify(
      {
        ...result,
        selectionJsonPath,
        selectionCsvPath,
        recommendedCount: recommended.length,
      },
      null,
      2
    )
  );
}

void main();
