#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const expected = valueArg("expect") ?? "blocked";
const allowedExpected = new Set(["blocked", "ready"]);
const envFile = valueArg("env-file") ?? resolve("apps", "web", ".env.local");
const failures = [];

const requiredDirectKeys = [
  "FIREBASE_PROJECT_ID",
  "SECRET_SOURCE_PROJECT_ID",
  "QUEUE_SHARED_SECRET",
];

const secretManagerFallbackKeys = [
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "LIVEAVATAR_API_KEY",
  "DEMO_ACCESS_TOKEN",
  "XAI_API_KEY",
  "XAI_RELAY_TICKET_SECRET",
];

const acceptanceContextKeys = [
  "FIREBASE_CREDENTIALS_SECRET_NAME",
  "DEFAULT_ELEVEN_VOICE_ID",
];

const allTrackedKeys = [
  ...requiredDirectKeys,
  ...secretManagerFallbackKeys,
  ...acceptanceContextKeys,
];

if (hasFlag("self-test")) {
  runSelfTest();
  process.exit(0);
}

if (!allowedExpected.has(expected)) {
  failures.push(`invalid --expect value: ${expected}; use blocked or ready`);
}

const report = inspectInputs({
  env: process.env,
  envFilePath: envFile,
});

if (expected === "blocked" && !report.blocked) {
  failures.push("acceptance input inventory is not blocked");
}

if (expected === "ready" && report.blocked) {
  failures.push("acceptance input inventory is not ready");
}

const output = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  expected,
  ...report,
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length > 0) {
  process.exitCode = 1;
}

function inspectInputs({ env, envFilePath, envFileText }) {
  const parsedEnvFile =
    typeof envFileText === "string"
      ? parseEnvKeys(envFileText)
      : readEnvFileKeys(envFilePath);
  const keyReport = Object.fromEntries(
    allTrackedKeys.map((key) => {
      const processEnvPresent = hasConfiguredValue(env[key]);
      const envLocalPresent = parsedEnvFile.keys.has(key);
      return [
        key,
        {
          processEnvPresent,
          envLocalPresent,
          availableWithoutSecretManager: processEnvPresent || envLocalPresent,
        },
      ];
    })
  );

  const missingDirectKeys = requiredDirectKeys.filter(
    (key) => !keyReport[key].availableWithoutSecretManager
  );
  const missingSecretFallbackKeys = secretManagerFallbackKeys.filter(
    (key) => !keyReport[key].availableWithoutSecretManager
  );
  const missingContextKeys = acceptanceContextKeys.filter(
    (key) => !keyReport[key].availableWithoutSecretManager
  );

  return {
    blocked:
      missingDirectKeys.length > 0 || missingSecretFallbackKeys.length > 0,
    note:
      "This inventory checks process env and apps/web/.env.local key presence only; it does not read Secret Manager payloads and does not prove verify:acceptance PASS.",
    envFile: {
      path: envFilePath,
      exists: parsedEnvFile.exists,
      parsedKeyCount: parsedEnvFile.keys.size,
    },
    gcloud: inspectGcloud(),
    trackedKeys: keyReport,
    missingDirectKeys,
    missingSecretFallbackKeys,
    missingContextKeys,
    secretManagerAliases: {
      DEMO_ACCESS_TOKEN: ["DEMO_ACCESS_TOKEN", "demo-access-token"],
      XAI_API_KEY: ["XAI_API_KEY"],
      XAI_RELAY_TICKET_SECRET: ["XAI_RELAY_TICKET_SECRET"],
      OPENAI_API_KEY: ["openai-api-key-default"],
      ELEVENLABS_API_KEY: ["ELEVENLABS_API_KEY"],
      LIVEAVATAR_API_KEY: ["LIVEAVATAR_API_KEY"],
    },
  };
}

function readEnvFileKeys(path) {
  if (!existsSync(path)) {
    return {
      exists: false,
      keys: new Set(),
    };
  }
  return {
    exists: true,
    keys: parseEnvKeys(readFileSync(path, "utf8")).keys,
  };
}

function parseEnvKeys(text) {
  const keys = new Set();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("export ")) {
      const exportMatch = /^export\s+([A-Z0-9_]+)\s*=/u.exec(line);
      if (exportMatch) keys.add(exportMatch[1]);
      continue;
    }
    const match = /^([A-Z0-9_]+)\s*=/u.exec(line);
    if (match) keys.add(match[1]);
  }
  return {
    exists: true,
    keys,
  };
}

function hasConfiguredValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function inspectGcloud() {
  const account = runGcloud(["config", "get-value", "account"]);
  const project = runGcloud(["config", "get-value", "project"]);
  return {
    available: account.ok || project.ok,
    account: account.ok ? account.stdout : null,
    project: project.ok ? project.stdout : null,
    errors: [account, project]
      .filter((result) => !result.ok)
      .map((result) => result.error),
  };
}

function runGcloud(args) {
  for (const command of ["gcloud", "gcloud.cmd"]) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) {
      return {
        ok: true,
        stdout: result.stdout.trim(),
      };
    }
    if (result.error?.code && !["ENOENT", "EINVAL"].includes(result.error.code)) {
      return {
        ok: false,
        error: (result.stderr || result.error?.message || `${command} failed`).trim(),
      };
    }
  }

  const psResult = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      ["gcloud", ...args.map((arg) => JSON.stringify(arg))].join(" "),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    }
  );
  if (psResult.status === 0) {
    return {
      ok: true,
      stdout: psResult.stdout.trim(),
    };
  }
  return {
    ok: false,
    error: (psResult.stderr || psResult.error?.message || "gcloud failed").trim(),
  };
}

function runSelfTest() {
  const ready = inspectInputs({
    env: {
      FIREBASE_PROJECT_ID: "adecco-ai-roleplay-dev",
      SECRET_SOURCE_PROJECT_ID: "zapier-transfer",
      QUEUE_SHARED_SECRET: "set",
      OPENAI_API_KEY: "set",
      ELEVENLABS_API_KEY: "set",
      LIVEAVATAR_API_KEY: "set",
      DEMO_ACCESS_TOKEN: "set",
      XAI_API_KEY: "set",
      XAI_RELAY_TICKET_SECRET: "set",
    },
    envFilePath: "unused",
    envFileText: "",
  });
  if (ready.blocked) {
    throw new Error("ready fixture was classified as blocked");
  }

  const blocked = inspectInputs({
    env: {
      FIREBASE_PROJECT_ID: "adecco-ai-roleplay-dev",
    },
    envFilePath: "unused",
    envFileText: "SECRET_SOURCE_PROJECT_ID=zapier-transfer\n",
  });
  if (!blocked.blocked) {
    throw new Error("blocked fixture was classified as ready");
  }
  if (!blocked.missingDirectKeys.includes("QUEUE_SHARED_SECRET")) {
    throw new Error("blocked fixture did not require QUEUE_SHARED_SECRET");
  }
  if (!blocked.missingSecretFallbackKeys.includes("XAI_RELAY_TICKET_SECRET")) {
    throw new Error("blocked fixture did not track XAI_RELAY_TICKET_SECRET");
  }

  const exportStyle = parseEnvKeys("export DEMO_ACCESS_TOKEN=redacted\n");
  if (!exportStyle.keys.has("DEMO_ACCESS_TOKEN")) {
    throw new Error("export-style env key was not parsed");
  }

  console.log("vFinal acceptance input inventory self-test PASS");
}

function hasFlag(flag) {
  return process.argv.includes(flag) || process.argv.includes(`--${flag}`);
}

function valueArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}
