// Verified Audio Artifact text guards.
//
// All checks here are ARTIFACT-TEXT-ONLY — they MUST NOT be applied to
// user utterances or matcher inputs (the user is supposed to speak
// questions and may include "PENDING" / "ですか" naturally). Importers
// are limited to:
//   - scripts/grok-voice-build-registered-speech.ts (pre-TTS check)
//   - scripts/grok-voice-verify-registered-speech.ts (CI gate)
//   - apps/web/server/registeredSpeech/manifestLoader.ts (cold-start)
//   - Layer A/B harness greeting checks
//
// Background: PR #92-94 shipped a greeting artifact whose spokenText
// was the literal placeholder "PENDING_GREETING_FILL — populated by
// the build script ..." (manifest sha256 8ed61df9..., durationMs
// 13790). The build script never replaced the placeholder; the
// manifest schema accepted the english string; the loader played it.
// These guards make every layer fail closed instead.

export const FORBIDDEN_ARTIFACT_PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /PENDING/i,
  /PLACEHOLDER/i,
  /populated by/i,
  /build script/i,
  /Source\.json/i,
  /schema doesn't break/i,
];

export function findArtifactPlaceholderPattern(text: string): RegExp | null {
  for (const pat of FORBIDDEN_ARTIFACT_PLACEHOLDER_PATTERNS) {
    if (pat.test(text)) return pat;
  }
  return null;
}

export function assertNoArtifactPlaceholder(intent: string, text: string): void {
  const hit = findArtifactPlaceholderPattern(text);
  if (hit) {
    throw new Error(
      `[registered-speech][${intent}] artifact text matches forbidden placeholder pattern ${hit}: ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`
    );
  }
}

// Question-suffix detector — artifact-only. The customer roleplay
// artifacts must not end the assistant turn with a question (the DOD
// forbids "他に何か" / "ご質問は" style closers). /ですか$/ is included
// here because no registered-speech artifact has a legitimate reason
// to end with a bare "ですか" — but this list MUST NOT touch user input
// where "ですか" is a normal interrogative.
export const FORBIDDEN_ASSISTANT_QUESTION_SUFFIX: readonly RegExp[] = [
  /ありますか[。！？!?]?$/,
  /ございますか[。！？!?]?$/,
  /でしょうか[。！？!?]?$/,
  /ですか[。！？!?]?$/,
  /よろしいでしょうか[。！？!?]?$/,
];

export function findForbiddenAssistantQuestionSuffix(text: string): RegExp | null {
  const trimmed = text.trim();
  for (const pat of FORBIDDEN_ASSISTANT_QUESTION_SUFFIX) {
    if (pat.test(trimmed)) return pat;
  }
  return null;
}

export function containsForbiddenAssistantQuestionSuffix(text: string): boolean {
  return findForbiddenAssistantQuestionSuffix(text) !== null;
}

// Hiragana, katakana, CJK Unified Ideographs.
const JAPANESE_CHAR = /[぀-ゟ゠-ヿ一-鿿]/;

export function isAsciiOnly(text: string): boolean {
  return !JAPANESE_CHAR.test(text);
}

// Promoted artifact approval gate. The build script intentionally
// stamps PENDING_HUMAN_APPROVAL on candidate manifests so the
// promote step can swap in a real reviewer. Reaching the loader or
// CI verifier with this sentinel still in place means the artifact
// was never reviewed — fail closed.
export const PENDING_APPROVAL_SENTINEL = "PENDING_HUMAN_APPROVAL";

export function assertHumanApproved(
  intent: string,
  approvedBy: string,
  approvedAt: string
): void {
  if (
    approvedBy === PENDING_APPROVAL_SENTINEL ||
    approvedAt === PENDING_APPROVAL_SENTINEL
  ) {
    throw new Error(
      `[registered-speech][${intent}] artifact is not human-approved (approvedBy=${approvedBy}, approvedAt=${approvedAt})`
    );
  }
}

// Greeting-specific durationMs sanity range. Below 3s is suspiciously
// short (likely truncation); above 18s is suspiciously long (the
// 13,790ms placeholder bug fit comfortably under the original 8s
// guess, so duration alone cannot disambiguate placeholder from a
// natural multi-sentence greeting — the placeholder pattern + ASCII-
// only checks above are the real safety net for that class of bug).
//
// 18s upper bound: the canonical greeting is 105 Japanese characters
// across four sentences and synthesizes at ~13.9s. Going beyond 18s
// implies either a TTS retry doubling, or content drift well past the
// approved script — either case the operator should re-listen.
//
// Per the hotfix plan this is a SOFT warn — verify and loader emit a
// warning but do not hard fail. The hard-fail signal is reserved for
// placeholder text / ASCII-only / approval gate.
export const GREETING_DURATION_MS_MIN = 3_000;
export const GREETING_DURATION_MS_MAX = 18_000;

export function isGreetingDurationOutOfRange(durationMs: number): boolean {
  return (
    durationMs < GREETING_DURATION_MS_MIN ||
    durationMs > GREETING_DURATION_MS_MAX
  );
}
