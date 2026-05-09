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
  {
    userPatterns: [/どういう業務/, /業務.*具体/, /具体的.*業務/],
    response: "じゅはっちゅうや納期調整まわりの営業事務です。",
  },
  {
    userPatterns: [/時期的にはいつ/, /開始時期/, /いつから/, /就業開始/],
    response: "開始は六月ついたちを希望しています。",
  },
  {
    userPatterns: [/受注件数/, /月にどのくらい/, /月何件/, /件数/, /処理量/],
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
  {
    userPatterns: [
      /候補者のスキル/,
      /どういうスキル/,
      /どういう経験/,
      /どんなスキル/,
      /スキル.*望ましい/,
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
    userPatterns: [/協調性.*具体/, /協調性.*聞/, /協調性.*もう少し/],
    response:
      "営業や物流と確認しながら進める場面が多いので、抱え込まずに連携できる方が合います。",
  },
  {
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
    userPatterns: [/水曜.*メール/, /水曜日.*メール/, /候補.*メール/],
    response:
      "はい、お願いします。ちなみに、アデコさんの派遣の特徴や、たしゃさんとの違いはどのあたりでしょうか。",
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

export function getPr60LockedResponseForUser(userText: string): string | null {
  const normalized = userText.trim();
  if (normalized.length === 0) return null;
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
    );
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
    .replace(/せんきゅうひゃく円/g, "千九百円");
}
