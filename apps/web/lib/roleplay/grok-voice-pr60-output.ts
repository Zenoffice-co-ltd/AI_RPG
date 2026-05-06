const PR60_LOCKED_RESPONSES: Array<{
  userPatterns: RegExp[];
  response: string;
}> = [
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
      "月末と月初、月曜日の午前中、商品が切り替わる時期に負荷が上がります。",
  },
  {
    userPatterns: [/募集背景/, /背景を/, /背景.*伺/],
    response: "増員です。受注処理が増えてきています。",
  },
  {
    userPatterns: [/^そういうことですね。?$/, /^はい。?$/, /^うーん。?$/],
    response: "はい。",
  },
  {
    userPatterns: [/候補者のスキル/, /どういうスキル/, /どういう経験/],
    response:
      "受発注経験と対外調整の経験がある方を優先的に見ています。",
  },
  {
    userPatterns: [/協調性.*具体/, /協調性.*聞/, /協調性.*もう少し/],
    response:
      "営業や物流と確認しながら進める場面が多いので、抱え込まずに連携できる方が合います。",
  },
  {
    userPatterns: [/よろしくお願いします/, /宜しくお願いします/],
    response: "こちらこそよろしくお願いします。",
  },
];

export function getPr60LockedResponseForUser(userText: string): string | null {
  const normalized = userText.trim();
  if (normalized.length === 0) return null;
  const hit = PR60_LOCKED_RESPONSES.find((entry) =>
    entry.userPatterns.some((pattern) => pattern.test(normalized))
  );
  return hit?.response ?? null;
}

export function normalizePr60AssistantText(
  userText: string,
  assistantText: string
): string {
  const locked = getPr60LockedResponseForUser(userText);
  if (!locked) return assistantText;
  const trimmed = assistantText.trimStart();
  return trimmed.startsWith(locked) ? locked : assistantText;
}

export function shouldStopAtPr60LockedResponse(
  userText: string,
  assistantText: string
): boolean {
  const locked = getPr60LockedResponseForUser(userText);
  return locked !== null && assistantText.trimStart().startsWith(locked);
}
