"use client";

import { useEffect, useRef, useState } from "react";

type VoiceMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

type SpeechRecognitionEventLike = {
  results: ArrayLike<
    ArrayLike<{
      transcript: string;
    }>
  >;
};

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function createVisualLabel(text: string) {
  const first = text.trim().slice(0, 1);
  return first.length > 0 ? first : "相";
}

export function ScenarioVoiceTestClient({
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
  const [messages, setMessages] = useState<VoiceMessage[]>([
    {
      id: "opening",
      role: "assistant",
      text: openingLine,
    },
  ]);
  const [isListening, setIsListening] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [statusText, setStatusText] = useState("開始すると相手役が話し始めます。");
  const [error, setError] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    setSpeechSupported(
      typeof window !== "undefined" &&
        Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    );

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      recognitionRef.current?.stop();
    };
  }, []);

  async function playAssistantAudio(text: string) {
    const response = await fetch(`/api/audio-preview/${scenarioId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const raw: unknown = await response.json().catch(() => ({}));
      const message =
        typeof raw === "object" && raw && "error" in raw
          ? String(raw.error)
          : "音声再生に失敗しました。";
      throw new Error(message);
    }

    const blob = await response.blob();
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = URL.createObjectURL(blob);
    if (audioRef.current) {
      audioRef.current.src = objectUrlRef.current;
      await audioRef.current.play();
    }
  }

  async function requestAssistantReply(nextMessages: VoiceMessage[]) {
    setIsReplying(true);
    setError(null);
    setStatusText("相手役が返答を準備しています...");

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
            : "会話生成に失敗しました。";
        throw new Error(message);
      }

      const data = raw as { text: string };
      const assistantMessage: VoiceMessage = {
        id: `assistant_${Date.now()}`,
        role: "assistant",
        text: data.text,
      };

      setMessages((current) => [...current, assistantMessage]);
      await playAssistantAudio(assistantMessage.text);
      setStatusText("返答が終わりました。もう一度話せます。");
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : "会話生成に失敗しました。");
      setStatusText("エラーが発生しました。");
    } finally {
      setIsReplying(false);
    }
  }

  async function handleUserTurn(userText: string) {
    const normalized = userText.trim();
    if (!normalized) {
      return;
    }

    const userMessage: VoiceMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      text: normalized,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setManualDraft("");
    await requestAssistantReply(nextMessages);
  }

  async function handleStartConversation() {
    if (hasStarted || isReplying) {
      return;
    }

    setHasStarted(true);
    setError(null);
    setStatusText("相手役の冒頭発話を再生しています...");

    try {
      await playAssistantAudio(openingLine);
      setStatusText(
        speechSupported
          ? "準備完了です。発話ボタンを押して話してください。"
          : "このブラウザでは音声入力が使えないため、下の補助入力欄を使ってください。"
      );
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "音声再生に失敗しました。");
      setStatusText("開始に失敗しました。");
    }
  }

  function handleStartListening() {
    if (!speechSupported || isListening || isReplying) {
      return;
    }

    const Recognition =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;

    if (!Recognition) {
      setSpeechSupported(false);
      setStatusText("このブラウザは音声認識に対応していません。");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      setStatusText("聞き取り中です。話し終えたら少し待ってください。");
    };

    recognition.onend = () => {
      setIsListening(false);
      if (!isReplying) {
        setStatusText("聞き取りが終わりました。");
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setStatusText("音声入力に失敗しました。");
      setError(
        event.error === "not-allowed"
          ? "マイクの使用が許可されていません。ブラウザでマイクを許可してください。"
          : "音声を認識できませんでした。"
      );
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .flatMap((result) => Array.from(result))
        .map((item) => item.transcript)
        .join(" ")
        .trim();

      if (!transcript) {
        setStatusText("音声が聞き取れませんでした。もう一度お試しください。");
        return;
      }

      void handleUserTurn(transcript);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function handleStopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
    setStatusText("聞き取りを停止しました。");
  }

  function handleReset() {
    recognitionRef.current?.stop();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setMessages([
      {
        id: "opening",
        role: "assistant",
        text: openingLine,
      },
    ]);
    setHasStarted(false);
    setIsListening(false);
    setIsReplying(false);
    setManualDraft("");
    setError(null);
    setStatusText("開始すると相手役が話し始めます。");
  }

  return (
    <main className="min-h-screen overflow-hidden px-4 py-6 md:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="glass-panel flex flex-col gap-4 p-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
              Scenario Voice Test
            </p>
            <h1 className="mt-2 text-3xl font-extrabold text-slate-950 md:text-4xl">
              {title}
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
              {publicBrief}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <div className="font-semibold text-slate-900">目的</div>
            <div className="mt-1">アバターなしで、シナリオ挙動と会話温度感だけを確認します。</div>
          </div>
        </header>

        <section className="glass-panel overflow-hidden p-4 md:p-6">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(180deg,#fffaf2_0%,#f2efe8_100%)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_18%,rgba(255,255,255,0.95),transparent_24%),radial-gradient(circle_at_80%_14%,rgba(254,240,138,0.26),transparent_20%),radial-gradient(circle_at_70%_75%,rgba(148,163,184,0.16),transparent_26%)]" />

            <div className="relative border-b border-black/5 px-4 py-3 md:px-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-emerald-200" />
                  <span className="h-3 w-3 rounded-full bg-amber-200" />
                  <span className="h-3 w-3 rounded-full bg-rose-200" />
                </div>
                <div className="w-full max-w-md rounded-full border border-white/70 bg-white/75 px-4 py-2 text-xs text-slate-400 shadow-inner">
                  シナリオ会話をテスト
                </div>
                <div className="hidden items-center gap-3 md:flex">
                  <span className="h-4 w-4 rounded-full bg-rose-200" />
                  <span className="h-5 w-5 rounded-full bg-amber-200" />
                </div>
              </div>
            </div>

            <div className="relative grid gap-4 p-4 md:grid-cols-[1.15fr_0.85fr] md:p-6">
              <div className="relative min-h-[30rem] overflow-hidden rounded-[1.8rem] bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.9),transparent_22%),radial-gradient(circle_at_85%_10%,rgba(255,255,255,0.66),transparent_18%),linear-gradient(180deg,#d8c0b0_0%,#efe4da_18%,#efe7df_100%)]">
                <div className="absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_20%_16%,rgba(255,250,245,0.85),transparent_14%),radial-gradient(circle_at_38%_22%,rgba(255,250,245,0.95),transparent_10%),radial-gradient(circle_at_54%_14%,rgba(255,250,245,0.78),transparent_10%),radial-gradient(circle_at_70%_20%,rgba(255,250,245,0.9),transparent_12%),radial-gradient(circle_at_84%_16%,rgba(255,250,245,0.72),transparent_10%)] blur-[2px]" />
                <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,transparent_0%,rgba(72,49,35,0.18)_100%)]" />

                <div className="absolute left-1/2 top-[17%] flex w-[17rem] -translate-x-1/2 flex-col items-center">
                  <div className="relative h-24 w-24 rounded-full bg-[linear-gradient(180deg,#b5c7e8_0%,#8da7d3_100%)] shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                    <div className="absolute inset-x-3 top-2 h-10 rounded-full bg-[linear-gradient(180deg,#88a4d7_0%,#6f8dc6_100%)]" />
                    <div className="absolute left-5 top-[2.9rem] h-2.5 w-2.5 rounded-full bg-slate-700" />
                    <div className="absolute right-5 top-[2.9rem] h-2.5 w-2.5 rounded-full bg-slate-700" />
                    <div className="absolute left-1/2 top-[4.2rem] h-1.5 w-8 -translate-x-1/2 rounded-full bg-rose-300" />
                  </div>
                  <div className="mt-3 h-44 w-40 rounded-[2rem] bg-[linear-gradient(180deg,#bfe6de_0%,#a1d2ca_100%)] shadow-[0_18px_40px_rgba(15,23,42,0.16)]" />
                  <div className="absolute right-0 top-[13rem] h-4 w-24 origin-left rounded-full bg-[linear-gradient(90deg,#a1d2ca_0%,#bfe6de_100%)] rotate-[6deg]" />
                </div>

                <div className="absolute right-4 top-4 w-36 rounded-[1.2rem] border border-amber-100 bg-white/86 p-3 shadow-[0_18px_40px_rgba(15,23,42,0.1)]">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1rem] bg-[linear-gradient(180deg,#f4e0d5_0%,#e8d0c0_100%)] text-2xl font-bold text-slate-600">
                    あ
                  </div>
                  <div className="mt-2 text-xs font-semibold text-slate-900">あなた</div>
                </div>

                <div className="absolute bottom-5 right-4 flex max-w-[18rem] flex-col gap-2">
                  {messages
                    .slice(-2)
                    .reverse()
                    .map((message) => (
                      <div
                        key={message.id}
                        className={
                          message.role === "assistant"
                            ? "rounded-[1.2rem] rounded-br-md bg-white px-4 py-3 text-sm leading-7 text-slate-800 shadow-[0_18px_36px_rgba(15,23,42,0.1)]"
                            : "rounded-[1.2rem] rounded-bl-md bg-emerald-50 px-4 py-3 text-sm leading-7 text-slate-800 shadow-[0_18px_36px_rgba(15,23,42,0.08)]"
                        }
                      >
                        {message.text}
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-[1.5rem] border border-white/70 bg-white/80 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">進行状況</div>
                      <div className="mt-1 text-sm leading-7 text-slate-600">{statusText}</div>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {isReplying ? "返答中" : isListening ? "聞き取り中" : hasStarted ? "待機中" : "未開始"}
                    </div>
                  </div>
                  {error ? (
                    <div className="mt-3 rounded-[1rem] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[1.5rem] border border-white/70 bg-white/80 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                  <div className="text-sm font-semibold text-slate-900">会話ログ</div>
                  <div className="mt-3 flex max-h-[20rem] flex-col gap-3 overflow-y-auto pr-1">
                    {messages.map((message) => (
                      <article
                        key={message.id}
                        className={
                          message.role === "assistant"
                            ? "self-start rounded-[1.1rem] rounded-bl-md bg-slate-100 px-4 py-3 text-sm leading-7 text-slate-800"
                            : "self-end rounded-[1.1rem] rounded-br-md bg-slate-950 px-4 py-3 text-sm leading-7 text-white"
                        }
                      >
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">
                          {message.role === "assistant" ? "相手役" : "あなた"}
                        </div>
                        {message.text}
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative border-t border-black/5 bg-white/50 px-4 py-4 md:px-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleStartConversation();
                    }}
                    disabled={hasStarted || isReplying}
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {hasStarted ? "開始済み" : "会話を開始"}
                  </button>
                  <button
                    type="button"
                    onClick={isListening ? handleStopListening : handleStartListening}
                    disabled={!hasStarted || isReplying || (!speechSupported && manualDraft.trim().length === 0)}
                    className="rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_30px_rgba(5,150,105,0.24)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isListening ? "聞き取りを止める" : "押して話す"}
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
                  >
                    リセット
                  </button>
                </div>
                <div className="text-xs text-slate-500">
                  {speechSupported
                    ? "Chrome 系ブラウザではマイク会話が使えます。"
                    : "このブラウザでは音声認識が使えないため、下の補助入力欄を使ってください。"}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <textarea
                  rows={3}
                  value={manualDraft}
                  onChange={(event) => setManualDraft(event.target.value)}
                  placeholder="音声認識が使えない場合は、ここに補助入力して送信できます。"
                  className="w-full rounded-[1.2rem] border border-slate-200 bg-white/90 px-4 py-3 text-sm leading-7 text-slate-900 outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleUserTurn(manualDraft);
                  }}
                  disabled={!hasStarted || isReplying || manualDraft.trim().length === 0}
                  className="rounded-[1.2rem] bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  補助入力で送信
                </button>
              </div>
            </div>
          </div>
        </section>

        <audio ref={audioRef} className="hidden" />
      </div>
    </main>
  );
}
