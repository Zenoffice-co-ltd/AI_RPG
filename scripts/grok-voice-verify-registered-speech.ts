// CI gate for the Verified Audio Artifact pipeline.
//
// Three modes — auto-detected from disk:
//
//   PROMOTED: data/generated/registered-speech/v1/manifest.json exists.
//     Runs the full integrity checks that manifestLoader runs at server
//     cold start (schema parse, intent exhaustiveness, sha256 of every
//     PCM file matches the manifest claim, forbidden-suffix scan over
//     every text field, EXPECTED_TOKENS_BY_INTENT covers every intent).
//
//   CANDIDATE: only data/generated/registered-speech/v1.candidate/
//     source.json exists. We are in the scaffold phase before any
//     artifact has been generated and approved. Runs subset checks
//     (intent coverage, no duplicates, forbidden-suffix scan over the
//     authored spokenTextForGeneration / displayText, expected-tokens
//     coverage). No sha checks because there is no audio yet.
//
//   STRICT: GROK_VOICE_REQUIRE_PROMOTED_MANIFEST=1 in env. Treats a
//     missing PROMOTED manifest as a hard failure. Used by the
//     pre-deploy gate so a build can never ship without verified
//     artifacts.
//
// This script is read-only and never synthesizes audio.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  REQUIRED_REGISTERED_SPEECH_INTENTS,
  type CanonicalIntent,
} from "../apps/web/lib/roleplay/registered-speech/canonical-intents";
import {
  REGISTERED_SPEECH_VOICE_ID,
  RegisteredSpeechManifestSchema,
} from "../apps/web/lib/roleplay/registered-speech/types";
import {
  containsVoiceStockSuffix,
  sanitizeGrokVoiceSpokenText,
} from "../apps/web/lib/roleplay/grok-voice-pr60-shared";
import { EXPECTED_TOKENS_BY_INTENT } from "../apps/web/lib/roleplay/registered-speech/expected-tokens";
import {
  PENDING_APPROVAL_SENTINEL,
  findArtifactPlaceholderPattern,
  findForbiddenAssistantQuestionSuffix,
  isAsciiOnly,
  isGreetingDurationOutOfRange,
} from "../apps/web/lib/roleplay/registered-speech/text-guards";

const currentDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(currentDir, "..");

const PROMOTED_MANIFEST_PATH = resolve(
  REPO_ROOT,
  "data/generated/registered-speech/v1/manifest.json"
);
const CANDIDATE_SOURCE_PATH = resolve(
  REPO_ROOT,
  "data/generated/registered-speech/v1.candidate/source.json"
);

type Failure = { check: string; message: string };
type Mode = "promoted" | "candidate";

function pushFail(failures: Failure[], check: string, message: string) {
  failures.push({ check, message });
}

const CandidateSourceEntrySchema = z.object({
  intent: z.enum(REQUIRED_REGISTERED_SPEECH_INTENTS),
  spokenTextForGeneration: z.string().min(1),
  displayText: z.string().min(1),
});
const CandidateSourceSchema = z.array(CandidateSourceEntrySchema).min(1);

function verifyCandidate(failures: Failure[]) {
  let raw: string;
  try {
    raw = readFileSync(CANDIDATE_SOURCE_PATH, "utf8");
  } catch (error) {
    pushFail(
      failures,
      "candidate_read",
      `Cannot read ${CANDIDATE_SOURCE_PATH}: ${(error as Error).message}`
    );
    return;
  }

  let entries: ReturnType<typeof CandidateSourceSchema.parse>;
  try {
    entries = CandidateSourceSchema.parse(JSON.parse(raw));
  } catch (error) {
    pushFail(failures, "candidate_schema", (error as Error).message);
    return;
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.intent)) {
      pushFail(failures, "candidate_duplicate_intent", entry.intent);
    }
    seen.add(entry.intent);
  }
  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!seen.has(required)) {
      pushFail(failures, "candidate_missing_intent", required);
    }
  }
  if (entries.length !== REQUIRED_REGISTERED_SPEECH_INTENTS.length) {
    pushFail(
      failures,
      "candidate_entry_count",
      `expected ${REQUIRED_REGISTERED_SPEECH_INTENTS.length} entries, got ${entries.length}`
    );
  }

  // Forbidden-suffix scan. The candidate is the source the build script
  // will synthesize from — catching a suffix here prevents shipping it
  // to TTS in the first place.
  for (const entry of entries) {
    const spokenScan = sanitizeGrokVoiceSpokenText(entry.spokenTextForGeneration);
    if (spokenScan.detected) {
      pushFail(
        failures,
        "candidate_forbidden_suffix_spoken",
        `${entry.intent}: ${spokenScan.removedPatternIds.join(", ")}`
      );
    }
    const displayScan = sanitizeGrokVoiceSpokenText(entry.displayText);
    if (displayScan.detected) {
      pushFail(
        failures,
        "candidate_forbidden_suffix_display",
        `${entry.intent}: ${displayScan.removedPatternIds.join(", ")}`
      );
    }
    // Placeholder strings (PENDING_*, "populated by the build script"
    // etc.) — PR-93 shipped a greeting whose spokenTextForGeneration was
    // the placeholder docblock itself. Catch it before TTS burns quota.
    const spokenPlaceholder = findArtifactPlaceholderPattern(entry.spokenTextForGeneration);
    if (spokenPlaceholder) {
      pushFail(
        failures,
        "candidate_placeholder_spoken",
        `${entry.intent}: matches ${spokenPlaceholder}`
      );
    }
    const displayPlaceholder = findArtifactPlaceholderPattern(entry.displayText);
    if (displayPlaceholder) {
      pushFail(
        failures,
        "candidate_placeholder_display",
        `${entry.intent}: matches ${displayPlaceholder}`
      );
    }
    // Assistant question suffix — separate from sanitize's stock-suffix
    // patterns. Artifacts are customer roleplay responses; ending one
    // with "ありますか？" / "ですか？" turns it into a question, which
    // the DOD forbids.
    const spokenQ = findForbiddenAssistantQuestionSuffix(entry.spokenTextForGeneration);
    if (spokenQ) {
      pushFail(
        failures,
        "candidate_question_suffix_spoken",
        `${entry.intent}: matches ${spokenQ}`
      );
    }
    const displayQ = findForbiddenAssistantQuestionSuffix(entry.displayText);
    if (displayQ) {
      pushFail(
        failures,
        "candidate_question_suffix_display",
        `${entry.intent}: matches ${displayQ}`
      );
    }
  }

  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!(required in EXPECTED_TOKENS_BY_INTENT)) {
      pushFail(
        failures,
        "expected_tokens_missing",
        `EXPECTED_TOKENS_BY_INTENT missing intent: ${required}`
      );
    }
  }
}

function verifyPromoted(failures: Failure[]) {
  let manifestRaw: string;
  try {
    manifestRaw = readFileSync(PROMOTED_MANIFEST_PATH, "utf8");
  } catch (error) {
    pushFail(
      failures,
      "manifest_read",
      `Cannot read ${PROMOTED_MANIFEST_PATH}: ${(error as Error).message}`
    );
    return;
  }

  let manifest: ReturnType<typeof RegisteredSpeechManifestSchema.parse>;
  try {
    manifest = RegisteredSpeechManifestSchema.parse(JSON.parse(manifestRaw));
  } catch (error) {
    pushFail(failures, "manifest_schema", (error as Error).message);
    return;
  }

  if (manifest.voiceId !== REGISTERED_SPEECH_VOICE_ID) {
    pushFail(
      failures,
      "voice_id_mismatch",
      `expected=${REGISTERED_SPEECH_VOICE_ID} got=${manifest.voiceId}`
    );
  }

  if (manifest.entries.length !== REQUIRED_REGISTERED_SPEECH_INTENTS.length) {
    pushFail(
      failures,
      "entry_count",
      `expected ${REQUIRED_REGISTERED_SPEECH_INTENTS.length} entries, got ${manifest.entries.length}`
    );
  }
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    if (seen.has(entry.intent)) {
      pushFail(failures, "duplicate_intent", entry.intent);
    }
    seen.add(entry.intent);
  }
  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!seen.has(required)) {
      pushFail(failures, "missing_intent", required);
    }
  }

  const root = resolve(REPO_ROOT, "data/generated/registered-speech/v1");
  for (const entry of manifest.entries) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(resolve(root, entry.audioPath));
    } catch (error) {
      pushFail(
        failures,
        "audio_read",
        `${entry.intent}: ${(error as Error).message}`
      );
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== entry.sha256) {
      pushFail(
        failures,
        "sha_mismatch",
        `${entry.intent}: manifest=${entry.sha256} actual=${actual}`
      );
    }
  }

  for (const entry of manifest.entries) {
    const sanitizedSpoken = sanitizeGrokVoiceSpokenText(entry.spokenText);
    if (sanitizedSpoken.detected) {
      pushFail(
        failures,
        "forbidden_suffix_spoken",
        `${entry.intent}: ${sanitizedSpoken.removedPatternIds.join(", ")}`
      );
    }
    const sanitizedDisplay = sanitizeGrokVoiceSpokenText(entry.displayText);
    if (sanitizedDisplay.detected) {
      pushFail(
        failures,
        "forbidden_suffix_display",
        `${entry.intent}: ${sanitizedDisplay.removedPatternIds.join(", ")}`
      );
    }
    if (containsVoiceStockSuffix(entry.asrText)) {
      pushFail(failures, "forbidden_suffix_asr", entry.intent);
    }
    // Placeholder strings — promoted manifest must never contain them.
    const spokenPlaceholder = findArtifactPlaceholderPattern(entry.spokenText);
    if (spokenPlaceholder) {
      pushFail(
        failures,
        "placeholder_spoken",
        `${entry.intent}: matches ${spokenPlaceholder}`
      );
    }
    const displayPlaceholder = findArtifactPlaceholderPattern(entry.displayText);
    if (displayPlaceholder) {
      pushFail(
        failures,
        "placeholder_display",
        `${entry.intent}: matches ${displayPlaceholder}`
      );
    }
    // Question suffix — artifact-only check (user utterances are
    // unaffected; this is the assistant's spoken/display text).
    const spokenQ = findForbiddenAssistantQuestionSuffix(entry.spokenText);
    if (spokenQ) {
      pushFail(failures, "question_suffix_spoken", `${entry.intent}: matches ${spokenQ}`);
    }
    const displayQ = findForbiddenAssistantQuestionSuffix(entry.displayText);
    if (displayQ) {
      pushFail(failures, "question_suffix_display", `${entry.intent}: matches ${displayQ}`);
    }
    // Approval gate — candidate manifests stamp PENDING_HUMAN_APPROVAL
    // and the promote step swaps in the real reviewer. A promoted
    // manifest with PENDING_* still in place was never reviewed.
    if (
      entry.approvedBy === PENDING_APPROVAL_SENTINEL ||
      entry.approvedAt === PENDING_APPROVAL_SENTINEL
    ) {
      pushFail(
        failures,
        "pending_human_approval",
        `${entry.intent}: approvedBy=${entry.approvedBy} approvedAt=${entry.approvedAt}`
      );
    }
  }

  // Greeting-specific checks. The 13.79s English-placeholder PR-93
  // greeting taught us that the catch-all checks above aren't
  // sufficient for the one artifact that plays before the user has
  // spoken. ASCII-only is a HARD fail; durationMs out of [3s, 18s] is
  // a SOFT warn (printed to stderr but does not push to failures, so
  // verify still exits 0 if every other check passes — the placeholder
  // / ASCII checks above are the real blocker).
  const greeting = manifest.entries.find((e) => e.intent === "greeting");
  if (greeting) {
    if (isAsciiOnly(greeting.spokenText) || isAsciiOnly(greeting.displayText)) {
      pushFail(
        failures,
        "greeting_ascii_only",
        `greeting must contain Japanese characters; spoken=${greeting.spokenText.slice(0, 60)} display=${greeting.displayText.slice(0, 60)}`
      );
    }
    if (isGreetingDurationOutOfRange(greeting.durationMs)) {
      console.warn(
        `[verify-registered-speech] WARN greeting durationMs=${greeting.durationMs} is outside the sanity range [3000, 18000]; re-listen before merge.`
      );
    }
  }

  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!(required in EXPECTED_TOKENS_BY_INTENT)) {
      pushFail(
        failures,
        "expected_tokens_missing",
        `EXPECTED_TOKENS_BY_INTENT missing intent: ${required}`
      );
    }
  }
}

function main() {
  const failures: Failure[] = [];
  const strictPromoted =
    process.env["GROK_VOICE_REQUIRE_PROMOTED_MANIFEST"] === "1";

  const promotedExists = existsSync(PROMOTED_MANIFEST_PATH);
  const candidateExists = existsSync(CANDIDATE_SOURCE_PATH);

  let mode: Mode | null = null;

  if (promotedExists) {
    mode = "promoted";
    verifyPromoted(failures);
  } else if (strictPromoted) {
    pushFail(
      failures,
      "promoted_manifest_required",
      `GROK_VOICE_REQUIRE_PROMOTED_MANIFEST=1 but ${PROMOTED_MANIFEST_PATH} is missing`
    );
  } else if (candidateExists) {
    mode = "candidate";
    verifyCandidate(failures);
  } else {
    pushFail(
      failures,
      "no_source",
      `Neither promoted manifest (${PROMOTED_MANIFEST_PATH}) nor candidate source (${CANDIDATE_SOURCE_PATH}) exists`
    );
  }

  return finish(failures, mode);
}

function finish(failures: Failure[], mode: Mode | null) {
  const ok = failures.length === 0;
  console.log(
    JSON.stringify(
      {
        scope: "grokVoice.registeredSpeech.verify",
        mode,
        ok,
        failures,
      },
      null,
      2
    )
  );
  if (!ok) process.exit(1);
}

main();
