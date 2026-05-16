#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const expected = valueArg("expect") ?? "blocked";
const failures = [];

const PROJECTS = {
  adecco: valueArg("adecco-project") ?? "adecco-mendan",
  fallback: valueArg("fallback-project") ?? "zapier-transfer",
};

const SA = {
  vfinal: "serviceAccount:firebase-app-hosting-vfinal@adecco-mendan.iam.gserviceaccount.com",
  legacy: "serviceAccount:firebase-app-hosting-compute@adecco-mendan.iam.gserviceaccount.com",
  relay: "serviceAccount:xai-realtime-relay@adecco-mendan.iam.gserviceaccount.com",
};

if (hasFlag("self-test")) {
  runSelfTest();
  process.exit(0);
}

if (!["blocked", "removed"].includes(expected)) {
  failures.push(`invalid --expect value: ${expected}; use blocked or removed`);
}

const result = inspectLiveBoundary();
if (!result.ok) failures.push(...result.failures);

const report = result.report;
if (report) {
  if (!report.dedicatedVFinalNoXaiApiKeyAccess) {
    failures.push("dedicated vFinal service account has XAI_API_KEY IAM access");
  }
  if (!report.relayHasRequiredAccess) {
    failures.push("Cloud Run relay service account is missing required secret access");
  }
  if (expected === "blocked" && !report.legacySharedXaiApiKeyAccessPresent) {
    failures.push("expected legacy shared XAI_API_KEY access to remain present");
  }
  if (expected === "removed" && report.legacySharedXaiApiKeyAccessPresent) {
    failures.push("expected legacy shared XAI_API_KEY access to be removed");
  }
}

console.log(
  JSON.stringify(
    {
      status: failures.length === 0 ? "PASS" : "FAIL",
      expected,
      ...report,
      failures,
    },
    null,
    2
  )
);

if (failures.length > 0) process.exitCode = 1;

function inspectLiveBoundary() {
  const reads = {
    adeccoXaiApiKey: readPolicy(PROJECTS.adecco, "XAI_API_KEY"),
    adeccoRelayTicket: readPolicy(PROJECTS.adecco, "XAI_RELAY_TICKET_SECRET"),
    fallbackXaiApiKey: readPolicy(PROJECTS.fallback, "XAI_API_KEY"),
  };
  const readFailures = Object.entries(reads)
    .filter(([, value]) => !value.ok)
    .map(([name, value]) => `${name}: ${value.error}`);
  if (readFailures.length > 0) {
    return {
      ok: false,
      failures: readFailures,
      report: {
        note:
          "Read-only Secret Manager IAM boundary inventory. Secret payloads are not read.",
        projects: PROJECTS,
      },
    };
  }

  const adeccoXai = summarizePolicy(reads.adeccoXaiApiKey.policy);
  const adeccoTicket = summarizePolicy(reads.adeccoRelayTicket.policy);
  const fallbackXai = summarizePolicy(reads.fallbackXaiApiKey.policy);
  const vfinalXaiAccess =
    hasAnyRole(adeccoXai, SA.vfinal, [
      "roles/secretmanager.secretAccessor",
      "roles/secretmanager.viewer",
    ]) ||
    hasAnyRole(fallbackXai, SA.vfinal, [
      "roles/secretmanager.secretAccessor",
      "roles/secretmanager.viewer",
    ]);
  const legacyXaiAccess =
    hasAnyRole(adeccoXai, SA.legacy, [
      "roles/secretmanager.secretAccessor",
      "roles/secretmanager.viewer",
    ]) ||
    hasAnyRole(fallbackXai, SA.legacy, [
      "roles/secretmanager.secretAccessor",
      "roles/secretmanager.viewer",
    ]);
  const relayHasRequiredAccess =
    hasRole(adeccoXai, SA.relay, "roles/secretmanager.secretAccessor") &&
    hasRole(adeccoTicket, SA.relay, "roles/secretmanager.secretAccessor");

  return {
    ok: true,
    failures: [],
    report: {
      note:
        "Read-only Secret Manager IAM boundary inventory. Secret payloads are not read, printed, or persisted.",
      officialDocsRechecked: [
        "https://cloud.google.com/secret-manager/docs/access-control",
        "https://firebase.google.com/docs/app-hosting/configure",
      ],
      projects: PROJECTS,
      serviceAccounts: SA,
      dedicatedVFinalNoXaiApiKeyAccess: !vfinalXaiAccess,
      legacySharedXaiApiKeyAccessPresent: legacyXaiAccess,
      relayHasRequiredAccess,
      scopeDecisionRequired:
        legacyXaiAccess &&
        "Legacy shared App Hosting still has XAI_API_KEY IAM access; #139 remains blocked until this is approved out of scope or removed/migrated.",
      secrets: {
        adeccoXaiApiKey: roleSummaryFor(adeccoXai),
        adeccoRelayTicket: roleSummaryFor(adeccoTicket),
        fallbackXaiApiKey: roleSummaryFor(fallbackXai),
      },
    },
  };
}

function readPolicy(project, secret) {
  const result = runGcloud([
    "secrets",
    "get-iam-policy",
    secret,
    `--project=${project}`,
    "--format=json",
  ]);
  if (!result.ok) return result;
  try {
    return {
      ok: true,
      policy: JSON.parse(result.stdout || "{}"),
    };
  } catch (error) {
    return {
      ok: false,
      error: `failed to parse IAM policy for ${project}/${secret}: ${messageOf(error)}`,
    };
  }
}

function summarizePolicy(policy) {
  const byRole = new Map();
  for (const binding of policy?.bindings ?? []) {
    const role = binding?.role;
    if (typeof role !== "string") continue;
    byRole.set(
      role,
      Array.isArray(binding.members)
        ? binding.members.filter((member) => typeof member === "string").sort()
        : []
    );
  }
  return byRole;
}

function roleSummaryFor(summary) {
  return {
    secretAccessor: summary.get("roles/secretmanager.secretAccessor") ?? [],
    viewer: summary.get("roles/secretmanager.viewer") ?? [],
    secretVersionManager: summary.get("roles/secretmanager.secretVersionManager") ?? [],
  };
}

function hasAnyRole(summary, member, roles) {
  return roles.some((role) => hasRole(summary, member, role));
}

function hasRole(summary, member, role) {
  return (summary.get(role) ?? []).includes(member);
}

function runGcloud(args) {
  for (const command of gcloudCommands()) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    });
    if (result.status === 0) {
      return { ok: true, stdout: result.stdout.trim() };
    }
    if (result.error?.code && !["ENOENT", "EINVAL"].includes(result.error.code)) {
      return {
        ok: false,
        error: sanitizeGcloudError(result.stderr || result.error.message || `${command} failed`),
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
      ["gcloud", ...args.map(psQuote)].join(" "),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    }
  );
  if (psResult.status === 0) {
    return { ok: true, stdout: psResult.stdout.trim() };
  }
  return {
    ok: false,
    error: sanitizeGcloudError(psResult.stderr || psResult.error?.message || "gcloud failed"),
  };
}

function gcloudCommands() {
  return process.platform === "win32" ? ["gcloud.cmd", "gcloud"] : ["gcloud"];
}

function psQuote(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function sanitizeGcloudError(value) {
  return String(value)
    .split(/\r?\n/u)
    .filter((line) => !/token|secret value|credential|authorization/iu.test(line))
    .join("\n")
    .trim();
}

function valueArg(name) {
  const prefix = `--${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}` && process.argv[index + 1]) return process.argv[index + 1];
  }
  return null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function runSelfTest() {
  const summary = summarizePolicy({
    bindings: [
      {
        role: "roles/secretmanager.secretAccessor",
        members: [SA.legacy, SA.relay],
      },
      {
        role: "roles/secretmanager.viewer",
        members: [SA.legacy],
      },
    ],
  });
  if (!hasRole(summary, SA.legacy, "roles/secretmanager.secretAccessor")) {
    throw new Error("secretAccessor parser self-test failed");
  }
  if (!hasAnyRole(summary, SA.legacy, ["roles/secretmanager.viewer"])) {
    throw new Error("viewer parser self-test failed");
  }
  if (hasRole(summary, SA.vfinal, "roles/secretmanager.secretAccessor")) {
    throw new Error("unexpected vFinal access in self-test");
  }
  console.log("vFinal Secret Manager IAM boundary self-test PASS");
}
