import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = resolve(currentDir, "../../..");
export const GENERATED_ROOT = resolve(WORKSPACE_ROOT, "data/generated");

export async function writeGeneratedJson(
  relativePath: string,
  payload: unknown
): Promise<void> {
  const target = resolve(GENERATED_ROOT, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function resolveWorkspacePath(inputPath: string) {
  return inputPath.startsWith(".")
    ? resolve(WORKSPACE_ROOT, inputPath)
    : resolve(inputPath);
}
