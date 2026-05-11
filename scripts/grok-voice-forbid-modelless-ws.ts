// Static-analysis gate enforced by CI. The build pipeline pins the
// WebSocket URL via `buildGrokRealtimeWsUrl(...)` in one location; this
// script ensures no other call site emits the bare `wss://api.x.ai/v1
// /realtime` form (which xAI documents as falling back to the legacy
// `grok-voice-fast-1.0` model). Reaching this script's exit-code 1 is
// the CI signal that a regression slipped in.
//
// Scope: `apps/web/**`. The WS URL builder file is the only allowed
// match (it owns the constant).

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(currentDir, "..");

function rg(args: string[]): string {
  const result = spawnSync("rg", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  // rg returns 1 when no matches; we only treat 2+ as a tool error.
  if (result.status !== null && result.status > 1) {
    throw new Error(`rg failed: status=${result.status} stderr=${result.stderr}`);
  }
  return result.stdout ?? "";
}

const ALLOWED_FILE = "apps/web/lib/roleplay/grok-voice-ws-url.ts";

// Catch any literal `wss://api.x.ai/v1/realtime` that isn't immediately
// followed by `?model=` (a bare connection / template fragment).
const BARE_PATTERN = String.raw`wss:\/\/api\.x\.ai\/v1\/realtime(?![?])`;

const stdout = rg(["-n", "--type", "ts", "--glob", "apps/web/**", BARE_PATTERN]);
const offenders = stdout
  .split("\n")
  .filter((line) => line.length > 0)
  .filter((line) => !line.startsWith(ALLOWED_FILE));

if (offenders.length > 0) {
  console.error(
    "[forbid-modelless-ws] found bare wss://api.x.ai/v1/realtime references:"
  );
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}
console.log(
  JSON.stringify(
    { scope: "grokVoice.forbidModellessWs", ok: true, offenders: 0 },
    null,
    2
  )
);
