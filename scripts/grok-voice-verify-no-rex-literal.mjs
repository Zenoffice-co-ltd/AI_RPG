#!/usr/bin/env node
/**
 * CI gate — fail if any "rex" voice literal survives in runtime source
 * or generated registered-speech artifacts.
 *
 * The Haruto hotfix (PR-94) bumped the registered-speech voice from
 * "rex" to "99c95cc8a177". The schema literal at
 * apps/web/lib/roleplay/registered-speech/types.ts already enforces
 * this on the artifact bundle, but the project also has hardcoded
 * voiceId strings scattered across:
 *   - apps/web/apphosting.yaml env
 *   - test harness session builders (apps/web/scripts/...)
 *   - the build script itself
 *   - any newly generated v1 / v1.candidate manifest files
 *
 * Catching a stray "rex" here prevents the partial-state regression
 * where one layer is bumped to Haruto and another lags behind ("voiceId
 * mismatch" errors at boot, or worse: a re-build that quietly synthesizes
 * mixed-voice artifacts).
 *
 * Scope is intentionally narrow — past closeout markdown / docs /
 * commit messages legitimately mention "rex" historically.
 *
 * Usage: pnpm grok:verify-no-rex-literal
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SEARCH_ROOTS = [
  "apps/web",
  "scripts",
  "data/generated/registered-speech/v1",
  "data/generated/registered-speech/v1.candidate",
];

// Skip large machine-generated trees the repo carries inside apps/web.
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  ".vercel",
  ".cache",
]);

// scripts/ alone is too broad; restrict to grok-voice-build-/-verify-/
// -promote-/-registered-speech- scripts. The legacy v2.1 E2E scripts
// (grok-voice-v21-*) and the older pre-deterministic audio-path
// harness predate the Verified Audio Artifact pipeline and use
// `"rex"` as their default voice — a legitimate non-registered-speech
// runtime path that this gate intentionally ignores.
const SCOPED_SCRIPT_PREFIXES = [
  "grok-voice-build-registered-speech",
  "grok-voice-verify-registered-speech",
  "grok-voice-verify-no-rex-literal",
  "grok-voice-promote-registered-speech",
  "grok-voice-registered-speech",
];

const PATTERNS = [
  // YAML / env style: voice_id: "rex" or value: "rex" near voice id.
  /value:\s*"rex"/i,
  // env-name pattern: GROK_VOICE_VOICE_ID = rex (any quoting)
  /GROK_VOICE_VOICE_ID[^\n]*\brex\b/i,
  // schema literal regression
  /z\.literal\("rex"\)/,
  // bundled-artifact / manifest assignments — these are the load-bearing
  // ones. A `voiceId: "rex"` survives only if a registered-speech-typed
  // structure was constructed (test fixtures using free-form `voiceId`
  // params for TTS cache lookups are still scoped out by the file
  // filter below).
  /voiceId:\s*"rex"/,
  /grokVoiceVoiceId:\s*"rex"/,
  // JSON-style key (quoted). Catches the promoted manifest at
  // data/generated/registered-speech/v1/manifest.json — that file is
  // expected to fail this gate until the operator runs
  // `pnpm grok:build-registered-speech` + `pnpm grok:promote-registered-speech`
  // (which rewrites it from REGISTERED_SPEECH_VOICE_ID).
  /"voiceId":\s*"rex"/,
];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".json",
  ".yaml",
  ".yml",
]);

/** @type {Array<{ file: string; line: number; preview: string; pattern: string }>} */
const hits = [];

function shouldVisitFile(absPath, root) {
  const ext = absPath.slice(absPath.lastIndexOf("."));
  if (!TEXT_EXTENSIONS.has(ext)) return false;
  // For scripts/ root, restrict to the registered-speech-related
  // scripts. Legacy v2.1 / pre-deterministic harnesses are ignored —
  // they predate the Verified Audio Artifact pipeline.
  if (root === "scripts") {
    const baseName = absPath.split(/[\\/]/).pop() ?? "";
    if (!SCOPED_SCRIPT_PREFIXES.some((p) => baseName.startsWith(p))) {
      return false;
    }
  }
  // Skip the gate's own file (we mention "rex" in its own commentary).
  if (absPath.endsWith("grok-voice-verify-no-rex-literal.mjs")) return false;
  // Skip the older non-registered-speech audio-path harness; it uses
  // the legacy locked-audio bundle path with a free-form voiceId.
  if (absPath.endsWith("grok-voice-audio-path-e2e.ts")) return false;
  // Skip test files. The schema literal in types.ts already enforces
  // the registered-speech-bundle regression at compile time — any
  // surviving "rex" in a test file is necessarily a free-form voiceId
  // used as a TTS cache key parameter (not a RegisteredSpeechBundle).
  if (/\.test\.(ts|tsx|mts)$/.test(absPath)) return false;
  return true;
}

function scanFile(absPath) {
  let raw;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return; // unreadable / binary
  }
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pat of PATTERNS) {
      if (pat.test(line)) {
        hits.push({
          file: absPath,
          line: i + 1,
          preview: line.length > 200 ? line.slice(0, 200) + "…" : line,
          pattern: pat.toString(),
        });
        break;
      }
    }
  }
}

function walk(absDir, root) {
  let dirents;
  try {
    dirents = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of dirents) {
    if (SKIP_DIRS.has(name)) continue;
    const child = join(absDir, name);
    let st;
    try {
      st = statSync(child);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(child, root);
    } else if (st.isFile() && shouldVisitFile(child, root)) {
      scanFile(child);
    }
  }
}

for (const root of SEARCH_ROOTS) {
  const abs = resolve(REPO_ROOT, root);
  walk(abs, root);
}

const summary = {
  scope: "grokVoice.registeredSpeech.verifyNoRexLiteral",
  searchRoots: SEARCH_ROOTS,
  hits,
  hitCount: hits.length,
  ok: hits.length === 0,
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) {
  console.error(
    `\n[verify-no-rex-literal] FAIL: ${hits.length} stray "rex" literal(s) found.\n` +
      `Replace with REGISTERED_SPEECH_VOICE_ID (or "99c95cc8a177" in YAML/JSON).`
  );
  process.exit(1);
}
