import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CASES } from "./grok-voice-v21-e2e-cases";

const MATRIX_PATH = resolve("docs", "GROK_VOICE_V21_E2E_MATRIX.md");
const REQUIRED_NON_TEXT_IDS = [
  "voice_case1_shallow_background",
  "voice_case2_domain_hypothesis",
  "voice_case3_headcount",
  "voice_case4_rate",
  "voice_case5_order_entry_requirement",
  "realtime_case1_session_ready_order",
  "realtime_case2_send_before_open_queue",
  "realtime_case3_audio_before_ready_blocked",
  "realtime_case4_send_failure_telemetry",
  "realtime_case5_barge_in_cancel",
  "pls_maxEntries80_critical_lexeme_regression",
];

async function main() {
  const matrix = await readFile(MATRIX_PATH, "utf8");
  const missing: string[] = [];
  for (const c of CASES) {
    if (!matrix.includes(c.id)) missing.push(`missing case id: ${c.id}`);
    if (!matrix.includes(c.label)) missing.push(`missing case label: ${c.id}`);
  }
  for (const id of REQUIRED_NON_TEXT_IDS) {
    if (!matrix.includes(id)) missing.push(`missing non-text matrix id: ${id}`);
  }
  if (missing.length > 0) {
    console.error("[grok-voice-e2e-matrix] FAIL");
    for (const m of missing) console.error(`- ${m}`);
    process.exit(1);
  }
  console.info(
    `[grok-voice-e2e-matrix] PASS: ${CASES.length} text cases + ${REQUIRED_NON_TEXT_IDS.length} non-text rows covered`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
