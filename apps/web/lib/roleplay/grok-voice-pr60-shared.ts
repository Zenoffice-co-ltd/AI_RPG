// Order matters: more specific intents must precede broader ones because
// `getPr60LockedResponseForUser` returns the FIRST match.
//
// In particular, every "specific skill follow-up" entry (協調性 / 正確性 /
// メーカー経験 / 必須) MUST appear BEFORE the broad-initial-skill lock so
// follow-up questions like 「メーカー経験はありますか」 don't get swallowed
// by the broad-skill canonical answer. Specific follow-ups either route to
// their own deterministic lock OR fall through to the realtime model where
// the Skill Disclosure Budget prompt rule handles them.
const PR60_LOCKED_RESPONSES: Array<{
  userPatterns: RegExp[];
  response: string;
}> = [
  {
    userPatterns: [/ミッション/, /担当.*ミッション/, /人事.*ミッション/],
    response:
      "じんじ課では、派遣スタッフの受け入れや管理を担当しています。",
  },
  {
    userPatterns: [/今回の内容/, /簡単.*内容/, /概要/, /案件概要/],
    response: "営業事務一名の相談です。まずは要件を整理したいと考えています。",
  },

  // -------- 業務内容 lock (#78) --------
  // Single-sentence canonical so the model can't add a 3rd declarative
  // explanation. New patterns: 業務内容 / どんな業務 / 仕事内容 / 何をする /
  // 営業事務.*内容 / 業務.*教えて. Existing patterns
  // (どういう業務|業務.*具体|具体的.*業務) are kept.
  {
    userPatterns: [
      /どういう業務/,
      /どんな業務/,
      /業務.*具体/,
      /具体的.*業務/,
      /業務内容/,
      /仕事内容/,
      /何をする/,
      /営業事務.*内容/,
      /業務.*教えて/,
    ],
    response: "じゅはっちゅうや納期調整まわりの営業事務です。",
  },

  {
    userPatterns: [/時期的にはいつ/, /開始時期/, /いつから/, /就業開始/],
    response: "開始は六月ついたちを希望しています。",
  },

  // -------- 件数 lock (#74) --------
  // Single-sentence canonical so the model can't add a 2nd "繁忙時期は…"
  // continuation. New patterns: ボリューム / どれくらい処理 / どの程度の量.
  {
    userPatterns: [
      /受注件数/,
      /月にどのくらい/,
      /月何件/,
      /件数/,
      /処理量/,
      /ボリューム/,
      /どれくらい処理/,
      /どの程度の量/,
    ],
    response: "つきあたり、ろっぴゃく件から、ななひゃっけん程度です。",
  },

  {
    userPatterns: [/繁忙時期/, /忙しい時期/, /ピーク/, /繁忙.*いつ/],
    response:
      "月のおわりと月の初め、月曜日の午前中、商品が切り替わる時期に負荷が上がります。",
  },
  {
    userPatterns: [/募集背景/, /背景を/, /背景.*伺/],
    response: "増員です。受注処理が増えてきています。",
  },
  {
    userPatterns: [
      /^そういうことですね。?$/,
      /^はい。?$/,
      /^うーん。?$/,
      /^なるほどですね。?$/,
      /^うん。?$/,
    ],
    response: "はい。",
  },

  // -------- Specific skill follow-up (BEFORE broad skill lock) --------
  // Per Phase 6 directive: specific follow-ups (正確性 / メーカー経験 / 必須)
  // are intentionally NOT added as deterministic locks. The realtime model
  // handles them via the Skill Disclosure Budget prompt rule. The only
  // specific follow-up with a deterministic answer is 協調性 (already
  // canonicalized below). Adding new specific locks risked cross-
  // contamination with case5's CP-handoff summary turn — the summary
  // mentions 「メーカー経験必須ではなく」 which was hijacking the
  // メーカー経験 follow-up canonical.
  {
    userPatterns: [/協調性.*具体/, /協調性.*聞/, /協調性.*もう少し/],
    response:
      "営業や物流と確認しながら進める場面が多いので、抱え込まずに連携できる方が合います。",
  },

  // -------- broad initial skill lock (#75) --------
  // Single-sentence canonical that routes the broad "what skills" question
  // away from the realtime model's 2nd-sentence (正確性/協調性) leak path.
  // Patterns intentionally exclude:
  //   - 経験.*必要 / 経験.*ありますか — collide with メーカー経験 follow-up
  //   - スキル.*ありますか — same family
  //   - 候補者.*経験 — collides with hypothetical phrasings like case11
  //     「候補者が少ない場合、…経験があれば」 which is NOT a broad-skill
  //     question.
  // Stick to phrasings that are unambiguously asking "what skills/experience
  // is needed" — paraphrases of the prototypical question.
  {
    userPatterns: [
      /候補者のスキル/,
      /どういうスキル/,
      /どういう経験/,
      /どんなスキル/,
      /どんな経験/,
      /スキル.*望ましい/,
      /スキル.*必要/,
      /スキル面/,
      /経験面/,
    ],
    response:
      "じゅはっちゅう経験と対外調整の経験がある方を優先的に見ています。",
  },

  {
    userPatterns: [/人柄/, /合う.*人/, /人物面/, /性格/],
    response:
      "周囲と合わせて進められるタイプが合いやすく、自分のやり方にこだわりすぎる方は合いにくいです。",
  },
  {
    // Legacy (non-deterministic-mode) lock text. Deterministic mode
    // does NOT use this string — see `registered-speech/intent-matcher.ts`
    // for the billing_rate intent's spokenText (which is the kana form
    // so xAI TTS reads the digits consistently). Keep this kanji form
    // for backward compatibility with the existing event-route and
    // locked-response-tts-route tests and the LLM prompt instructions
    // in `promptBuilder.ts`.
    userPatterns: [/単価/, /請求/, /時給/],
    response:
      "請求想定は経験により、千七百五十円から、千九百円程度です。",
  },
  {
    userPatterns: [/最終決定/, /誰になります/, /決定.*誰/, /決裁者/],
    response:
      "ベンダー選定はじんじが主導しますが、候補者が現場に合うかどうかの最終判断は現場課長の意見が強く反映されます。",
  },
  {
    // review-v2 P0-4: the response must not end with a facilitator-
    // style question — the registered-speech catalogue would otherwise
    // ship audio that itself carries a trailing question. The
    // 「整理しておきたい」 phrasing keeps the offer to discuss the
    // 派遣の特徴 / たしゃ違い on the table without prompting a "yes/no"
    // closing from the user.
    userPatterns: [/水曜.*メール/, /水曜日.*メール/, /候補.*メール/],
    response:
      "はい、お願いします。アデコさんの派遣の特徴やたしゃさんとの違いも、整理しておきたいと考えています。",
  },
  {
    userPatterns: [/よろしくお願いします/, /宜しくお願いします/],
    response: "こちらこそよろしくお願いします。",
  },
];

const STOCK_SUFFIX_PATTERNS = [
  /何か他に/,
  /他に何か/,
  /確認したい点/,
  /ご確認したい点/,
  /ご質問/,
  /不明点/,
  /気になる点/,
  /詳しく知りたい点/,
  /イメージはつかめましたか/,
  /つかめましたか/,
  /追加で確認/,
  /お知らせください/,
  /ご連絡します/,
  /折り返し/,
  /共有させていただきます/,
  /させていただきます/,
  /こちらで確認/,
  /現場の意見/,
  /お聞かせください/,
  /お聞きください/,
  /お聞きいただければ/,
  /他の条件もお聞き/,
  /教えてください/,
  /順番にお聞き/,
  /順次確認/,
  /お気軽に/,
  /何かございましたら/,
  /またお聞き/,
  /また後ほど/,
  /また改めて/,
];

// A rapid-fire compound question contains multiple distinct intents in one
// utterance ("AとBとCと…全部教えて"). The expected behavior in those cases
// is for the realtime model to push back ("一つずつ" / "まず業務内容から")
// per the answerBudget prompt rule — NOT for a deterministic lock to grab
// one of the topics and answer it. This guard prevents Phase 6 single-
// intent locks from hijacking case7-style rapid-fire turns.
//
// Heuristic: a "と" character only counts as a list connector when both
// sides look like noun phrases (≥2 consecutive kanji, or ≥2 consecutive
// katakana). This excludes "と" appearing inside function words such as
//   - quotative   〜という / 〜とは / 〜とか / 〜とも
//   - aspect noun 〜ところ
//   - adverb      ひととおり (一通り)
// where the surrounding characters are hiragana, not noun-like.
//
// Without this guard, single-intent phrasings such as
//   「業務内容をひととおり教えてください」(2 と's inside ひととおり)
//   「どんなスキルというところが必要か教えてください」(と in という + ところ)
//   「業務内容というところを教えてください」
//   「スキル面をひととおり教えてください」
// were misidentified as rapid-fire compounds and bypassed the deterministic
// 業務内容 / broad-skill / 件数 locks, re-leaking the #74/#75/#78 drift.
//
// STT note: live xAI / Grok voice transcripts often insert punctuation or
// whitespace between the connector と and the next noun phrase
// ("業務内容と、人数と単価を教えて"), so the regex tolerates an arbitrary
// run of separators (FW/HW comma・period・middle-dot・whitespace) between
// と and the next noun. The lookahead still requires a noun-like run on
// the right side, which keeps function-word と (followed by hiragana)
// excluded.
const CONNECTOR_SEPARATOR = String.raw`[\s、。，,.．・]*`;
const NOUN_LINKER_TO = new RegExp(
  String.raw`(?:[一-鿿]{2,}|[゠-ヿ]{2,})と${CONNECTOR_SEPARATOR}(?=[一-鿿]{2,}|[゠-ヿ]{2,})`,
  "g"
);

// Exported so the Verified Audio Artifact intent matcher can reuse the
// exact same rapid-fire predicate; the two matchers must agree on which
// utterances bypass single-intent locks. Also exported for unit tests.
export function countNounLinkerTo(text: string): number {
  return (text.match(NOUN_LINKER_TO) ?? []).length;
}

export function isRapidFireCompoundQuestion(text: string): boolean {
  // Explicit "全部教えて" / "まとめて教えて" / "一気に教えて" tail markers —
  // unambiguous "everything at once" intent regardless of how many noun
  // clusters the user actually listed.
  if (/(全部|まとめて|一気に).*(教えて|聞かせ|お願い|伺)/.test(text)) {
    return true;
  }
  // Two or more noun-linker と connectors plus a request verb indicate a
  // multi-cluster compound (case7-style "AとBとCと…教えて"). One linker
  // alone (e.g. "業務内容と単価を教えて") is normal compound speech and
  // falls through to the deterministic locks.
  const linkerCount = (text.match(NOUN_LINKER_TO) ?? []).length;
  if (linkerCount >= 2 && /教えて|聞かせて|お願いします|伺いたい/.test(text)) {
    return true;
  }
  return false;
}

export function getPr60LockedResponseForUser(userText: string): string | null {
  const normalized = userText.trim();
  if (normalized.length === 0) return null;
  // Phase 6: rapid-fire compound questions bypass single-intent locks. Let
  // the realtime model handle them per the answerBudget prompt rule.
  if (isRapidFireCompoundQuestion(normalized)) return null;
  const hit = PR60_LOCKED_RESPONSES.find((entry) =>
    entry.userPatterns.some((pattern) => pattern.test(normalized))
  );
  return hit?.response ?? null;
}

export function getAllPr60LockedResponses(): string[] {
  return Array.from(new Set(PR60_LOCKED_RESPONSES.map((entry) => entry.response)));
}

export function normalizePr60AssistantText(
  userText: string,
  assistantText: string
): string {
  const locked = getPr60LockedResponseForUser(userText);
  const normalized = normalizeVoiceFriendlyTerms(
    stripVoiceStockSuffixSentences(assistantText)
  );
  if (!locked) return normalized;
  const trimmed = assistantText.trimStart();
  return trimmed.startsWith(locked) ? locked : normalized;
}

export function shouldStopAtPr60LockedResponse(
  userText: string,
  assistantText: string
): boolean {
  const locked = getPr60LockedResponseForUser(userText);
  return locked !== null && assistantText.trimStart().startsWith(locked);
}

export function containsVoiceStockSuffix(text: string): boolean {
  return STOCK_SUFFIX_PATTERNS.some((pattern) => pattern.test(text));
}

export function stripVoiceStockSuffixSentences(text: string): string {
  const parts = text.match(/[^。！？!?]+[。！？!?]?/g);
  if (!parts) return text;
  const kept = parts.filter((sentence) => !containsVoiceStockSuffix(sentence));
  return kept.join("").trimStart();
}

// ---------------------------------------------------------------------------
// Strict sanitizer for the realtime audio gate.
//
// The detector below is intentionally tighter than STOCK_SUFFIX_PATTERNS — it
// targets only the trailing closing-question / closing-courtesy patterns that
// must never reach user audio. STOCK_SUFFIX_PATTERNS is preserved for the
// existing transcript-display normalization (normalizePr60AssistantText) so we
// don't regress that path while introducing the audio gate.
//
// "Trailing-only" means: walk from the end of the text and strip sentences
// that match any detector. Stop at the first sentence that does not match (or
// matches the locked-response allowlist). A sentence appearing earlier in the
// turn that happens to look like a stock suffix is left alone — the goal is to
// drop the closing tail, not to rewrite the body.
// ---------------------------------------------------------------------------

type StrictDetectorRule = { id: string; pattern: RegExp };

// Order matters: more specific rules are listed first so the first-match
// telemetry attribution stays interpretable for operators triaging strips.
const STRICT_STOCK_SUFFIX_DETECTORS: readonly StrictDetectorRule[] = [
  {
    id: "trailing_additional_check",
    pattern: /追加で(?:確認|聞|お聞き)/,
  },
  {
    id: "trailing_more_curious",
    pattern: /(?:詳しく|もっと)(?:知りたい|聞きたい|伺いたい)/,
  },
  {
    id: "trailing_okigaru_ni",
    pattern: /(?:いつでも)?お気軽に/,
  },
  {
    id: "trailing_anything_arose",
    pattern: /何かございましたら/,
  },
  {
    id: "trailing_again_later",
    pattern: /また(?:後ほど|改めて|お聞き)/,
  },
  {
    id: "trailing_other_q",
    // Matches 「他に何か〜質問」 / 「何か他に〜質問」 / 「他に〜質問」 / 「何か〜聞きたい」 etc.
    // Either order of (他に|ほかに|ほか) and (何か|なにか) is accepted.
    pattern: /(?:(?:他に|ほかに|ほか).{0,6}[何な]か|[何な]か.{0,6}(?:他に|ほかに|ほか)|(?:他に|ほかに|ほか)[\s\S]{0,3}(?:ご)?(?:質問|確認|不明|聞[きい]))/,
  },
  {
    id: "trailing_q_invitation",
    // Closing-question invitation. Allows particle 「は」 / 「が」 between the
    // noun and the question form so 「気になる点はありますか」 matches. The
    // 気になる/不明 noun head accepts 点 / 部分 / ところ variants — live xAI
    // emits 「気になる部分はありますか」 in the wild.
    pattern: /(?:ご)?(?:質問|確認したい点|確認したい部分|不明点|不明な部分|気になる(?:点|部分|ところ|とこ))(?:[がは])?(?:あれば|ございましたら|ありますか|ございますか|でしょうか)/,
  },
  // Context-gated. A bare 「水曜日にご連絡ください」 is a legitimate business
  // request and must NOT be stripped. We only treat 「お知らせください」/
  // 「ご連絡ください」 as a stock suffix when it co-occurs in the same sentence
  // with one of the closing-context tokens below.
  {
    id: "trailing_contact_with_closing_context",
    pattern: /(?:何か|他に|追加で|ご質問|不明点|確認したい点|気になる点)[\s\S]{0,20}(?:お知らせ|ご連絡)ください/,
  },
];

export type SanitizeGrokVoiceSpokenTextResult = {
  /** May be empty when sanitizedToEmpty is true. Callers MUST NOT fall back to original text. */
  text: string;
  detected: boolean;
  removedSentences: string[];
  removedPatternIds: string[];
  sanitizedToEmpty: boolean;
};

export function sanitizeGrokVoiceSpokenText(
  text: string
): SanitizeGrokVoiceSpokenTextResult {
  if (typeof text !== "string" || text.length === 0) {
    return {
      text: "",
      detected: false,
      removedSentences: [],
      removedPatternIds: [],
      sanitizedToEmpty: false,
    };
  }

  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) ?? [text];
  const removed: string[] = [];
  const removedIds: string[] = [];
  const allowlist = getAllPr60LockedResponses();

  let cutIndex = sentences.length;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const raw = sentences[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      cutIndex = i;
      continue;
    }
    if (allowlist.includes(trimmed)) {
      // Locked-response allowlist sentence — never strip this.
      break;
    }
    const hit = STRICT_STOCK_SUFFIX_DETECTORS.find((d) =>
      d.pattern.test(trimmed)
    );
    if (hit) {
      removed.unshift(raw);
      removedIds.unshift(hit.id);
      cutIndex = i;
      continue;
    }
    break;
  }

  const cleaned = sentences.slice(0, cutIndex).join("").trimStart();
  const detected = removed.length > 0;
  const sanitizedToEmpty = detected && cleaned.length === 0;

  return {
    // Important: when sanitizedToEmpty we return "" — never the original text.
    // Returning the original would re-emit the forbidden phrase through
    // downstream UI / TTS.
    text: cleaned,
    detected,
    removedSentences: removed,
    removedPatternIds: removedIds,
    sanitizedToEmpty,
  };
}

export function normalizeVoiceFriendlyTerms(text: string): string {
  return text
    .replace(/Adecco/g, "アデコ")
    .replace(/アデッコ/g, "アデコ")
    .replace(/他社/g, "たしゃ")
    .replace(/人事/g, "じんじ")
    .replace(/月末/g, "月のおわり")
    .replace(/月初/g, "月の初め")
    .replace(/月あたり/g, "つきあたり")
    .replace(/協調型/g, "周囲と合わせて進められるタイプ")
    .replace(/自己流/g, "自分のやり方")
    .replace(/受発注/g, "じゅはっちゅう")
    .replace(/朝八時四十五分/g, "朝八時よんじゅうごふん")
    .replace(/6月1日/g, "六月ついたち")
    .replace(/六月一日/g, "六月ついたち")
    .replace(
      /千七百五十円から千九百円/g,
      "千七百五十円から、千九百円"
    )
    .replace(
      /千七百五十円から、千九百円/g,
      "千七百五十円から、千九百円"
    )
    .replace(/月十から十五時間/g, "つきじゅうからじゅうごじかん");
}

export function normalizeGrokVoiceDisplayText(text: string): string {
  return text
    .replace(/じんじ課/g, "人事課")
    .replace(/じんじ/g, "人事")
    .replace(/たしゃ/g, "他社")
    .replace(/月のおわり/g, "月末")
    .replace(/月の初め/g, "月初")
    .replace(/つきあたり/g, "月あたり")
    .replace(/周囲と合わせて進められるタイプ/g, "協調型")
    .replace(/自分のやり方/g, "自己流")
    .replace(/じゅはっちゅう/g, "受発注")
    .replace(/朝八時よんじゅうごふん/g, "朝八時四十五分")
    .replace(/六月ついたち/g, "六月一日")
    .replace(/ろっぴゃく件/g, "六百件")
    .replace(/ななひゃっけん/g, "七百件")
    .replace(/せんななひゃくごじゅう円/g, "千七百五十円")
    .replace(/せんきゅうひゃく円/g, "千九百円")
    .replace(/つきじゅうからじゅうごじかん/g, "月十から十五時間");
}
