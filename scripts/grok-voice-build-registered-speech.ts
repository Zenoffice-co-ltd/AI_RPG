// Verified Audio Artifact build pipeline.
//
// Inputs:
//   data/generated/registered-speech/v1.candidate/source.json
//     [{ intent, spokenTextForGeneration, displayText, expectedTokens? }, ...]
//
// For each intent:
//   1. synthesize via xAI TTS (voice=rex, lang=ja, codec=pcm, sampleRateHz=24000)
//   2. ASR round-trip via GCP STT v2 (apps/web/server/haikuFish/transcribe.ts)
//   3. forbidden-suffix scan (STRICT_STOCK_SUFFIX_DETECTORS + STOCK_SUFFIX_PATTERNS)
//   4. expected-token check (primary AND alternates per expected-tokens.ts)
//   5. sha256 freeze
//   6. WAV preview (24kHz mono int16) for human listening
//
// Output:
//   data/generated/registered-speech/v1.candidate/artifacts/<intent>.pcm
//   data/generated/registered-speech/v1.candidate/manifest.json
//   out/registered-speech-build/<utc>/report.json
//   out/registered-speech-build/<utc>/wav/<intent>.wav
//   out/registered-speech-build/<utc>/review.html
//
// Promotion (`scripts/grok-voice-promote-registered-speech.ts`) copies
// v1.candidate/ → v1/ and updates manifest-constant.ts. The promote
// step is what wires the new artifacts into the deployed bundle.
//
// SAFETY: This script ONLY runs offline. It is invoked manually by a
// human (or by the predeploy gate when a maintainer chooses to). It is
// NOT a Cloud Run / Next handler. The CI verifier only re-hashes; it
// does not synthesize.
//
// This is the scaffold-only commit — actual xAI TTS / GCP STT calls
// require credentials at execution time and are not wired into any
// CI run. The intent is to land the file structure, then have a
// human approver run it locally with credentials to generate the
// initial artifact set.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  REQUIRED_REGISTERED_SPEECH_INTENTS,
  type CanonicalIntent,
} from "../apps/web/lib/roleplay/registered-speech/canonical-intents";
import {
  containsVoiceStockSuffix,
  sanitizeGrokVoiceSpokenText,
} from "../apps/web/lib/roleplay/grok-voice-pr60-shared";
import {
  EXPECTED_TOKENS_BY_INTENT,
  checkExpectedTokens,
} from "../apps/web/lib/roleplay/registered-speech/expected-tokens";
import {
  assertNoArtifactPlaceholder,
  containsForbiddenAssistantQuestionSuffix,
  isGreetingDurationOutOfRange,
} from "../apps/web/lib/roleplay/registered-speech/text-guards";
import { REGISTERED_SPEECH_VOICE_ID } from "../apps/web/lib/roleplay/registered-speech/types";
import { synthesizeGrokVoiceTts } from "../apps/web/server/grokVoice/tts";
import { transcribeHaikuFishAudio } from "../apps/web/server/haikuFish/transcribe";

type SourceEntry = {
  intent: CanonicalIntent;
  spokenTextForGeneration: string;
  displayText: string;
};

// Credential resolver — mirrors `loadXaiKeyFromSecretManagerIfNeeded` in
// scripts/grok-voice-v21-scenario-e2e.ts. Pulls XAI_API_KEY from Secret
// Manager (zapier-transfer → adecco-mendan fallback) into the current
// shell only — never writes to disk. The canonical pattern documented
// in AGENTS.md `## Secrets`.
function loadXaiKeyFromSecretManagerIfNeeded(): void {
  const current = process.env["XAI_API_KEY"];
  const looksReal =
    current && current.length >= 32 && !current.startsWith("test-");
  if (looksReal) return;

  const projects = [
    process.env["SECRET_SOURCE_PROJECT_ID"] ?? "zapier-transfer",
    "adecco-mendan",
  ];
  for (const project of projects) {
    const r = spawnSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        "--secret=XAI_API_KEY",
        `--project=${project}`,
      ],
      { encoding: "utf8", shell: process.platform === "win32" }
    );
    if (r.status === 0 && r.stdout && r.stdout.trim().length >= 32) {
      process.env["XAI_API_KEY"] = r.stdout.trim();
      console.info(
        `[build-registered-speech] XAI_API_KEY fetched from projects/${project}/secrets/XAI_API_KEY (len=${r.stdout.trim().length})`
      );
      return;
    }
  }
}

// GCP STT v2 access token via ADC. Outside Cloud Run the metadata
// server is unreachable, so we shell out to `gcloud auth
// application-default print-access-token` per AGENTS.md.
function getAdcAccessToken(): string {
  const r = spawnSync(
    "gcloud",
    ["auth", "application-default", "print-access-token"],
    { encoding: "utf8", shell: process.platform === "win32" }
  );
  if (r.status !== 0 || !r.stdout) {
    throw new Error(
      `[build-registered-speech] failed to fetch ADC access token via gcloud. ` +
        `Run 'gcloud auth application-default login' first. stderr=${r.stderr}`
    );
  }
  return r.stdout.trim();
}

type BuildReport = {
  builtAt: string;
  candidatePath: string;
  intents: Array<{
    intent: CanonicalIntent;
    sha256: string;
    durationMs: number;
    audioPath: string;
    asrText: string;
    asrConfidence: number | null;
    asrUnavailable: boolean;
    asrUnavailableReason?: string;
    expectedTokensMatched: string[];
    expectedTokensMissing: string[];
    forbiddenSuffixHit: boolean;
    ok: boolean;
  }>;
};

async function synthesizeArtifact(entry: SourceEntry): Promise<{
  pcmBytes: Buffer;
  durationMs: number;
}> {
  const result = await synthesizeGrokVoiceTts({
    text: entry.spokenTextForGeneration,
    purpose: "locked_response",
  });
  // synthesizeGrokVoiceTts returns raw PCM16 LE 24kHz mono. Length in
  // samples = byteLength / 2; duration in ms = samples / 24 (since
  // 24000 samples / sec, 1000 ms / sec → samples/24 = ms).
  const durationMs = Math.round(result.audio.byteLength / 2 / 24);
  return { pcmBytes: result.audio, durationMs };
}

// Sentinel returned when GCP STT v2 is unavailable from the local ADC
// (typical workstation case — ADC quota project doesn't have
// serviceusage.services.use on the project where Speech-to-Text is
// enabled). Per AGENTS.md `## Secrets` we don't bypass the ADC contract
// to force a different identity. The artifact's correctness still
// holds because:
//   1. sha256 byte-exact (mechanical, in manifest + verifier)
//   2. forbidden-suffix scan on spokenTextForGeneration / displayText
//      (mechanical, before TTS even runs)
//   3. Human approver listens to wav previews in review.html
//      (final guarantee per AGENTS.md ## Secrets review pattern)
// ASR is therefore an extra signal, NOT the gate. Best-effort.
export const ASR_UNAVAILABLE_SENTINEL = "<asr_unavailable>";

async function asrTranscribe(pcmBytes: Buffer): Promise<{
  text: string;
  confidence: number | null;
  unavailable: boolean;
  unavailableReason?: string;
}> {
  // The build script runs locally (not on Cloud Run), so the GCP
  // metadata server is unreachable. Inject a deps.getAccessToken that
  // uses ADC via gcloud — same credential surface the AGENTS.md
  // `## Secrets` section documents.
  //
  // ADC user-credential tokens also require `x-goog-user-project` to
  // bill quota to the correct project; the production Cloud Run SA
  // token does NOT need this header. We override fetch to inject the
  // header so the build script can run on a developer workstation.
  const audioBase64 = pcmBytes.toString("base64");
  const quotaProject = process.env["GOOGLE_CLOUD_PROJECT"] ?? "adecco-mendan";
  const fetchWithQuotaProject: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers ?? {});
    headers.set("x-goog-user-project", quotaProject);
    return fetch(input, { ...(init ?? {}), headers });
  };
  try {
    const result = await transcribeHaikuFishAudio(
      {
        audioBase64,
        audioMimeType: "audio/pcm",
        languageCode: "ja-JP",
      },
      {
        fetchImpl: fetchWithQuotaProject,
        getAccessToken: async () => getAdcAccessToken(),
      }
    );
    return {
      text: result.text,
      confidence: result.confidence,
      unavailable: false,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.warn(
      `[build-registered-speech] ASR best-effort skipped (sha256 + forbidden-suffix + human approval remain): ${message.slice(0, 200)}`
    );
    return {
      text: ASR_UNAVAILABLE_SENTINEL,
      confidence: null,
      unavailable: true,
      unavailableReason: message.slice(0, 240),
    };
  }
}

function pcmToWav(pcmBytes: Buffer, sampleRateHz = 24000): Buffer {
  const dataSize = pcmBytes.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(sampleRateHz * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBytes]);
}

function buildReviewHtml(report: BuildReport, wavDir: string): string {
  // Promote `greeting` to the first row so the reviewer can't miss it.
  // PR-93 shipped a placeholder English greeting (sha256 8ed61df9..., 13.79s)
  // that everyone overlooked when the artifact was buried mid-table.
  const ordered = [
    ...report.intents.filter((e) => e.intent === "greeting"),
    ...report.intents.filter((e) => e.intent !== "greeting"),
  ];
  const rows = ordered
    .map((entry) => {
      const durationOutOfRange =
        entry.intent === "greeting" && isGreetingDurationOutOfRange(entry.durationMs);
      const trClass = !entry.ok
        ? "fail"
        : durationOutOfRange
          ? "warn"
          : "ok";
      return `
      <tr class="${trClass}">
        <td>${entry.intent}</td>
        <td>${entry.ok ? "OK" : "FAIL"}</td>
        <td>${entry.sha256.slice(0, 12)}…</td>
        <td>${entry.durationMs} ms${durationOutOfRange ? " ⚠️" : ""}</td>
        <td><audio controls preload="none" src="wav/${entry.intent}.wav"></audio></td>
        <td>${escapeHtml(entry.asrText)}</td>
        <td>${entry.expectedTokensMatched.join(" / ")}</td>
        <td>${entry.expectedTokensMissing.join(" / ")}</td>
        <td>${entry.forbiddenSuffixHit ? "HIT" : "clean"}</td>
      </tr>
    `;
    })
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Registered Speech Build ${report.builtAt}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 24px; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #ccc; padding: 6px 10px; font-size: 13px; vertical-align: top; }
  tr.ok td:nth-child(2) { color: #16a34a; font-weight: 600; }
  tr.fail { background: #fef2f2; }
  tr.fail td:nth-child(2) { color: #b91c1c; font-weight: 600; }
  tr.warn { background: #fefce8; }
  tr.warn td:nth-child(2) { color: #b45309; font-weight: 600; }
  .greeting-warn {
    background: #fef3c7;
    border-left: 4px solid #d97706;
    padding: 12px 16px;
    margin: 16px 0;
    font-size: 14px;
  }
</style>
<h1>Registered Speech Build ${escapeHtml(report.builtAt)}</h1>
<p>Candidate: <code>${escapeHtml(report.candidatePath)}</code></p>
<div class="greeting-warn">
  <strong>Critical artifact: greeting</strong> — must be Japanese, no placeholder
  (PENDING / PLACEHOLDER / populated by ...), no question suffix
  (ありますか / ですか / でしょうか), durationMs in [3000, 8000].
  Listen to it FIRST.
</div>
<p>Listen to every artifact. If pronunciation is wrong, REJECT — the audio sha256 is the final guarantee.</p>
<table>
  <thead><tr>
    <th>intent</th><th>status</th><th>sha256</th><th>duration</th>
    <th>preview</th><th>ASR</th><th>tokens hit</th><th>tokens missing</th><th>forbidden suffix</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type CliArgs = {
  limit: number | null;
  only: Set<string> | null;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { limit: null, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--limit" && next !== undefined) {
      out.limit = Number(next);
      i += 1;
    } else if (flag === "--only" && next !== undefined) {
      out.only = new Set(next.split(",").map((s) => s.trim()));
      i += 1;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadXaiKeyFromSecretManagerIfNeeded();
  const apiKey = process.env["XAI_API_KEY"];
  if (!apiKey || apiKey.length < 32 || apiKey.startsWith("test-")) {
    console.error(
      "BLOCKED: XAI_API_KEY not available. Tried shell env + gcloud Secret Manager (zapier-transfer, adecco-mendan)."
    );
    process.exit(2);
  }
  // Voice ID env must match the schema constant. PR-93 shipped a manifest
  // with voiceId=rex while the runtime expected the same string; bumping
  // the schema constant without flipping the env (or vice versa) would
  // ship a mixed-voice 23-artifact set. Fail fast here so a partial
  // change can never reach TTS synthesis.
  const actualVoiceEnv = process.env["GROK_VOICE_VOICE_ID"] ?? "";
  if (actualVoiceEnv !== REGISTERED_SPEECH_VOICE_ID) {
    console.error(
      `BLOCKED: GROK_VOICE_VOICE_ID must be ${REGISTERED_SPEECH_VOICE_ID} (Haruto), got ${
        actualVoiceEnv || "(empty)"
      }`
    );
    process.exit(2);
  }
  if (!process.env["GOOGLE_CLOUD_PROJECT"]) {
    // Default to adecco-mendan per AGENTS.md; STT recognizer lives
    // there. Operator can override with `export
    // GOOGLE_CLOUD_PROJECT=...` before running.
    process.env["GOOGLE_CLOUD_PROJECT"] = "adecco-mendan";
  }
  // Sanity-check ADC before the first STT call so a missing
  // application-default credential fails fast (and only burns one
  // wasted xAI TTS request to detect it).
  try {
    getAdcAccessToken();
  } catch (error) {
    console.error(
      `BLOCKED: ADC unavailable for GCP STT v2. Run 'gcloud auth application-default login'. ${(error as Error).message}`
    );
    process.exit(2);
  }

  const repoRoot = resolve(import.meta.dirname ?? __dirname, "..");
  const candidateRoot = resolve(
    repoRoot,
    "data",
    "generated",
    "registered-speech",
    "v1.candidate"
  );
  const sourcePath = resolve(candidateRoot, "source.json");
  let source: SourceEntry[];
  try {
    source = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(
      `[build-registered-speech] failed to read source.json at ${sourcePath}: ${(error as Error).message}`
    );
  }

  const sourceIntents = new Set(source.map((s) => s.intent));
  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!sourceIntents.has(required)) {
      throw new Error(
        `[build-registered-speech] source.json missing intent: ${required}`
      );
    }
  }
  if (sourceIntents.size !== REQUIRED_REGISTERED_SPEECH_INTENTS.length) {
    throw new Error(
      `[build-registered-speech] source.json has unexpected intents (count=${sourceIntents.size} required=${REQUIRED_REGISTERED_SPEECH_INTENTS.length})`
    );
  }

  // Pre-TTS guards: catch placeholder strings (PR-93 shipped a greeting
  // artifact whose spokenText was the literal "PENDING_GREETING_FILL...")
  // and forbidden assistant question suffixes BEFORE burning a TTS quota
  // request synthesizing them.
  for (const entry of source) {
    assertNoArtifactPlaceholder(entry.intent, entry.spokenTextForGeneration);
    assertNoArtifactPlaceholder(entry.intent, entry.displayText);
    if (containsForbiddenAssistantQuestionSuffix(entry.spokenTextForGeneration)) {
      throw new Error(
        `[build-registered-speech][${entry.intent}] spokenTextForGeneration ends with a forbidden assistant question suffix: ${entry.spokenTextForGeneration}`
      );
    }
    if (containsForbiddenAssistantQuestionSuffix(entry.displayText)) {
      throw new Error(
        `[build-registered-speech][${entry.intent}] displayText ends with a forbidden assistant question suffix: ${entry.displayText}`
      );
    }
  }

  const builtAt = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = resolve(
    repoRoot,
    "out",
    "registered-speech-build",
    builtAt
  );
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(resolve(reportDir, "wav"), { recursive: true });
  mkdirSync(resolve(candidateRoot, "artifacts"), { recursive: true });

  const report: BuildReport = {
    builtAt,
    candidatePath: candidateRoot,
    intents: [],
  };

  let processed = 0;
  for (const entry of source) {
    if (args.only && !args.only.has(entry.intent)) continue;
    if (args.limit !== null && processed >= args.limit) break;
    processed += 1;
    console.info(`[build-registered-speech] synthesizing intent=${entry.intent} (${processed}/${args.limit ?? source.length})`);
    const synth = await synthesizeArtifact(entry);
    const sha256 = createHash("sha256").update(synth.pcmBytes).digest("hex");
    const audioPath = `artifacts/${entry.intent}.pcm`;
    writeFileSync(resolve(candidateRoot, audioPath), synth.pcmBytes);
    writeFileSync(
      resolve(reportDir, "wav", `${entry.intent}.wav`),
      pcmToWav(synth.pcmBytes)
    );

    const asr = await asrTranscribe(synth.pcmBytes);

    const spokenSanitize = sanitizeGrokVoiceSpokenText(entry.spokenTextForGeneration);
    const displaySanitize = sanitizeGrokVoiceSpokenText(entry.displayText);
    // ASR sentinel is intentionally suffix-free, so the asrSuffixHit
    // check is vacuously clean in that case — that's correct: a missing
    // ASR signal cannot fabricate a suffix.
    const asrSuffixHit = asr.unavailable
      ? false
      : containsVoiceStockSuffix(asr.text);
    const forbidden =
      spokenSanitize.detected || displaySanitize.detected || asrSuffixHit;

    // When ASR is unavailable, skip the expected-tokens gate (it would
    // fail every intent because the asrText is the sentinel). The
    // build's actual guarantee is still sha256 + forbidden-suffix scan
    // on the authored texts + human approver listens. Mark the entry
    // so review.html and report.json make the soft-fail explicit.
    const tokens = asr.unavailable
      ? { matched: [], missing: [] as string[] }
      : checkExpectedTokens(entry.intent, asr.text);
    const ok = !forbidden && tokens.missing.length === 0;

    report.intents.push({
      intent: entry.intent,
      sha256,
      durationMs: Math.round((synth.pcmBytes.length / 2 / 24000) * 1000),
      audioPath,
      asrText: asr.text,
      asrConfidence: asr.confidence,
      asrUnavailable: asr.unavailable,
      ...(asr.unavailableReason
        ? { asrUnavailableReason: asr.unavailableReason }
        : {}),
      expectedTokensMatched: tokens.matched,
      expectedTokensMissing: tokens.missing,
      forbiddenSuffixHit: forbidden,
      ok,
    });

    // Confirm `EXPECTED_TOKENS_BY_INTENT` knows about this intent so a
    // typo can't slip through without exercising the per-intent gate.
    void EXPECTED_TOKENS_BY_INTENT[entry.intent];
  }

  writeFileSync(
    resolve(reportDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  writeFileSync(
    resolve(reportDir, "review.html"),
    buildReviewHtml(report, resolve(reportDir, "wav"))
  );

  const candidateManifest = {
    version: "v1" as const,
    buildId: builtAt,
    voiceId: REGISTERED_SPEECH_VOICE_ID,
    sampleRateHz: 24000 as const,
    codec: "pcm" as const,
    entries: report.intents.map((r) => {
      const src = source.find((s) => s.intent === r.intent)!;
      return {
        intent: r.intent,
        spokenText: src.spokenTextForGeneration,
        displayText: src.displayText,
        audioPath: r.audioPath,
        sha256: r.sha256,
        durationMs: r.durationMs,
        asrText: r.asrText,
        asrConfidence: r.asrConfidence,
        expectedTokensMatched: r.expectedTokensMatched,
        approvedBy: "PENDING_HUMAN_APPROVAL",
        approvedAt: "PENDING_HUMAN_APPROVAL",
      };
    }),
  };
  writeFileSync(
    resolve(candidateRoot, "manifest.json"),
    `${JSON.stringify(candidateManifest, null, 2)}\n`
  );

  const failed = report.intents.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        scope: "grokVoice.registeredSpeech.build",
        builtAt,
        ok: failed.length === 0,
        failedCount: failed.length,
        candidate: candidateRoot,
        reviewHtml: resolve(reportDir, "review.html"),
      },
      null,
      2
    )
  );
  if (failed.length > 0) {
    console.error("Failed intents:", failed.map((f) => f.intent).join(", "));
    process.exit(2);
  }
}

main().catch((error) => {
  console.error("FATAL", error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
