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

function createMessageId(role: VoiceMessage["role"]) {
  return `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ScenarioVoiceTestClient({
  scenarioId,
  openingLine,
}: {
  scenarioId: string;
  title: string;
  publicBrief: string;
  openingLine: string;
}) {
  const storageKey = `scenario-voice-test:${scenarioId}:messages`;
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const seededOpeningMessage: VoiceMessage = {
      id: createMessageId("assistant"),
      role: "assistant",
      text: openingLine,
    };

    setSpeechSupported(
      typeof window !== "undefined" &&
        Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    );

    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as VoiceMessage[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMessages(parsed);
            setHasStarted(true);
          } else {
            setMessages([seededOpeningMessage]);
          }
        } catch {
          setMessages([seededOpeningMessage]);
        }
      } else {
        setMessages([seededOpeningMessage]);
      }
    } else {
      setMessages([seededOpeningMessage]);
    }

    return () => {
      recognitionRef.current?.stop();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, [openingLine, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || messages.length === 0) {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(messages));
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, storageKey]);

  async function playAssistantAudio(text: string) {
    const response = await fetch(`/api/audio-preview/${scenarioId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error("audio-preview failed");
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

    try {
      const response = await fetch(`/api/scenario-test/${scenarioId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages,
        }),
      });

      if (!response.ok) {
        throw new Error("scenario-test failed");
      }

      const data = (await response.json()) as { text: string };
      const assistantMessage: VoiceMessage = {
        id: createMessageId("assistant"),
        role: "assistant",
        text: data.text,
      };
      setMessages((current) => [...current, assistantMessage]);
      await playAssistantAudio(assistantMessage.text);
    } catch (error) {
      console.error(error);
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
      id: createMessageId("user"),
      role: "user",
      text: normalized,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    await requestAssistantReply(nextMessages);
  }

  async function handleStartConversation() {
    if (hasStarted || isReplying) {
      return;
    }

    setHasStarted(true);
    try {
      await playAssistantAudio(openingLine);
    } catch (error) {
      console.error(error);
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
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      console.error(event.error ?? "speech-recognition-error");
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .flatMap((result) => Array.from(result))
        .map((item) => item.transcript)
        .join(" ")
        .trim();

      if (!transcript) {
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
  }

  function handleReplay() {
    const latestAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");

    if (!latestAssistant || isReplying) {
      return;
    }

    void playAssistantAudio(latestAssistant.text).catch((error) => {
      console.error(error);
    });
  }

  function handleReset() {
    recognitionRef.current?.stop();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    const nextMessages = [
      {
        id: createMessageId("assistant"),
        role: "assistant" as const,
        text: openingLine,
      },
    ];
    setMessages(nextMessages);
    setHasStarted(false);
    setIsListening(false);
    setIsReplying(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, JSON.stringify(nextMessages));
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-white px-4 py-6">
      <header className="pb-4 text-center text-xl font-semibold text-slate-950">
        シナリオテスト
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
        <section className="flex-1 overflow-y-auto px-4 py-5">
          <div className="flex flex-col gap-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "assistant"
                    ? "self-start max-w-[85%] rounded-3xl rounded-bl-md bg-white px-4 py-3 text-sm leading-7 text-slate-900 shadow-sm"
                    : "self-end max-w-[85%] rounded-3xl rounded-br-md bg-slate-950 px-4 py-3 text-sm leading-7 text-white"
                }
              >
                {message.text}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-slate-200 bg-white px-4 py-4">
          <button
            type="button"
            onClick={() => {
              void handleStartConversation();
            }}
            disabled={hasStarted || isReplying}
            className="rounded-full bg-slate-950 px-8 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            開始
          </button>
          <button
            type="button"
            onClick={isListening ? handleStopListening : handleStartListening}
            disabled={!hasStarted || isReplying || !speechSupported}
            className="rounded-full bg-emerald-600 px-8 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isListening ? "停止" : "話す"}
          </button>
          <button
            type="button"
            onClick={handleReplay}
            disabled={!hasStarted || isReplying}
            className="rounded-full bg-sky-600 px-8 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            再生
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full border border-slate-300 bg-white px-8 py-4 text-base font-semibold text-slate-700"
          >
            リセット
          </button>
        </div>
      </div>
      <audio ref={audioRef} className="hidden" />
    </main>
  );
}
