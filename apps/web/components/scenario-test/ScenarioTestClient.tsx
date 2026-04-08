"use client";

import { useState } from "react";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

export function ScenarioTestClient({
  scenarioId,
  title,
  publicBrief,
  openingLine,
}: {
  scenarioId: string;
  title: string;
  publicBrief: string;
  openingLine: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "opening",
      role: "assistant",
      text: openingLine,
    },
  ]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    const text = draft.trim();
    if (!text || isSending) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      text,
    };

    const nextMessages = [...messages, nextUserMessage];
    setMessages(nextMessages);
    setDraft("");
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/scenario-test/${scenarioId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.role,
            text: message.text,
          })),
        }),
      });

      const raw: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof raw === "object" && raw && "error" in raw
            ? String(raw.error)
            : "会話テストに失敗しました。";
        throw new Error(message);
      }

      const data = raw as { text: string };
      setMessages((current) => [
        ...current,
        {
          id: `assistant_${Date.now()}`,
          role: "assistant",
          text: data.text,
        },
      ]);
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : "会話テストに失敗しました。"
      );
      setMessages(messages);
      setDraft(text);
    } finally {
      setIsSending(false);
    }
  }

  function handleReset() {
    setMessages([
      {
        id: "opening",
        role: "assistant",
        text: openingLine,
      },
    ]);
    setDraft("");
    setError(null);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Scenario Test
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">{title}</h1>
        <p className="mt-2 text-sm leading-7 text-slate-600">{publicBrief}</p>
        <p className="mt-3 text-xs text-slate-500">
          アバターなしの text-only テストです。相手役の返答ロジックだけを確認できます。
        </p>
      </header>

      <section className="flex min-h-[60vh] flex-1 flex-col rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <strong className="text-sm text-slate-900">Conversation</strong>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
          >
            リセット
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "self-end rounded-xl bg-slate-950 px-4 py-3 text-sm leading-7 text-white"
                  : "self-start rounded-xl bg-slate-100 px-4 py-3 text-sm leading-7 text-slate-800"
              }
            >
              {message.text}
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 p-4">
          <label htmlFor="scenario-test-input" className="sr-only">
            メッセージ
          </label>
          <textarea
            id="scenario-test-input"
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="ここに質問や返答を入力してください"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm leading-7 text-slate-900 outline-none"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              シナリオどおりに返るかを確認するための検証用チャットです。
            </p>
            <button
              type="button"
              onClick={() => {
                void handleSend();
              }}
              disabled={isSending || draft.trim().length === 0}
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSending ? "送信中..." : "送信"}
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
