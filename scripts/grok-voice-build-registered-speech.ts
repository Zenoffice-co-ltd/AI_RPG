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

type SourceEntry = {
  intent: CanonicalIntent;
  spokenTextForGeneration: string;
  displayText: string;
};

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
    expectedTokensMatched: string[];
    expectedTokensMissing: string[];
    forbiddenSuffixHit: boolean;
    ok: boolean;
  }>;
};

async function synthesizeArtifact(_entry: SourceEntry): Promise<{
  pcmBytes: Buffer;
  durationMs: number;
}> {
  // Implementation hook — wire to `synthesizeGrokVoiceTts` in
  // apps/web/server/grokVoice/tts.ts. Left unwired in the scaffold
  // commit so a fresh checkout doesn't burn xAI quota when somebody
  // runs `tsx scripts/grok-voice-build-registered-speech.ts` without
  // realizing what it does. The error here is the safety net.
  throw new Error(
    "[build-registered-speech] synthesizeArtifact is unwired in the scaffold commit; " +
      "wire it to `synthesizeGrokVoiceTts` before running"
  );
}

async function asrTranscribe(_pcmBytes: Buffer): Promise<{
  text: string;
  confidence: number | null;
}> {
  throw new Error(
    "[build-registered-speech] asrTranscribe is unwired; wire it to `transcribeHaikuFish`"
  );
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
  const rows = report.intents
    .map(
      (entry) => `
      <tr class="${entry.ok ? "ok" : "fail"}">
        <td>${entry.intent}</td>
        <td>${entry.ok ? "OK" : "FAIL"}</td>
        <td>${entry.sha256.slice(0, 12)}…</td>
        <td>${entry.durationMs} ms</td>
        <td><audio controls preload="none" src="wav/${entry.intent}.wav"></audio></td>
        <td>${escapeHtml(entry.asrText)}</td>
        <td>${entry.expectedTokensMatched.join(" / ")}</td>
        <td>${entry.expectedTokensMissing.join(" / ")}</td>
        <td>${entry.forbiddenSuffixHit ? "HIT" : "clean"}</td>
      </tr>
    `
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Registered Speech Build ${report.builtAt}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 24px; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #ccc; padding: 6px 10px; font-size: 13px; vertical-align: top; }
  tr.ok td:nth-child(2) { color: #16a34a; font-weight: 600; }
  tr.fail { background: #fef2f2; }
  tr.fail td:nth-child(2) { color: #b91c1c; font-weight: 600; }
</style>
<h1>Registered Speech Build ${escapeHtml(report.builtAt)}</h1>
<p>Candidate: <code>${escapeHtml(report.candidatePath)}</code></p>
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

async function main() {
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

  for (const entry of source) {
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
    const asrSuffixHit = containsVoiceStockSuffix(asr.text);
    const forbidden =
      spokenSanitize.detected || displaySanitize.detected || asrSuffixHit;

    const tokens = checkExpectedTokens(entry.intent, asr.text);
    const ok = !forbidden && tokens.missing.length === 0;

    report.intents.push({
      intent: entry.intent,
      sha256,
      durationMs: Math.round((synth.pcmBytes.length / 2 / 24000) * 1000),
      audioPath,
      asrText: asr.text,
      asrConfidence: asr.confidence,
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
    voiceId: "rex" as const,
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

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
