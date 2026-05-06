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
    response: "受発注や納期調整まわりの営業事務です。",
  },
  {
    userPatterns: [/時期的にはいつ/, /開始時期/, /いつから/, /就業開始/],
    response: "開始は六月ついたちを希望しています。",
  },
  {
    userPatterns: [/受注件数/, /月にどのくらい/, /月何件/, /件数/, /処理量/],
    response: "月あたり、ろっぴゃく件から、ななひゃっけん程度です。",
  },
  {
    userPatterns: [/繁忙時期/, /忙しい時期/, /ピーク/, /繁忙.*いつ/],
    response:
      "月末と月の初め、月曜日の午前中、商品が切り替わる時期に負荷が上がります。",
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
      "受発注経験と対外調整の経験がある方を優先的に見ています。",
  },
  {
    userPatterns: [/人柄/, /合う.*人/, /人物面/, /性格/],
    response:
      "協調型が合いやすく、自分のやり方にこだわりすぎる方は合いにくいです。",
  },
  {
    userPatterns: [/協調性.*具体/, /協調性.*聞/, /協調性.*もう少し/],
    response:
      "営業や物流と確認しながら進める場面が多いので、抱え込まずに連携できる方が合います。",
  },
  {
    userPatterns: [/単価/, /請求/, /時給/],
    response:
      "請求想定は経験により、せんななひゃくごじゅう円から、せんきゅうひゃく円程度です。",
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

export function normalizeVoiceFriendlyTerms(text: string): string {
  return text
    .replace(/Adecco/g, "アデコ")
    .replace(/アデッコ/g, "アデコ")
    .replace(/他社/g, "たしゃ")
    .replace(/人事/g, "じんじ")
    .replace(/月初/g, "月の初め")
    .replace(/自己流/g, "自分のやり方")
    .replace(
      /千七百五十円から千九百円/g,
      "せんななひゃくごじゅう円から、せんきゅうひゃく円"
    )
    .replace(
      /千七百五十円から、千九百円/g,
      "せんななひゃくごじゅう円から、せんきゅうひゃく円"
    );
}

