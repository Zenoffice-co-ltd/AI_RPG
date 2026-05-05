// Production smoke for the Adecco Grok Voice v2.1 deploy.
//
// Pulls the live xAI ephemeral token from the deployed v3 session route
// at apphosting and asserts:
//   1. scenarioId is staffing_..._v21
//   2. instructions contain every v2.1 priority section + Pronunciation Guide
//   3. Pronunciation Guide sits between Knowledge Base and Runtime Guardrail
//   4. The v21 housing-equipment / staffing vocabulary has been emitted
//
// Behavior smokes (浅い質問 / 仮説 / 自社説明) are NOT redone here — the
// scenario-engine E2E that ran against the same compiled instructions is
// already evidence; the prod smoke's job is to confirm the deploy serves
// the same compiled instructions, not to re-validate the prompt.
//
// Required env (resolved in this order):
//   PROD_BASE_URL              (default: apphosting.yaml APP_BASE_URL)
//   DEMO_ACCESS_TOKEN          ←  zapier-transfer/secrets/demo-access-token
//                                  (or override via env)
//
// Usage:
//   pnpm exec tsx scripts/grok-voice-v21-prod-smoke.mjs

import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";

const BASE_URL =
  process.env.PROD_BASE_URL ??
  "https://adecco-roleplay--adecco-mendan.asia-east1.hosted.app";

function gcloudSecret(name, project) {
  const r = spawnSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${project}`],
    { encoding: "utf8", shell: process.platform === "win32" }
  );
  if (r.status !== 0) return null;
  return r.stdout?.trim() ?? null;
}

let demoToken = process.env.DEMO_ACCESS_TOKEN;
if (!demoToken) {
  // The apphosting.yaml maps `DEMO_ACCESS_TOKEN` env var to the secret
  // named `demo-access-token`. Try zapier-transfer first (default
  // SECRET_SOURCE_PROJECT_ID), then adecco-mendan as fallback.
  for (const proj of ["zapier-transfer", "adecco-mendan"]) {
    const v = gcloudSecret("demo-access-token", proj);
    if (v && v.length > 0) {
      demoToken = v;
      console.log(`[smoke] DEMO_ACCESS_TOKEN fetched from projects/${proj}`);
      break;
    }
  }
}
if (!demoToken) {
  console.error("BLOCKED: DEMO_ACCESS_TOKEN not available.");
  process.exit(2);
}

// Signed cookie format from apps/web/lib/roleplay/auth.ts:
//   signAccessToken(token) = HMAC_SHA256(token, secret=DEMO_ACCESS_TOKEN).hex()
// where the token AND the secret are both DEMO_ACCESS_TOKEN itself.
const signature = createHmac("sha256", demoToken).update(demoToken).digest("hex");

console.log(`[smoke] BASE_URL=${BASE_URL}`);
console.log(`[smoke] cookie signature length=${signature.length}`);

const res = await fetch(`${BASE_URL}/api/v3/session`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: BASE_URL,
    referer: `${BASE_URL}/demo/adecco-roleplay-v3`,
    cookie: `roleplay_api_access=${signature}`,
  },
  body: JSON.stringify({}),
});

console.log(`[smoke] /api/v3/session → ${res.status}`);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}

const body = await res.json();

const failures = [];

// 1. scenarioId
if (body.scenarioId !== "staffing_order_hearing_adecco_manufacturer_busy_manager_medium_v21") {
  failures.push(`scenarioId mismatch: ${body.scenarioId}`);
}

// 2. v2.1 sections + housing-equipment marker + earned-reveal phrases
//    (v2.1 quality patch — 2026-05-05 added Tier ladder, No Stock Suffix,
//     Personal Smalltalk Deflect, Voice-Friendly Phrasing.
//     Hardening — 2026-05-06 added STT Misrecognition Recovery, expanded
//     stock-suffix ban list, strict Tier 2 4-condition gate.)
const required = [
  "v2.1 Customer Attitude",
  "v2.1 Answer Budget",
  "v2.1 Housing Equipment Manufacturer Domain",
  "v2.1 Earned Reveal Policy",
  "v2.1 STT Misrecognition Recovery",
  "v2.1 No Stock Suffix",
  "v2.1 Personal Smalltalk Deflect",
  "v2.1 Voice-Friendly Phrasing",
  "Pronunciation Guide",
  "住宅設備メーカー",
  "よくご存じですね",
  "その理解で近いです",
  // hardening 2026-05-06: expanded stock-suffix ban list
  "他の条件もご確認いただけますか",
  "他に気になる点はありますか",
  "ご質問があればお聞かせください",
  "Final Response Contract",
  "現場確認が必要です",
];

// 2b. promptVersion must reflect the v3.x hardening line and PR58 runtime
// contract metadata bump.
const expectedPromptVersionPrefix = "compile-scenario@2026-05-06.v3.2";
if (
  typeof body.promptVersion !== "string" ||
  !body.promptVersion.startsWith(expectedPromptVersionPrefix)
) {
  failures.push(
    `promptVersion mismatch: ${body.promptVersion} (expected to start with ${expectedPromptVersionPrefix})`
  );
}
for (const s of required) {
  if (!body.instructions.includes(s)) {
    failures.push(`instructions missing: ${s}`);
  }
}

const expectedGuardrailVersion = "gv-think-fast-v4-2026-05-06";
if (body.guardrailVersion !== expectedGuardrailVersion) {
  failures.push(
    `guardrailVersion mismatch: ${body.guardrailVersion} (expected ${expectedGuardrailVersion})`
  );
}

// 3. Section ordering: Pronunciation Guide between KB and Guardrail
const kb = body.instructions.indexOf("# Knowledge Base");
const guide = body.instructions.indexOf("# Pronunciation Guide");
const guard = body.instructions.indexOf("Runtime Guardrails");
if (!(kb < guide && guide < guard)) {
  failures.push(
    `section ordering wrong: kb=${kb}, guide=${guide}, guard=${guard}`
  );
}

// 4. Required v21 vocabulary in Pronunciation Guide
//    (v2.1 quality patch added: 見積もり補助 / 夕方五時三十分 / 朝八時四十五分.
//     Hardening 2026-05-06 added: 受発注入力 / 受発注業務 / 人事 / 人事課 — these
//     were previously past the maxEntries=80 cutoff or absent.)
const requiredVocab = [
  "受発注",
  "受発注入力",
  "受発注業務",
  "納期調整",
  "在庫確認",
  "品番",
  "型番",
  "施工日",
  "職場見学",
  "CP",
  "SK",
  "見積もり補助",
  "夕方五時三十分",
  "朝八時四十五分",
  "人事",
  "人事課",
];
for (const term of requiredVocab) {
  if (!body.instructions.includes(`「${term}」`)) {
    failures.push(`Pronunciation Guide missing vocab: ${term}`);
  }
}

// 5. Production-equivalent VAD config (matches apphosting.yaml).
const td = body.turnDetection ?? {};
if (td.threshold !== 0.5) failures.push(`turnDetection.threshold=${td.threshold} (expected 0.5)`);
if (td.silence_duration_ms !== 500)
  failures.push(`turnDetection.silence_duration_ms=${td.silence_duration_ms} (expected 500)`);
if (td.prefix_padding_ms !== 333)
  failures.push(
    `turnDetection.prefix_padding_ms=${td.prefix_padding_ms} (expected 333)`
  );

console.log("");
console.log(`[smoke] scenarioId: ${body.scenarioId}`);
console.log(`[smoke] promptVersion: ${body.promptVersion}`);
console.log(`[smoke] guardrailVersion: ${body.guardrailVersion}`);
console.log(`[smoke] grokVoiceModel: ${body.grokVoiceModel}`);
console.log(`[smoke] turnDetection: ${JSON.stringify(body.turnDetection)}`);
console.log(`[smoke] instructions length: ${body.instructions.length} chars`);
console.log("");

if (failures.length === 0) {
  console.log("[smoke] PASS — production deploy serves v2.1 instructions.");
  process.exit(0);
} else {
  console.log("[smoke] FAIL:");
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
