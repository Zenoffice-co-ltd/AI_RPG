"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type RoleplayMode,
  type RoleplayStatus,
  type TranscriptMessage,
  type UseRoleplayConversationReturn,
} from "./conversation-types";
import {
  createTranscriptMessage,
  transcriptReducer,
} from "./transcript-reducer";
import {
  fetchHaikuFishGreeting,
  postHaikuFishEvent,
  postHaikuFishTranscription,
  streamHaikuFishRespond,
  type HaikuFishGreeting,
  type HaikuFishTranscription,
} from "./haiku-fish-client";
import {
  HaikuFishAudioQueue,
  type HaikuFishAudioQueueOptions,
} from "./haiku-fish-audio-queue";
import {
  HaikuFishMicRecorder,
  blobToBase64,
  type HaikuFishMicState,
} from "./haiku-fish-mic-recorder";
import type {
  HaikuFishSession,
  HaikuFishTurnMetricsClient,
} from "./haiku-fish-types";

const SAFE_ERROR =
  "セッションの開始に失敗しました。時間をおいて再試行してください。";
const RESPOND_ERROR =
  "応答生成に失敗しました。時間をおいて再試行してください。";

export type HaikuFishConversation = UseRoleplayConversationReturn & {
  mode: RoleplayMode;
  history: never[];
  limitWarning: boolean;
  selectedInput: string;
  setSelectedInput: (deviceId: string) => void;
  volume: number;
  metricsLog: HaikuFishTurnMetricsClient[];
  session: HaikuFishSession | null;
};

export type UseHaikuFishConversationDeps = {
  fetchSession?: () => Promise<HaikuFishSession>;
  streamRespond?: typeof streamHaikuFishRespond;
  fetchGreeting?: () => Promise<HaikuFishGreeting>;
  postTranscription?: (
    audioBase64: string,
    audioMimeType: string
  ) => Promise<HaikuFishTranscription>;
  audioQueueOptions?: HaikuFishAudioQueueOptions;
  createAudioQueue?: (options: HaikuFishAudioQueueOptions) => HaikuFishAudioQueue;
  createMicRecorder?: (
    onUtterance: (audio: { blob: Blob; mimeType: string }) => void
  ) => HaikuFishMicRecorder;
  micEnabled?: boolean;
};

const defaultFetchSession = async (): Promise<HaikuFishSession> => {
  const response = await fetch("/api/haiku-fish/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`session bootstrap failed: ${response.status}`);
  }
  return (await response.json()) as HaikuFishSession;
};

export function useHaikuFishConversation(
  mode: RoleplayMode,
  deps: UseHaikuFishConversationDeps = {}
): HaikuFishConversation {
  const isInteractive = mode === "live";

  const [status, setStatus] = useState<RoleplayStatus>(() =>
    isInteractive ? "idle" : "ended"
  );
  const [messages, dispatchMessages] = useReducer(transcriptReducer, []);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [session, setSession] = useState<HaikuFishSession | null>(null);
  const [metricsLog, setMetricsLog] = useState<HaikuFishTurnMetricsClient[]>([]);
  const [volume, setVolume] = useState(0.82);
  const [selectedInput, setSelectedInput] = useState("");

  const audioQueueRef = useRef<HaikuFishAudioQueue | null>(null);
  const sessionRef = useRef<HaikuFishSession | null>(null);
  const messagesRef = useRef<TranscriptMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const interimAgentClientIdRef = useRef<string | null>(null);
  const conversationGenRef = useRef(0);
  const micRecorderRef = useRef<HaikuFishMicRecorder | null>(null);
  const micStateRef = useRef<HaikuFishMicState>("idle");
  const isMutedRef = useRef(false);
  const inFlightTurnRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const fetchSession = deps.fetchSession ?? defaultFetchSession;
  const streamRespond = deps.streamRespond ?? streamHaikuFishRespond;
  const fetchGreeting = deps.fetchGreeting ?? fetchHaikuFishGreeting;
  const postTranscription = deps.postTranscription ?? postHaikuFishTranscription;
  const audioQueueOptions = deps.audioQueueOptions;
  const createAudioQueue = deps.createAudioQueue;
  const createMicRecorder = deps.createMicRecorder;
  const micEnabled = deps.micEnabled ?? false;

  const ensureAudioQueue = useCallback((): HaikuFishAudioQueue => {
    if (!audioQueueRef.current) {
      audioQueueRef.current = createAudioQueue
        ? createAudioQueue(audioQueueOptions ?? {})
        : new HaikuFishAudioQueue(audioQueueOptions ?? {});
      audioQueueRef.current.setVolume(volume);
    }
    return audioQueueRef.current;
  }, [audioQueueOptions, createAudioQueue, volume]);

  const handleMicUtterance = useRef<
    ((audio: { blob: Blob; mimeType: string }) => void) | null
  >(null);

  const startMicRecorder = useCallback(async () => {
    if (!micEnabled) return;
    if (micRecorderRef.current) return;
    const onUtterance = (audio: { blob: Blob; mimeType: string }) => {
      handleMicUtterance.current?.(audio);
    };
    const recorder =
      createMicRecorder?.(onUtterance) ??
      new HaikuFishMicRecorder({
        onUtterance,
        onError: (error) => {
          console.warn("haikuFish mic recorder error", error);
          void postHaikuFishEvent("mic.error", {
            ...(sessionRef.current?.sessionId
              ? { sessionId: sessionRef.current.sessionId }
              : {}),
            details: { message: error.message },
          });
        },
        onStateChange: (next) => {
          const prev = micStateRef.current;
          micStateRef.current = next;
          if (prev !== next) {
            void postHaikuFishEvent("mic.state", {
              ...(sessionRef.current?.sessionId
                ? { sessionId: sessionRef.current.sessionId }
                : {}),
              details: { from: prev, to: next },
            });
          }
        },
      });
    micRecorderRef.current = recorder;
    try {
      await recorder.start();
      recorder.setEnabled(!isMutedRef.current);
      void postHaikuFishEvent("mic.permission.granted", {
        ...(sessionRef.current?.sessionId
          ? { sessionId: sessionRef.current.sessionId }
          : {}),
      });
    } catch (error) {
      console.warn("haikuFish mic start failed", error);
      micRecorderRef.current = null;
      void postHaikuFishEvent("mic.permission.denied", {
        ...(sessionRef.current?.sessionId
          ? { sessionId: sessionRef.current.sessionId }
          : {}),
        details: { message: (error as Error)?.message ?? String(error) },
      });
      throw error;
    }
  }, [createMicRecorder, micEnabled]);

  const stopMicRecorder = useCallback(async () => {
    const recorder = micRecorderRef.current;
    if (!recorder) return;
    micRecorderRef.current = null;
    micStateRef.current = "idle";
    try {
      await recorder.stop();
    } catch {
      // ignore
    }
  }, []);

  const startConversation = useCallback(async () => {
    if (!isInteractive) return;
    if (sessionRef.current) {
      setStatus("listening");
      return;
    }
    conversationGenRef.current += 1;
    setStatus("connecting");
    setErrorMessage(null);
    try {
      const next = await fetchSession();
      sessionRef.current = next;
      setSession(next);
      const greeting = createTranscriptMessage({
        role: "agent",
        channel: "voice",
        text: next.firstMessage,
        status: "final",
        source: "sdk",
        sdkMessageId: `agent-greeting-${next.sessionId}`,
      });
      dispatchMessages({ type: "reset", messages: [greeting] });
      const queue = ensureAudioQueue();
      try {
        await queue.resume();
      } catch {
        // ignore — user gesture might be required, will retry on first audio
      }
      // Synthesize the greeting via Fish so the user hears the agent open.
      try {
        setStatus("speaking");
        const greetingAudio = await fetchGreeting();
        await queue.enqueueBase64(greetingAudio.base64);
      } catch (error) {
        console.warn("haikuFish greeting tts failed", error);
      }
      setStatus("listening");
      if (micEnabled) {
        try {
          await startMicRecorder();
        } catch {
          // mic permission denied / not available — fall back to text input only
        }
      }
    } catch (error) {
      console.warn("haikuFish session start failed", error);
      setErrorMessage(SAFE_ERROR);
      setStatus("error");
    }
  }, [ensureAudioQueue, fetchGreeting, fetchSession, isInteractive, micEnabled, startMicRecorder]);

  const endConversation = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current = null;
    setSession(null);
    await stopMicRecorder();
    if (audioQueueRef.current) {
      await audioQueueRef.current.stop();
      audioQueueRef.current = null;
    }
    setStatus("ended");
    setErrorMessage(null);
    interimAgentClientIdRef.current = null;
  }, [stopMicRecorder]);

  const startNewConversation = useCallback(async () => {
    await endConversation();
    dispatchMessages({ type: "reset", messages: [] });
    setMetricsLog([]);
    if (isInteractive) {
      await startConversation();
    }
  }, [endConversation, isInteractive, startConversation]);

  const sendTextMessage = useCallback(
    async (text: string, retryClientMessageId?: string) => {
      if (!isInteractive) return;
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      let activeSession = sessionRef.current;
      if (!activeSession) {
        await startConversation();
        activeSession = sessionRef.current;
      }
      if (!activeSession) {
        setErrorMessage(SAFE_ERROR);
        return;
      }

      const generation = conversationGenRef.current;

      const clientMessageId =
        retryClientMessageId ??
        `user-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const userMessage = createTranscriptMessage({
        role: "user",
        channel: "chat",
        text: trimmed,
        status: "sending",
        source: "local",
        clientMessageId,
      });
      dispatchMessages({ type: "append", message: userMessage });

      const agentInterimId =
        `agent-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      interimAgentClientIdRef.current = agentInterimId;
      const interimAgent = createTranscriptMessage({
        role: "agent",
        channel: "voice",
        text: "",
        status: "interim",
        source: "local",
        clientMessageId: agentInterimId,
      });
      dispatchMessages({ type: "append", message: interimAgent });

      setStatus("thinking");
      inFlightTurnRef.current = true;
      // Suspend mic capture while agent is generating + speaking, so the playback
      // doesn't echo back into the recorder.
      micRecorderRef.current?.setEnabled(false);

      const queue = ensureAudioQueue();
      try {
        await queue.resume();
      } catch {
        // ignore
      }

      const turnMessages: ReadonlyArray<{ role: "agent" | "user"; text: string }> =
        messagesRef.current
          .filter((m) => m.role === "agent" || m.role === "user")
          .map((m) => ({
            role: m.role === "agent" ? ("agent" as const) : ("user" as const),
            text: m.text,
          }))
          .filter((m) => m.text.length > 0)
          .concat({ role: "user", text: trimmed });

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";
      try {
        const events = streamRespond(
          {
            sessionId: activeSession.sessionId,
            inputMode: "text",
            messages: turnMessages,
          },
          { signal: controller.signal }
        );
        for await (const evt of events) {
          if (generation !== conversationGenRef.current) {
            controller.abort();
            break;
          }
          if (evt.event === "agent_text_delta") {
            accumulated += evt.data.text;
            dispatchMessages({
              type: "updateTextAndStatus",
              clientMessageId: agentInterimId,
              text: accumulated,
              status: "interim",
            });
          } else if (evt.event === "audio_chunk") {
            setStatus("speaking");
            await queue.enqueueBase64(evt.data.base64);
          } else if (evt.event === "agent_text_final") {
            accumulated = evt.data.text;
            dispatchMessages({
              type: "updateTextAndStatus",
              clientMessageId: agentInterimId,
              text: accumulated,
              status: "final",
            });
            dispatchMessages({
              type: "updateStatus",
              clientMessageId,
              status: "sent",
            });
          } else if (evt.event === "metrics") {
            setMetricsLog((current) => [...current, evt.data]);
          } else if (evt.event === "error") {
            setErrorMessage(RESPOND_ERROR);
          }
        }
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          console.warn("haikuFish respond stream failed", error);
          setErrorMessage(RESPOND_ERROR);
          dispatchMessages({
            type: "updateStatus",
            clientMessageId,
            status: "failed",
          });
          setStatus("error");
          return;
        }
      }

      if (generation === conversationGenRef.current) {
        setStatus("listening");
      }
      interimAgentClientIdRef.current = null;
      inFlightTurnRef.current = false;
      // Re-arm the mic after the agent finishes speaking, unless the user muted.
      if (!isMutedRef.current) {
        micRecorderRef.current?.setEnabled(true);
      }
    },
    [ensureAudioQueue, isInteractive, startConversation, streamRespond]
  );

  // Hook the mic recorder's onUtterance callback into the same text-message flow
  // by storing the latest sendTextMessage in a ref-callback the recorder reads.
  handleMicUtterance.current = (audio) => {
    if (inFlightTurnRef.current) return;
    if (isMutedRef.current) return;
    void (async () => {
      try {
        const base64 = await blobToBase64(audio.blob);
        void postHaikuFishEvent("mic.utterance.queued", {
          ...(sessionRef.current?.sessionId
            ? { sessionId: sessionRef.current.sessionId }
            : {}),
          details: { mimeType: audio.mimeType, base64Length: base64.length },
        });
        const transcription = await postTranscription(base64, audio.mimeType);
        const text = transcription.text.trim();
        if (text.length === 0) {
          void postHaikuFishEvent("mic.utterance.skipped", {
            ...(sessionRef.current?.sessionId
              ? { sessionId: sessionRef.current.sessionId }
              : {}),
            details: { reason: "empty_stt", confidence: transcription.confidence },
          });
          return;
        }
        await sendTextMessage(text);
      } catch (error) {
        console.warn("haikuFish transcribe-and-send failed", error);
        void postHaikuFishEvent("mic.error", {
          ...(sessionRef.current?.sessionId
            ? { sessionId: sessionRef.current.sessionId }
            : {}),
          details: { message: (error as Error)?.message ?? String(error) },
        });
      }
    })();
  };

  const toggleMute = useCallback(async () => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      // Pause mic capture while muted; resume when unmuted (unless agent is speaking).
      micRecorderRef.current?.setEnabled(!next && !inFlightTurnRef.current);
      return next;
    });
  }, []);

  const setOutputVolume = useCallback(async (next: number) => {
    setVolume(next);
    audioQueueRef.current?.setVolume(next);
  }, []);

  const changeInputDevice = useCallback(async (deviceId: string) => {
    setSelectedInput(deviceId);
  }, []);

  const getInputVolume = useCallback(
    () => micRecorderRef.current?.getInputVolume() ?? 0,
    []
  );
  const getOutputVolume = useCallback(
    () => audioQueueRef.current?.getOutputVolume() ?? 0,
    []
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void audioQueueRef.current?.stop();
      void micRecorderRef.current?.stop();
    };
  }, []);

  return useMemo<HaikuFishConversation>(
    () => ({
      status,
      messages,
      isConnected: status !== "idle" && status !== "ended" && status !== "error",
      isConnecting: status === "connecting",
      isMuted,
      isAgentSpeaking: status === "speaking",
      isAwaitingAgentResponse: status === "thinking",
      errorMessage,
      startConversation,
      endConversation,
      startNewConversation,
      sendTextMessage,
      toggleMute,
      setOutputVolume,
      changeInputDevice,
      getInputVolume,
      getOutputVolume,
      mode,
      history: [],
      limitWarning: false,
      selectedInput,
      setSelectedInput,
      volume,
      metricsLog,
      session,
    }),
    [
      changeInputDevice,
      endConversation,
      errorMessage,
      getInputVolume,
      getOutputVolume,
      isMuted,
      messages,
      metricsLog,
      mode,
      selectedInput,
      sendTextMessage,
      session,
      setOutputVolume,
      startConversation,
      startNewConversation,
      status,
      toggleMute,
      volume,
    ]
  );
}
