// PR D — risk-based strict playback classification.
//
// Why this exists: production Cloud Logging on `build-2026-05-07-002`
// (the build before PR A landed observability) showed that the all-turn
// strictSanitizedPlayback gate adds ~1.6s of `sanitizerDelayMs` to EVERY
// realtime voice turn — including the bulk of turns where the model has
// no plausible stock-suffix to emit (business factual answers like 件数
// or 業務内容). The fastest p50 voice latency win is to leave the gate
// in place for high-risk turn shapes (acks, final closings, identity
// probes, post-reseed) and stream business factual turns immediately.
//
// `shouldStrictGateTurn` is a PURE function: same `userText` + `inputMode`
// always produces the same gate decision. It is called once per turn at
// the moment the user input is finalized (STT-confirmed for voice, or
// text-submit for chat), and the result is cached on a turn-local ref
// in the conversation hook. This means a user typing "業務内容を教えて"
// always streams, and a user typing "なるほど、勉強になります" always
// buffers, regardless of what xAI ends up generating.
//
// Stock-suffix safety net: even when the gate is NOT applied and audio
// streams, the conversation hook still inspects transcript deltas for
// known stock-suffix patterns. If a suffix appears after streaming has
// already started, a telemetry event fires (`response.stock_suffix_
// streaming_risk_detected`) but the audio is NOT retroactively
// cancelled — by definition, the user has already heard it. The
// classification below is therefore tuned conservatively: when in
// doubt, gate. False positives cost 1.6s; false negatives cost a
// stock-suffix leak.

export type StrictGateDecision = {
  apply: boolean;
  // Short, stable string identifying which heuristic triggered the
  // gate. Goes to telemetry so dashboards can show which class of
  // input is gating most often. `null` when `apply === false`.
  reason: string | null;
};

// User inputs that START with an ack flavor often elicit a continuation
// from the model that includes stock-suffix material ("…、ご不明点が
// あればお知らせください"). The PR60 lock catalog catches the BARE forms
// (`はい`, `なるほどですね`) via `^…$` anchors, so anything reaching the
// realtime model with these prefixes is an extended ack that the lock
// did NOT match — exactly the leak-prone shape we want to gate.
const ACK_PREFIXES: readonly string[] = [
  "はい",
  "なるほど",
  "そうですね",
  "そういうことですね",
  "うん",
  "うーん",
  "わかりました",
  "了解",
  "承知",
  "ありがとう",
  "ありがとうございます",
  "一旦",
];

// Final-closing phrases tend to elicit a "本日はありがとうございました、
// 何かありましたらお気軽に…" tail from the model. The PR60 lock catches
// some closings but not all phrasings — gate the realtime path.
const FINAL_CLOSING_SUBSTRINGS: readonly string[] = [
  "よろしくお願いします",
  "宜しくお願いします",
  "本日はありがとう",
  "本日はお時間",
  "また連絡",
  "また改めて",
  "また後ほど",
  "失礼します",
  "失礼いたします",
  "お疲れさま",
  "お疲れさまでした",
  "一旦社内で確認",
  "社内で確認します",
];

// Identity / system-prompt probes. The model is instructed to refuse,
// but refusals occasionally tail off into stock-suffix territory
// ("…AIですが、何かご質問があれば…"). Gate so we sanitize before
// playback.
const IDENTITY_PROBE_SUBSTRINGS: readonly string[] = [
  "AIですか",
  "ＡＩですか",
  "AIなんですか",
  "Grokですか",
  "グロックですか",
  "システムプロンプト",
  "内部指示",
  "instructions",
  "あなたは誰",
  "あなたは何者",
  "あなたは何のAI",
  "モデルは何",
  "どのモデル",
];

function startsWithAny(text: string, prefixes: readonly string[]): string | null {
  for (const prefix of prefixes) {
    if (text.startsWith(prefix)) return prefix;
  }
  return null;
}

function containsAny(text: string, needles: readonly string[]): string | null {
  for (const needle of needles) {
    if (text.includes(needle)) return needle;
  }
  return null;
}

export function shouldStrictGateTurn(input: {
  userText: string;
  inputMode: "voice" | "text";
  // True if the previous turn ended in a sanitizer rewrite or a session
  // reseed. The transcript context the model just saw is already in a
  // recovery state; gate one additional turn to keep the recovery
  // window safe.
  postSanitizerOrReseed?: boolean;
}): StrictGateDecision {
  const trimmed = input.userText.trim();
  if (trimmed.length === 0) {
    // Empty/whitespace inputs cannot be classified meaningfully. They
    // are rare (the STT pipeline emits `stt.skipped` instead) but if
    // one slips through, gate to be safe.
    return { apply: true, reason: "empty_input_safety" };
  }

  if (input.postSanitizerOrReseed === true) {
    return { apply: true, reason: "post_sanitizer_or_reseed" };
  }

  const ackPrefix = startsWithAny(trimmed, ACK_PREFIXES);
  if (ackPrefix !== null) {
    return { apply: true, reason: `ack_prefix:${ackPrefix}` };
  }

  const closing = containsAny(trimmed, FINAL_CLOSING_SUBSTRINGS);
  if (closing !== null) {
    return { apply: true, reason: `final_closing:${closing}` };
  }

  const identity = containsAny(trimmed, IDENTITY_PROBE_SUBSTRINGS);
  if (identity !== null) {
    return { apply: true, reason: `identity_probe:${identity}` };
  }

  return { apply: false, reason: null };
}

// Per the directive's audio-routing spec:
//   all_turns        → always buffer
//   risk_based + gated   → buffer
//   risk_based + ungated → stream
//   monitor_only     → always stream (detect+log only)
export function shouldBufferForTurn(input: {
  mode: "all_turns" | "risk_based" | "monitor_only";
  gateDecision: StrictGateDecision;
}): boolean {
  if (input.mode === "all_turns") return true;
  if (input.mode === "monitor_only") return false;
  return input.gateDecision.apply;
}
