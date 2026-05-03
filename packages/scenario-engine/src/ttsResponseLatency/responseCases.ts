export type ResponseLatencyCaseCategory =
  | "short_ack"
  | "busy_manager"
  | "condition_hearing"
  | "budget_question"
  | "objection"
  | "ambiguous"
  | "english_mixed"
  | "long_context";

export type ResponseLatencyCase = {
  id: string;
  category: ResponseLatencyCaseCategory;
  userInput: string;
  expectedLength: "short" | "medium" | "long";
  notes: string;
};

export const responseLatencyCases: readonly ResponseLatencyCase[] = [
  {
    id: "resp_001",
    category: "short_ack",
    userInput: "はい、お願いします。",
    expectedLength: "short",
    notes: "短い相槌への自然な返答",
  },
  {
    id: "resp_002",
    category: "busy_manager",
    userInput: "今立て込んでいるので、2分で要点だけお願いします。",
    expectedLength: "short",
    notes: "忙しい相手への短い応答",
  },
  {
    id: "resp_003",
    category: "condition_hearing",
    userInput: "開始日は5月12日で、できれば3名ほしいです。",
    expectedLength: "medium",
    notes: "条件整理",
  },
  {
    id: "resp_004",
    category: "budget_question",
    userInput: "時給はどのくらいまで見ておけばいいですか。",
    expectedLength: "medium",
    notes: "金額を含む回答",
  },
  {
    id: "resp_005",
    category: "objection",
    userInput: "他社にも相談しているので、まずは違いを教えてください。",
    expectedLength: "medium",
    notes: "差別化回答",
  },
  {
    id: "resp_006",
    category: "ambiguous",
    userInput: "それってどのくらい現実的なんですか。",
    expectedLength: "medium",
    notes: "曖昧質問への確認",
  },
  {
    id: "resp_007",
    category: "english_mixed",
    userInput: "ExcelとWMSが使える人を優先したいです。",
    expectedLength: "medium",
    notes: "英字混じり",
  },
  {
    id: "resp_008",
    category: "long_context",
    userInput: "物流部長と人事の確認が必要なので、候補者の見立てを明日14時までに欲しいです。",
    expectedLength: "long",
    notes: "長めの条件整理",
  },
];

export const RESPONSE_LATENCY_SYSTEM_PROMPT = `あなたは日本語の法人向けAIロープレの相手役です。
相手は忙しい法人担当者です。
返答は自然な日本語で、短く、音声で聞き取りやすくしてください。
記号や箇条書きは避け、会話としてそのまま読み上げられる文にしてください。
回答は原則1〜2文、長くても3文までにしてください。`;
