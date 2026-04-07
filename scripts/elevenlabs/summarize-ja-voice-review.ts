import { summarizeJaVoiceReviewSheet } from "../../packages/scenario-engine/src/jaVoiceVariations";

function getArg(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const csvPath = getArg("--csv");
  if (!csvPath) {
    throw new Error("Use --csv <path-to-review-sheet.csv>");
  }

  const result = await summarizeJaVoiceReviewSheet({
    csvPath,
    ...(getArg("--output-dir") ? { outputDir: getArg("--output-dir") } : {}),
  });

  console.info(JSON.stringify(result, null, 2));
}

void main();
