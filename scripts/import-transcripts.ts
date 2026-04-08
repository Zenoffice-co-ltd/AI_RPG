import { importTranscriptsJob } from "../apps/web/server/use-cases/admin";

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const path = process.argv[2] ?? "./data/transcripts";
  const family = getArg("--family");
  const manifestPath = getArg("--manifest");
  const mode = getArg("--mode");

  const result = await importTranscriptsJob({
    path,
    ...(family ? { family } : {}),
    ...(manifestPath ? { manifestPath } : {}),
    ...(mode ? { mode } : {}),
  });
  console.info(JSON.stringify(result, null, 2));
}

void main();
