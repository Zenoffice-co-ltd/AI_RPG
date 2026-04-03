import { importTranscriptsJob } from "../apps/web/server/use-cases/admin";

async function main() {
  const path = process.argv[2] ?? "./data/transcripts";
  const result = await importTranscriptsJob({ path });
  console.info(JSON.stringify(result, null, 2));
}

void main();
