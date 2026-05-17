import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function resolveSecretValue(input) {
  const envName = input.envName;
  const secretNames = unique([...(input.secretNames ?? []), envName]);
  const projects = unique([
    ...(input.projects ?? []),
    process.env.SECRET_SOURCE_PROJECT_ID,
    "zapier-transfer",
    "adecco-mendan",
  ].filter(Boolean));
  const minLength = input.minLength ?? 1;
  const repoRoot = input.repoRoot ?? process.cwd();
  const attempts = [];

  const envValue = process.env[envName];
  attempts.push({ source: "process.env", name: envName });
  if (isUsableSecret(envValue, minLength)) {
    return { value: envValue, source: `process.env:${envName}`, attempts };
  }

  const envLocal = readEnvLocal(path.join(repoRoot, "apps", "web", ".env.local"));
  for (const name of unique([envName, ...secretNames])) {
    attempts.push({ source: "apps/web/.env.local", name });
    const value = envLocal[name];
    if (isUsableSecret(value, minLength)) {
      return { value, source: `apps/web/.env.local:${name}`, attempts };
    }
  }

  for (const project of projects) {
    for (const secretName of secretNames) {
      attempts.push({ source: "secret-manager", project, name: secretName });
      const value = accessSecretManagerValue(secretName, project);
      if (isUsableSecret(value, minLength)) {
        return {
          value,
          source: `secret-manager:${project}/${secretName}`,
          attempts,
        };
      }
    }
  }

  const tried = attempts
    .map((attempt) =>
      attempt.project
        ? `${attempt.source}:${attempt.project}/${attempt.name}`
        : `${attempt.source}:${attempt.name}`
    )
    .join(", ");
  throw new Error(
    `BLOCKED: ${envName} not available; tried ${tried}`
  );
}

export function describeSecretAttempts(attempts) {
  return attempts
    .map((attempt) =>
      attempt.project
        ? `${attempt.source}:${attempt.project}/${attempt.name}`
        : `${attempt.source}:${attempt.name}`
    )
    .join(", ");
}

function accessSecretManagerValue(secretName, project) {
  const args = [
    "secrets",
    "versions",
    "access",
    "latest",
    `--secret=${secretName}`,
    `--project=${project}`,
  ];
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            ["gcloud", ...args.map(psQuote)].join(" "),
          ],
          { encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] }
        )
      : spawnSync("gcloud", args, {
          encoding: "utf8",
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function readEnvLocal(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    out[match[1]] = unquote(match[2]);
  }
  return out;
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isUsableSecret(value, minLength) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= minLength && !/^test-/i.test(trimmed);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
