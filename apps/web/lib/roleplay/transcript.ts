export type TranscriptRole = "agent" | "user";

export type TranscriptMessage = {
  id: string;
  role: TranscriptRole;
  text: string;
  at: number;
  status?: "final" | "thinking";
};

export const MOCK_INITIAL_TRANSCRIPT: TranscriptMessage[] = [
  {
    id: "m-001",
    role: "agent",
    text: "お時間ありがとうございます。今回は新しい派遣会社さんとして一度お話を伺いたいと思っています。まずは、御社の進め方も含めてご相談させていただけますか。",
    at: 0,
  },
  {
    id: "m-002",
    role: "agent",
    text: "営業事務を一名お願いする相談です。まずは要件を整理したいです。",
    at: 1,
  },
  {
    id: "m-003",
    role: "user",
    text: "はい、お願いしますーす。今回、要件を簡単にお伺いできますでしょうか？",
    at: 2,
  },
  {
    id: "m-004",
    role: "agent",
    text: "増員の相談です。まずは要件を整理したいので、なぜ新しい派遣会社にも声をかけたのかといった深掘りは、そちらからお聞きいただけますか。",
    at: 3,
  },
  {
    id: "m-005",
    role: "user",
    text: "はい、ありがとうございます。ちなみに、今回の募集の背景をお伺いできますか？",
    at: 4,
  },
  {
    id: "m-006",
    role: "agent",
    text: "いらっしゃいますか。どの点についてですか。 [slow]",
    at: 5,
  },
  {
    id: "m-007",
    role: "user",
    text: "...",
    at: 6,
  },
];

export const FULL_MOCK_TRANSCRIPT: TranscriptMessage[] = [
  {
    id: "f-001",
    role: "agent",
    text: "お時間ありがとうございます。今回は新しい派遣会社さんとして一度お話を伺いたいと思っています。まずは、御社の進め方も含めてご相談させていただけますか。",
    at: 0,
  },
  {
    id: "f-002",
    role: "agent",
    text: "いらっしゃいますか？ご相談の続き、どの点から進めましょうか。",
    at: 1,
  },
  {
    id: "f-003",
    role: "agent",
    text: "人事課の主任です。今回は営業事務を1名お願いする相談で、まずは要件を整理したいと考えています。どの点についてですか。",
    at: 2,
  },
  { id: "f-004", role: "user", text: "あなたは誰ですか。", at: 3 },
  {
    id: "f-005",
    role: "agent",
    text: "まだご検討中でしょうか。どの点から確認しますか。",
    at: 4,
  },
  { id: "f-006", role: "user", text: "...", at: 5 },
  {
    id: "f-007",
    role: "agent",
    text: "営業事務を1名お願いする相談です。まずは要件を整理したいです。どの点についてですか。",
    at: 6,
  },
  {
    id: "f-008",
    role: "user",
    text: "今回の募集について概要を教えてください。",
    at: 7,
  },
  {
    id: "f-009",
    role: "agent",
    text: "増員のためです。新しい派遣会社さんにも一度声をかけて、要件整理を進めたいと思っています。どの点についてですか。",
    at: 8,
  },
  { id: "f-010", role: "user", text: "募集背景を教えてください。", at: 9 },
  {
    id: "f-011",
    role: "agent",
    text: "現行ベンダーの供給が安定せず、稼働確保やレスポンス面で課題が出ているため、新規比較も含めて相談を始めています。どの点についてですか。",
    at: 10,
  },
  {
    id: "f-012",
    role: "user",
    text: "なぜ新しい派遣会社にも声かけたんですか。",
    at: 11,
  },
];

export type TranscriptAction =
  | { type: "append"; message: TranscriptMessage }
  | { type: "appendMany"; messages: TranscriptMessage[] }
  | { type: "reset"; messages: TranscriptMessage[] };

export function transcriptReducer(
  current: TranscriptMessage[],
  action: TranscriptAction
) {
  if (action.type === "reset") {
    return orderMessages(action.messages);
  }

  if (action.type === "appendMany") {
    return mergeMessages(current, action.messages);
  }

  return mergeMessages(current, [action.message]);
}

export function mergeMessages(
  current: TranscriptMessage[],
  incoming: TranscriptMessage[]
) {
  const merged = new Map<string, TranscriptMessage>();
  for (const message of current) {
    merged.set(message.id, message);
  }
  for (const message of incoming) {
    merged.set(message.id, message);
  }
  return orderMessages([...merged.values()]);
}

export function orderMessages(messages: TranscriptMessage[]) {
  return [...messages].sort((left, right) => {
    if (left.at !== right.at) {
      return left.at - right.at;
    }
    return left.id.localeCompare(right.id);
  });
}

export function canSendMessage(value: string) {
  return value.trim().length > 0;
}

export function buildMockAgentResponse(userText: string, at: number): TranscriptMessage {
  const normalized = userText.trim();
  const response =
    normalized.includes("背景") || normalized.includes("なぜ")
      ? "現行ベンダーの供給が安定せず、稼働確保やレスポンス面で課題が出ているため、新規比較も含めて相談を始めています。どの点についてですか。"
      : "ありがとうございます。営業事務を1名お願いする相談です。まずは要件を整理したいです。どの点についてですか。";

  return {
    id: `mock-agent-${at}`,
    role: "agent",
    text: response,
    at,
  };
}
