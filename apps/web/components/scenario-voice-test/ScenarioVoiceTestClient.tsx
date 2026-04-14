"use client";

import { useEffect, useRef, useState } from "react";

type VoiceMessage = {
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

export function ScenarioVoiceTestClient({
  scenarioId,
  openingLine,
}: {
  scenarioId: string;
  title: string;
  publicBrief: string;
  openingLine: string;
}) {
  const [messages, setMessages] = useState<VoiceMessage[]>([
    {
      role: "assistant",
      text: openingLine,
    },
  ]);
  const [isListening, setIsListening] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    setSpeechSupported(
      typeof window !== "undefined" &&
        Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    );

    return () => {
      recognitionRef.current?.stop();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
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
    setMessages([
      {
        role: "assistant",
        text: openingLine,
      },
    ]);
    setHasStarted(false);
    setIsListening(false);
    setIsReplying(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="flex flex-wrap items-center justify-center gap-4">
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
      <audio ref={audioRef} className="hidden" />
    </main>
  );
}
