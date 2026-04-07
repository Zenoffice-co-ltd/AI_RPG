import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { JaVoiceInventoryRow } from "../../packages/scenario-engine/src/jaVoiceVariations";
import { getAppContext } from "../../apps/web/server/appContext";

function getArg(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function getArgs(flag: string) {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]!);
    }
  }
  return values;
}

function sanitizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

async function main() {
  const inventoryPath = getArg("--inventory");
  if (!inventoryPath) {
    throw new Error("Use --inventory <path-to-inventory.json>");
  }

  const candidateIds = getArgs("--candidate-id");
  if (candidateIds.length === 0) {
    throw new Error("Use at least one --candidate-id <candidateId>");
  }

  const rows = JSON.parse(
    await readFile(inventoryPath, "utf8")
  ) as JaVoiceInventoryRow[];
  const selected = candidateIds.map((candidateId) => {
    const row = rows.find((entry) => entry.candidateId === candidateId);
    if (!row) {
      throw new Error(`Candidate not found in inventory: ${candidateId}`);
    }
    if (row.source !== "shared") {
      throw new Error(
        `Candidate ${candidateId} is not a shared voice and does not need promotion.`
      );
    }
    if (!row.publicOwnerId) {
      throw new Error(
        `Candidate ${candidateId} does not have a publicOwnerId in inventory.`
      );
    }
    return row;
  });

  const prefix = getArg("--prefix") ?? "ja_busy_mgr";
  const ctx = getAppContext();
  const created = [];
  for (const row of selected) {
    const newName = `${prefix}_${row.candidateId}_${sanitizeName(row.name)}`;
    const response = await ctx.vendors.elevenLabs.addSharedVoice(
      row.publicOwnerId,
      row.voiceId,
      newName
    );
    created.push({
      candidateId: row.candidateId,
      sourceVoiceId: row.voiceId,
      promotedVoiceId: response.voice_id,
      newName,
      inventory: basename(inventoryPath),
    });
  }

  console.info(JSON.stringify({ created }, null, 2));
}

void main();
