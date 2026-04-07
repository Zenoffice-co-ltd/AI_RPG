import { writeVoiceInventoryReport } from "../../packages/scenario-engine/src/benchmarkRenderer";
import { getAppContext } from "../../apps/web/server/appContext";

function getArg(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const locale = getArg("--locale") ?? "ja";
  const query = getArg("--query");
  const outputDir = getArg("--output-dir");
  const ctx = getAppContext();

  const result = await writeVoiceInventoryReport({
    elevenLabs: ctx.vendors.elevenLabs,
    localePrefix: locale,
    ...(query ? { query } : {}),
    ...(outputDir ? { outputDir } : {}),
  });

  console.info(JSON.stringify(result, null, 2));
}

void main();
