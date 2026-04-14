import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { getAppContext } from "../../apps/web/server/appContext";

function getArg(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseRequiredArg(flag: string) {
  const value = getArg(flag);
  if (!value) {
    throw new Error(`Use ${flag} <value>.`);
  }

  return value;
}

async function main() {
  const filePath = resolve(parseRequiredArg("--file"));
  const name = getArg("--name") ?? basename(filePath);
  const description = getArg("--description");
  const ctx = getAppContext();
  const existing = (await ctx.vendors.elevenLabs.listPronunciationDictionaries()).find(
    (dictionary) => dictionary.name === name
  );

  if (existing) {
    console.info(
      JSON.stringify(
        {
          reused: true,
          id: existing.id,
          name: existing.name,
          versionId: existing.latest_version_id ?? existing.version_id ?? null,
          description: existing.description ?? null,
        },
        null,
        2
      )
    );
    return;
  }

  const uploaded = await ctx.vendors.elevenLabs.addPronunciationDictionaryFromFile({
    name,
    fileName: basename(filePath),
    fileContents: await readFile(filePath),
    ...(description ? { description } : {}),
  });

  console.info(
    JSON.stringify(
      {
        reused: false,
        id: uploaded.id,
        name: uploaded.name,
        versionId: uploaded.latest_version_id ?? uploaded.version_id ?? null,
        description: uploaded.description ?? null,
      },
      null,
      2
    )
  );
}

void main();
