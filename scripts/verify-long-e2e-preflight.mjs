// Lightweight preflight for long-running E2E / spreadsheet DoD runs.
//
// Usage:
//   node scripts/verify-long-e2e-preflight.mjs --denominator "13/13 guard smoke" --runner scripts/foo.mjs --secret DEMO_ACCESS_TOKEN:demo-access-token

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const denominator = stringArg(args.denominator, "");
const runner = stringArg(args.runner, "");
const outDir = resolve(stringArg(args.out, "out/long_e2e_preflight/latest"));
const secretSpecs = toArray(args.secret);
const project = stringArg(args.project, "adecco-mendan");
const failures = [];
const checks = [];

if (!denominator) failures.push("missing --denominator");
checks.push({ name: "denominator", value: denominator || null, ok: Boolean(denominator) });

if (!runner) {
  failures.push("missing --runner");
  checks.push({ name: "runner", value: null, ok: false });
} else {
  const runnerPath = resolve(runner);
  const ok = existsSync(runnerPath);
  checks.push({ name: "runner", value: runnerPath, ok });
  if (!ok) failures.push(`runner not found: ${runnerPath}`);
}

for (const spec of secretSpecs) {
  const [envName, alias = envName] = spec.split(":");
  const result = resolveSecret(envName, alias, project);
  checks.push({ name: `secret:${envName}`, alias, ok: result.ok, source: result.source });
  if (!result.ok) failures.push(`secret unavailable: ${envName} alias=${alias}`);
}

mkdirSync(outDir, { recursive: true });
const evidence = {
  generatedAt: new Date().toISOString(),
  denominator,
  runner,
  project,
  checks,
  pass: failures.length === 0,
  failures,
};
writeFileSync(resolve(outDir, "preflight.json"), JSON.stringify(evidence, null, 2) + "\n");

console.log(JSON.stringify(evidence, null, 2));
process.exit(evidence.pass ? 0 : 1);

function resolveSecret(envName, alias, project) {
  const envValue = process.env[envName];
  if (isRealSecret(envValue)) return { ok: true, source: "process.env" };
  const command = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
  const result = spawnSync(
    command,
    ["secrets", "versions", "access", "latest", `--secret=${alias}`, `--project=${project}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (result.status === 0 && isRealSecret(result.stdout.trim())) {
    return { ok: true, source: `Secret Manager:${project}/${alias}` };
  }
  return { ok: false, source: "missing" };
}

function isRealSecret(value) {
  return typeof value === "string" && value.trim().length >= 8 && !value.startsWith("test-");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    const value = next && !next.startsWith("--") ? next : "true";
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
    } else {
      out[key] = value;
    }
    if (next && !next.startsWith("--")) i += 1;
  }
  return out;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stringArg(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
