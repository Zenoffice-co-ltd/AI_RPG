import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let envLoaded = false;

function parseEnvFile(filePath: string) {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value.length === 0) {
      continue;
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function ensureEnvLoaded() {
  if (envLoaded) {
    return;
  }

  const candidateGroups = [
    resolve(process.cwd()),
    resolve(process.cwd(), "apps/web"),
    resolve(process.cwd(), "../../"),
  ];

  for (const basePath of candidateGroups) {
    const localPath = resolve(basePath, ".env.local");
    const envPath = resolve(basePath, ".env");
    const examplePath = resolve(basePath, ".env.local.example");
    const hasConcreteEnv = existsSync(localPath) || existsSync(envPath);

    if (existsSync(localPath)) {
      parseEnvFile(localPath);
    }
    if (existsSync(envPath)) {
      parseEnvFile(envPath);
    }
    if (!hasConcreteEnv && existsSync(examplePath)) {
      parseEnvFile(examplePath);
    }
  }

  envLoaded = true;
}
