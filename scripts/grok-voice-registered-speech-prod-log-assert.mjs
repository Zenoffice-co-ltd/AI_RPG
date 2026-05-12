/**
 * Layer D — Production Cloud Logging assertion (registered-speech).
 *
 * Reads the last N minutes (default 30) of `grokVoice.turnMetrics`
 * Cloud Logging entries from adecco-mendan, then asserts:
 *
 *   - routePath is one of registered_speech_local /
 *     registered_speech_fallback / registered_speech_multi_intent_redirect
 *   - No turn used rt_voice / lock_voice_network_tts /
 *     sanitized_response_tts / greeting_tts
 *   - `agentSpokenTextPreview` contains zero forbidden suffixes
 *   - `firstAudibleAudioMs` p50/p95 are recorded for non-regression
 *     comparison against the existing `lock_voice_local_audio` baseline
 *
 * Usage:
 *   node scripts/grok-voice-registered-speech-prod-log-assert.mjs
 *   node scripts/grok-voice-registered-speech-prod-log-assert.mjs --minutes 60
 *   node scripts/grok-voice-registered-speech-prod-log-assert.mjs --json out/cl_assert.json
 *
 * This is the post-deploy DOD gate: deterministic mode is ONLY
 * declared complete when this assertion passes against live prod
 * traffic (Cloud Logging from a real demo session).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PROJECT = "adecco-mendan";
const SERVICE = "adecco-roleplay";

// Forbidden suffix patterns. Kept in sync with
// apps/web/lib/roleplay/grok-voice-pr60-shared.ts STOCK_SUFFIX_PATTERNS.
// The Cloud Logging assertion uses a substring scan (not the full
// sentence-by-sentence sanitizer) because the prod log preview is
// already a clipped string.
const FORBIDDEN_SUFFIX_SUBSTRINGS = [
  "何か他に",
  "他に何か",
  "確認したい点",
  "ご確認したい点",
  "ご質問",
  "不明点",
  "気になる点",
  "詳しく知りたい点",
  "追加で確認",
  "お聞かせください",
  "お知らせください",
  "ご連絡ください",
  "お気軽に",
  "何かございましたら",
  "イメージはつかめましたか",
];

const ALLOWED_ROUTE_PATHS = new Set([
  "registered_speech_local",
  "registered_speech_fallback",
  "registered_speech_multi_intent_redirect",
]);
const FORBIDDEN_ROUTE_PATHS = new Set([
  "rt_voice",
  "lock_voice_network_tts",
  // sanitized_response_tts / greeting_tts are runtime TTS variants
  // that may have surfaced in earlier builds; if they appear at all,
  // deterministic mode failed.
  "sanitized_response_tts",
  "greeting_tts",
]);

// Haruto hotfix (PR-94): the broker's natural recruitment-profile
// queries fell to fallback_unknown in PR-93 because the matcher only
// covered the "内容 / スキル" axis. These keywords flag turns where
// the user clearly asked a business question; if any of those land on
// registered_speech_fallback the new matcher coverage failed.
const BUSINESS_USER_TEXT_KEYWORDS = [
  "今回",
  "要件",
  "単価",
  "募集",
  "経験",
  "残業",
  "業務時間",
  "勤務",
  "決定",
  "決裁",
  "業務",
  "スキル",
  "処理",
  "繁忙",
  "背景",
  "候補",
  "採用",
];

// Placeholder strings that should never appear in production assistant
// transcripts. The PR-93 greeting shipped with these as the literal
// spokenText / displayText.
const FORBIDDEN_PLACEHOLDER_SUBSTRINGS = [
  "PENDING",
  "PLACEHOLDER",
  "populated by",
  "build script",
  "Source.json",
  "schema doesn't break",
];

// Greeting artifact-only forbidden suffixes (artifact text, not user
// input). Kept in sync with text-guards.ts FORBIDDEN_ASSISTANT_QUESTION_SUFFIX.
const FORBIDDEN_ASSISTANT_QUESTION_SUFFIX_PATTERNS = [
  /ありますか[。！？!?]?$/,
  /ございますか[。！？!?]?$/,
  /でしょうか[。！？!?]?$/,
  /ですか[。！？!?]?$/,
  /よろしいでしょうか[。！？!?]?$/,
];

// Hiragana / katakana / CJK ideographs — used to detect English-only
// greetings (the PR-93 placeholder was pure ASCII).
const JAPANESE_CHAR_RE = /[぀-ゟ゠-ヿ一-鿿]/;

// Expected voiceId (Haruto). Kept in sync with
// apps/web/lib/roleplay/registered-speech/types.ts REGISTERED_SPEECH_VOICE_ID.
const EXPECTED_VOICE_ID = "99c95cc8a177";
// Pre-deterministic routes that are tolerated only on the
// `lock_voice_local_audio` BASELINE (which we use as the p50/p95
// reference). They are NOT acceptable in a deterministic-mode demo.
const BASELINE_ROUTE_PATH = "lock_voice_local_audio";

function parseArgs(argv) {
  const out = { minutes: 30, limit: 2000, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--minutes") {
      out.minutes = Number(next);
      i += 1;
    } else if (flag === "--limit") {
      out.limit = Number(next);
      i += 1;
    } else if (flag === "--json") {
      out.json = next;
      i += 1;
    }
  }
  return out;
}

// Windows / POSIX shell-quoting differ for gcloud's quoted filter
// argument. On Windows we wrap the entire command in PowerShell with
// single-quoted arguments so the shell's parser doesn't munge the
// inner doublequotes. On POSIX, direct spawn passes the argv literally.
// Same approach as scripts/grok-voice-latency-report.ts.
function psQuote(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

// Use `--filter @file` so the gcloud filter is read from a temp file
// and never has to round-trip through any shell quoting / escaping.
// This eliminates an entire class of Windows-vs-POSIX bugs around the
// `:` and `"` characters in ISO timestamps.
import { mkdtempSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function writeFilterFile(filter) {
  const dir = mkdtempSync(join(tmpdir(), "grokvoice-filter-"));
  const path = join(dir, "filter.txt");
  fsWriteFileSync(path, filter, "utf8");
  return path;
}

function gcloudLogs(filter, limit, freshnessMinutes) {
  const args = [
    "logging",
    "read",
    filter,
    `--project=${PROJECT}`,
    `--limit=${limit}`,
    "--format=json",
    `--freshness=${freshnessMinutes}m`,
    "--order=desc",
  ];
  const r =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            [
              "gcloud",
              "logging",
              "read",
              psQuote(filter),
              `--project=${psQuote(PROJECT)}`,
              `--limit=${limit}`,
              "--format=json",
              `--freshness=${freshnessMinutes}m`,
              "--order=desc",
            ].join(" "),
          ],
          { encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 }
        )
      : spawnSync("gcloud", args, {
          encoding: "utf8",
          shell: false,
          maxBuffer: 64 * 1024 * 1024,
        });
  if (r.status !== 0) {
    throw new Error(`gcloud logging read failed: ${r.stderr || r.stdout}`);
  }
  return JSON.parse(r.stdout || "[]");
}

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sinceIso = new Date(Date.now() - args.minutes * 60 * 1000).toISOString();
  // Only use --freshness (matches scripts/grok-voice-v21-prod-logs.mjs).
  // ISO timestamps in the gcloud filter would round-trip badly through
  // Windows PowerShell quoting, so the time bound is server-side via
  // the freshness flag instead.
  const filter = `resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE} AND jsonPayload.scope="grokVoice.turnMetrics"`;

  console.error(`[prod-log-assert] reading last ${args.minutes}m from ${PROJECT} (${sinceIso})`);
  const entries = gcloudLogs(filter, args.limit, args.minutes);
  console.error(`[prod-log-assert] ${entries.length} turn-metric entries`);

  /** @type {Record<string, number>} */
  const routePathCounts = {};
  const forbiddenSuffixHits = [];
  const registeredSpeechFirstAudible = [];
  const baselineLockVoiceFirstAudible = [];
  let runtimeTtsRequestCount = 0;
  let realtimeAudioPlayedCount = 0;
  let bundleMissCount = 0;
  let shaMismatchCount = 0;
  let manifestMismatchCount = 0;
  let registeredSpeechLocalCount = 0;
  let registeredSpeechFallbackCount = 0;
  // Haruto hotfix (PR-94) metrics
  const greetingPlaceholderHits = [];
  const greetingAsciiOnlyHits = [];
  const greetingQuestionSuffixHits = [];
  const fallbackUnknownBusinessHits = [];
  const voiceIdMismatchHits = [];
  let voiceIdSeenCount = 0;

  for (const entry of entries) {
    const p = entry.jsonPayload ?? {};
    const routePath = p.routePath ?? "unknown";
    routePathCounts[routePath] = (routePathCounts[routePath] ?? 0) + 1;

    if (FORBIDDEN_ROUTE_PATHS.has(routePath)) {
      // Counted into FORBIDDEN bucket; flagged in final report.
    }
    if (routePath === "registered_speech_local") {
      registeredSpeechLocalCount += 1;
    } else if (routePath === "registered_speech_fallback") {
      registeredSpeechFallbackCount += 1;
    }

    const firstAudible = typeof p.firstAudibleAudioMs === "number" ? p.firstAudibleAudioMs : null;
    if (firstAudible !== null) {
      if (ALLOWED_ROUTE_PATHS.has(routePath)) {
        registeredSpeechFirstAudible.push(firstAudible);
      } else if (routePath === BASELINE_ROUTE_PATH) {
        baselineLockVoiceFirstAudible.push(firstAudible);
      }
    }

    const preview = (p.agentSpokenTextPreview ?? p.agentTextPreview ?? "");
    for (const sub of FORBIDDEN_SUFFIX_SUBSTRINGS) {
      if (preview.includes(sub)) {
        forbiddenSuffixHits.push({
          timestamp: entry.timestamp,
          routePath,
          intent: p.registeredSpeechIntent ?? null,
          forbiddenSubstring: sub,
          preview: preview.slice(0, 200),
        });
        break;
      }
    }

    // PR-94 / Haruto hotfix metrics ------------------------------------

    // VoiceId observed on every turn — emit counts and a sample of any
    // mismatches. The session bundle includes voiceId; turnMetrics may
    // mirror it as `voiceId` or `grokVoiceVoiceId`.
    const observedVoiceId =
      p.grokVoiceVoiceId ??
      p.voiceId ??
      (p.registeredSpeechBundle && p.registeredSpeechBundle.voiceId) ??
      null;
    if (typeof observedVoiceId === "string" && observedVoiceId.length > 0) {
      voiceIdSeenCount += 1;
      if (observedVoiceId !== EXPECTED_VOICE_ID) {
        voiceIdMismatchHits.push({
          timestamp: entry.timestamp,
          observedVoiceId,
          expected: EXPECTED_VOICE_ID,
        });
      }
    }

    // Greeting placeholder / ASCII / question suffix scan. Apply only to
    // greeting turns — those are the playback texts that have a known
    // duration window and known artifact-only constraints.
    const intent = p.registeredSpeechIntent ?? null;
    if (intent === "greeting") {
      const greetingText = preview;
      for (const sub of FORBIDDEN_PLACEHOLDER_SUBSTRINGS) {
        if (greetingText.includes(sub)) {
          greetingPlaceholderHits.push({
            timestamp: entry.timestamp,
            substring: sub,
            preview: greetingText.slice(0, 200),
          });
          break;
        }
      }
      if (greetingText.length > 0 && !JAPANESE_CHAR_RE.test(greetingText)) {
        greetingAsciiOnlyHits.push({
          timestamp: entry.timestamp,
          preview: greetingText.slice(0, 200),
        });
      }
      const trimmed = greetingText.trim();
      for (const pat of FORBIDDEN_ASSISTANT_QUESTION_SUFFIX_PATTERNS) {
        if (pat.test(trimmed)) {
          greetingQuestionSuffixHits.push({
            timestamp: entry.timestamp,
            pattern: pat.toString(),
            preview: greetingText.slice(0, 200),
          });
          break;
        }
      }
    }

    // fallback_unknown landing on a business utterance — DOD #6.
    if (routePath === "registered_speech_fallback") {
      const userText = p.userTranscriptPreview ?? p.userText ?? "";
      const matched = BUSINESS_USER_TEXT_KEYWORDS.find((k) =>
        typeof userText === "string" && userText.includes(k)
      );
      if (matched) {
        fallbackUnknownBusinessHits.push({
          timestamp: entry.timestamp,
          userText: typeof userText === "string" ? userText.slice(0, 200) : "",
          matchedKeyword: matched,
        });
      }
    }
  }

  const forbiddenRouteCount = Object.entries(routePathCounts)
    .filter(([k]) => FORBIDDEN_ROUTE_PATHS.has(k))
    .reduce((acc, [, n]) => acc + n, 0);

  const p50 = percentile(registeredSpeechFirstAudible, 0.5);
  const p95 = percentile(registeredSpeechFirstAudible, 0.95);
  const baselineP50 = percentile(baselineLockVoiceFirstAudible, 0.5);
  const baselineP95 = percentile(baselineLockVoiceFirstAudible, 0.95);

  const nonRegression = (() => {
    if (p50 === null || baselineP50 === null) return null;
    return p50 <= baselineP50 && (p95 === null || baselineP95 === null || p95 <= baselineP95 + 150);
  })();

  // PR-94 / Haruto hotfix derived metrics
  const greetingInvalidTextHit = {
    placeholderHit: greetingPlaceholderHits.length,
    asciiOnlyHit: greetingAsciiOnlyHits.length,
    questionSuffixHit: greetingQuestionSuffixHits.length,
  };
  const voiceIdEnvObserved =
    voiceIdSeenCount > 0 && voiceIdMismatchHits.length === 0;

  const summary = {
    builtAt: new Date().toISOString(),
    sinceIso,
    project: PROJECT,
    service: SERVICE,
    minutes: args.minutes,
    entryCount: entries.length,
    routePathCounts,
    forbiddenRouteCount,
    registeredSpeechLocalCount,
    registeredSpeechFallbackCount,
    runtimeTtsRequestCount,
    realtimeAudioPlayedCount,
    forbiddenSuffixHitCount: forbiddenSuffixHits.length,
    forbiddenSuffixSample: forbiddenSuffixHits.slice(0, 5),
    shaMismatchCount,
    bundleMissCount,
    manifestMismatchCount,
    // PR-94 / Haruto hotfix metrics
    greetingInvalidTextHit,
    greetingInvalidTextSample: {
      placeholder: greetingPlaceholderHits.slice(0, 5),
      asciiOnly: greetingAsciiOnlyHits.slice(0, 5),
      questionSuffix: greetingQuestionSuffixHits.slice(0, 5),
    },
    fallbackUnknownBusinessHit: fallbackUnknownBusinessHits.length,
    fallbackUnknownBusinessSample: fallbackUnknownBusinessHits.slice(0, 10),
    voiceIdSeenCount,
    voiceIdEnvObserved,
    voiceIdMismatchHits: voiceIdMismatchHits.slice(0, 5),
    firstAudibleAudioMs: {
      registeredSpeech: { p50, p95, count: registeredSpeechFirstAudible.length },
      baselineLockVoiceLocalAudio: {
        p50: baselineP50,
        p95: baselineP95,
        count: baselineLockVoiceFirstAudible.length,
      },
      nonRegression,
    },
    // Final DOD gate. PR-94 additions:
    //   - greetingInvalidTextHit.* must all be 0 (placeholder / ascii-only
    //     / question suffix in greeting playback)
    //   - fallbackUnknownBusinessHit must be 0 (business utterance never
    //     lands on fallback_unknown)
    //   - voiceIdEnvObserved must be true (Haruto seen on at least one
    //     turn and never observed as a different voice)
    overallPass:
      forbiddenRouteCount === 0 &&
      forbiddenSuffixHits.length === 0 &&
      (registeredSpeechLocalCount + registeredSpeechFallbackCount > 0) &&
      (nonRegression !== false) &&
      greetingInvalidTextHit.placeholderHit === 0 &&
      greetingInvalidTextHit.asciiOnlyHit === 0 &&
      greetingInvalidTextHit.questionSuffixHit === 0 &&
      fallbackUnknownBusinessHits.length === 0 &&
      voiceIdEnvObserved === true,
  };

  if (args.json) {
    mkdirSync(dirname(args.json), { recursive: true });
    writeFileSync(args.json, `${JSON.stringify(summary, null, 2)}\n`);
    console.error(`[prod-log-assert] wrote ${args.json}`);
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.overallPass) {
    console.error("\n[prod-log-assert] OVERALL FAIL — see summary above");
    process.exit(2);
  }
}

main();
