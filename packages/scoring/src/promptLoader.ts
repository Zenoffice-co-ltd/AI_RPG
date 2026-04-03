import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const promptsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "prompts"
);

export async function loadPromptAsset(fileName: string): Promise<string> {
  return readFile(resolve(promptsDir, fileName), "utf8");
}
