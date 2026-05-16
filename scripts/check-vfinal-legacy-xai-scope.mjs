#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const expected = valueArg("expect") ?? "blocked";
const allowedExpected = new Set(["blocked", "pass"]);

if (hasFlag("help") || hasFlag("h")) {
  printHelp();
  process.exit(0);
}

if (hasFlag("self-test")) {
  runSelfTest();
  process.exit(0);
}

if (!allowedExpected.has(expected)) {
  console.error(`Invalid --expect value: ${expected}. Use blocked or pass.`);
  process.exit(1);
}

const files = {
  sharedApphosting: "apps/web/apphosting.yaml",
  vfinalApphosting: "apps/web/apphosting.vfinal.yaml",
  vfinalSessionRoute: "apps/web/app/api/grok-first-vFinal/session/route.ts",
  vfinalSessionLib: "apps/web/lib/grok-first-roleplay/vfinal-session.ts",
  legacyServerEnv: "apps/web/lib/roleplay/server-env.ts",
  legacyV3SessionRoute: "apps/web/app/api/v3/session/route.ts",
  legacyTts: "apps/web/server/grokVoice/tts.ts",
};

const failures = [];
const source = {};
for (const [key, relativePath] of Object.entries(files)) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`missing ${key}: ${relativePath}`);
    source[key] = "";
    continue;
  }
  source[key] = readFileSync(absolutePath, "utf8");
}

const submittedVfinal = {
  apphostingOmitsXaiApiKey: !/\bXAI_API_KEY\b/.test(source.vfinalApphosting),
  sessionRouteOmitsXaiApiKey: !/\bXAI_API_KEY\b/.test(source.vfinalSessionRoute),
  sessionLibOmitsXaiApiKey: !/\bXAI_API_KEY\b/.test(source.vfinalSessionLib),
  sessionLibUsesRelayTicketSecret: /\bXAI_RELAY_TICKET_SECRET\b/.test(source.vfinalSessionLib),
  sessionLibUsesRelayWsUrl: /wss:\/\/voice\.mendan\.biz\/api\/v3\/realtime-relay/.test(
    source.vfinalSessionLib
  ),
};

const legacyShared = {
  sharedApphostingBindsXaiApiKey: /variable:\s*XAI_API_KEY[\s\S]{0,120}secret:\s*XAI_API_KEY/.test(
    source.sharedApphosting
  ),
  serverEnvDefinesXaiApiKey: /\bXAI_API_KEY:\s*z\.string\(\)\.min\(1\)/.test(
    source.legacyServerEnv
  ),
  productionAssertRequiresXaiApiKey: /const required = \["XAI_API_KEY"\] as const/.test(
    source.legacyServerEnv
  ),
  v3SessionUsesXaiApiKey: /issueGrokEphemeralToken\([\s\S]*apiKey:\s*env\.XAI_API_KEY/.test(
    source.legacyV3SessionRoute
  ),
  ttsUsesXaiApiKey: /authorization:\s*`Bearer \$\{env\.XAI_API_KEY\}`/.test(source.legacyTts),
};

for (const [key, value] of Object.entries(submittedVfinal)) {
  if (!value) failures.push(`submitted vFinal invariant failed: ${key}`);
}

const legacyDependencyCount = Object.values(legacyShared).filter(Boolean).length;

if (expected === "blocked") {
  if (legacyDependencyCount === 0) {
    failures.push("expected BLOCKED but found no legacy shared XAI_API_KEY dependency markers");
  }
  if (!legacyShared.sharedApphostingBindsXaiApiKey) {
    failures.push("expected shared App Hosting apphosting.yaml to still bind XAI_API_KEY");
  }
}

if (expected === "pass") {
  if (legacyDependencyCount > 0) {
    failures.push(
      "expected PASS but legacy shared XAI_API_KEY dependency markers remain in apphosting/runtime code"
    );
  }
}

const output = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  expected,
  submittedVfinal,
  legacyShared,
  legacyDependencyCount,
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length > 0) {
  process.exitCode = 1;
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

function runSelfTest() {
  const sample = `
env:
  - variable: XAI_API_KEY
    secret: XAI_API_KEY
`;
  if (!/variable:\s*XAI_API_KEY[\s\S]{0,120}secret:\s*XAI_API_KEY/.test(sample)) {
    throw new Error("shared App Hosting XAI_API_KEY binding matcher failed");
  }
  const vfinalSample = "XAI_RELAY_TICKET_SECRET\nwss://voice.mendan.biz/api/v3/realtime-relay";
  if (!/\bXAI_RELAY_TICKET_SECRET\b/.test(vfinalSample)) {
    throw new Error("relay ticket matcher failed");
  }
  console.log("vFinal legacy XAI scope self-test PASS");
}

function printHelp() {
  console.log(`Usage: node scripts/check-vfinal-legacy-xai-scope.mjs [options]

Options:
  --expect=blocked|pass   Expected state. Defaults to blocked.
  --self-test             Run matcher self-test.
  --help                  Show this help.

The check is repo-local and read-only. It does not read Secret Manager payloads
or mutate IAM. It verifies that the submitted vFinal App Hosting runtime remains
no-key while legacy shared App Hosting/runtime XAI_API_KEY dependency markers
remain present until #139 is approved or migrated.`);
}
