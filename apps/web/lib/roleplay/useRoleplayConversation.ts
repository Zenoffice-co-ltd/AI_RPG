"use client";

import { useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type RoleplayHistoryItem,
  type RoleplayMode,
  type RoleplayStatus,
  type TranscriptMessage,
  type UseRoleplayConversationReturn,
  isActiveStatus,
} from "./conversation-types";
import { createFakeLiveAdapter, type FakeLiveAdapter } from "./fake-live-adapter";
import {
  normalizeConversationEvent,
  type NormalizedConversationEvent,
} from "./normalize-conversation-event";
import {
  createTranscriptMessage,
  transcriptReducer,
} from "./transcript-reducer";
import { ADECCO_SCENARIO_ID, SESSION_LIMIT_MS } from "./scenario";
import { SAFE_SESSION_ERROR } from "./voice-session";
import { buildMockAgentResponse, canSendMessage, MOCK_INITIAL_TRANSCRIPT } from "./transcript";

const HISTORY_KEY = "roleplay:adecco-orb:history";
const CONNECT_TIMEOUT_MS = 20_000;
const AGENT_RESPONSE_TIMEOUT_MS = 15_000;

type StartTrigger = "call" | "text" | "new-conversation";

type DeferredStart = {
  generation: number;
  conversationLocalId: string;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

export type RoleplayConversation = UseRoleplayConversationReturn & {
  mode: RoleplayMode;
  history: RoleplayHistoryItem[];
  limitWarning: boolean;
  selectedInput: string;
  setSelectedInput: (deviceId: string) => void;
  volume: number;
};

export function useRoleplayConversation(mode: RoleplayMode): RoleplayConversation {
  const [status, setStatus] = useState<RoleplayStatus>(() =>
    mode === "mock" || mode === "visualTest" ? "ended" : "idle"
  );
  const [messages, dispatchMessages] = useReducer(
    transcriptReducer,
    initialMessagesForMode(mode)
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [limitWarning, setLimitWarning] = useState(false);
  const [isAwaitingAgentResponse, setIsAwaitingAgentResponse] = useState(false);
  const [history, setHistory] = useState<RoleplayHistoryItem[]>([]);
  const [volume, setVolume] = useState(0.82);
  const [selectedInput, setSelectedInput] = useState("");

  const statusRef = useRef(status);
  const messagesRef = useRef(messages);
  const modeRef = useRef(mode);
  const isMutedRef = useRef(isMuted);
  const sessionGenerationRef = useRef(0);
  const localConversationIdRef = useRef(createLocalConversationId());
  const startRef = useRef<DeferredStart | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const sessionWarningRef = useRef<number | null>(null);
  const agentResponseTimerRef = useRef<number | null>(null);
  const fakeAdapterRef = useRef<FakeLiveAdapter | null>(null);

  const conversation = useConversation();

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    modeRef.current = mode;
    dispatchMessages({ type: "reset", messages: initialMessagesForMode(mode) });
    setStatus(mode === "mock" || mode === "visualTest" ? "ended" : "idle");
    setErrorMessage(null);
    setIsAwaitingAgentResponse(false);
    setLimitWarning(false);
    setIsMuted(false);
    sessionGenerationRef.current += 1;
    localConversationIdRef.current = createLocalConversationId();
  }, [mode]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      if (raw) {
        setHistory((JSON.parse(raw) as RoleplayHistoryItem[]).slice(0, 12));
      }
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupTimers();
      clearStartGate();
      if (isActiveStatus(statusRef.current) || statusRef.current === "connecting") {
        conversation.endSession();
      }
    };
  }, [conversation]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (isActiveStatus(statusRef.current)) {
        conversation.endSession();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [conversation]);

  const handleNormalizedEvent = useCallback(
    (
      event: NormalizedConversationEvent,
      generation: number,
      conversationLocalId: string
    ) => {
      if (
        generation !== sessionGenerationRef.current ||
        conversationLocalId !== localConversationIdRef.current
      ) {
        return;
      }

      const now = Date.now();
      if (event.role === "agent") {
        clearAgentResponseTimer();
        setIsAwaitingAgentResponse(false);
      }

      dispatchMessages({
        type: "append",
        message: createTranscriptMessage({
          role: event.role,
          channel: event.channel,
          text: event.text,
          status: event.isFinal ? "final" : "interim",
          source: "sdk",
          sdkMessageId: event.sdkMessageId,
          createdAt: now,
        }),
      });
    },
    []
  );

  const startConversation = useCallback(async () => {
    await startConversationInternal("call");
  }, []);

  const endConversation = useCallback(async () => {
    cleanupTimers();
    clearAgentResponseTimer();
    clearStartGate();
    setIsAwaitingAgentResponse(false);

    if (modeRef.current === "mock" || modeRef.current === "visualTest") {
      setStatus("ended");
      persistHistory();
      return;
    }

    if (modeRef.current === "fakeLive") {
      await fakeAdapterRef.current?.end();
      setStatus("ended");
      persistHistory();
      return;
    }

    if (isActiveStatus(statusRef.current) || statusRef.current === "connecting") {
      setStatus("ending");
      conversation.endSession();
    } else {
      setStatus("ended");
    }
  }, [conversation]);

  const startNewConversation = useCallback(async () => {
    if (
      modeRef.current !== "visualTest" &&
      isActiveStatus(statusRef.current) &&
      !window.confirm("現在の会話を終了して新しい会話を開始しますか？")
    ) {
      return;
    }

    sessionGenerationRef.current += 1;
    localConversationIdRef.current = createLocalConversationId();
    cleanupTimers();
    clearAgentResponseTimer();
    clearStartGate();
    persistHistory();

    if (modeRef.current === "fakeLive") {
      await fakeAdapterRef.current?.end();
    } else if (modeRef.current === "live") {
      conversation.endSession();
    }

    dispatchMessages({
      type: "reset",
      messages:
        modeRef.current === "mock" || modeRef.current === "visualTest"
          ? initialMessagesForMode(modeRef.current)
          : [],
    });
    setErrorMessage(null);
    setLimitWarning(false);
    setIsAwaitingAgentResponse(false);
    setIsMuted(false);
    setStatus(modeRef.current === "mock" || modeRef.current === "visualTest" ? "ended" : "idle");
  }, [conversation]);

  const sendTextMessage = useCallback(
    async (text: string, retryClientMessageId?: string) => {
      const trimmed = text.trim();
      if (!canSendMessage(trimmed)) {
        return;
      }

      const clientMessageId = retryClientMessageId ?? createClientMessageId();
      if (retryClientMessageId) {
        dispatchMessages({
          type: "updateTextAndStatus",
          clientMessageId,
          text: trimmed,
          status: "sending",
        });
      } else {
        dispatchMessages({
          type: "append",
          message: createTranscriptMessage({
            id: clientMessageId,
            role: "user",
            channel: "chat",
            text: trimmed,
            status: "sending",
            source: modeRef.current === "mock" ? "mock" : "local",
            clientMessageId,
          }),
        });
      }

      try {
        if (modeRef.current === "mock" || modeRef.current === "visualTest") {
          dispatchMessages({ type: "updateStatus", clientMessageId, status: "sent" });
          window.setTimeout(() => {
            dispatchMessages({
              type: "append",
              message: convertLegacyMockMessage(buildMockAgentResponse(trimmed, Date.now())),
            });
          }, modeRef.current === "visualTest" ? 0 : 250);
          return;
        }

        await ensureSessionStarted("text");

        if (modeRef.current === "fakeLive") {
          dispatchMessages({ type: "updateStatus", clientMessageId, status: "sent" });
          setIsAwaitingAgentResponse(true);
          armAgentResponseTimeout();
          await fakeAdapterRef.current?.sendText(trimmed, sessionGenerationRef.current);
          return;
        }

        conversation.sendUserMessage(trimmed);
        dispatchMessages({ type: "updateStatus", clientMessageId, status: "sent" });
        setIsAwaitingAgentResponse(true);
        armAgentResponseTimeout();
      } catch {
        dispatchMessages({ type: "updateStatus", clientMessageId, status: "failed" });
        setErrorMessage(SAFE_SESSION_ERROR);
      }
    },
    [conversation]
  );

  const toggleMute = useCallback(async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (modeRef.current === "fakeLive") {
      await fakeAdapterRef.current?.setMuted(nextMuted);
      setStatus(nextMuted ? "muted" : "connected");
      return;
    }
    if (modeRef.current === "live" && isActiveStatus(statusRef.current)) {
      conversation.setMuted(nextMuted);
    }
    setStatus((current) => (nextMuted ? "muted" : current === "muted" ? "connected" : current));
  }, [conversation, isMuted]);

  const setOutputVolume = useCallback(
    (nextVolume: number): Promise<void> => {
      setVolume(nextVolume);
      if (modeRef.current === "live") {
        conversation.setVolume({ volume: nextVolume });
      }
      return Promise.resolve();
    },
    [conversation]
  );

  const changeInputDevice = useCallback(
    async (deviceId: string) => {
      setSelectedInput(deviceId);
      if (modeRef.current === "live" && isActiveStatus(statusRef.current)) {
        await conversation.changeInputDevice({
          inputDeviceId: deviceId,
          format: "pcm",
          sampleRate: 16000,
        });
      }
    },
    [conversation]
  );

  const getInputVolume = useCallback(() => {
    if (modeRef.current === "fakeLive") {
      return fakeAdapterRef.current?.getInputVolume() ?? 0;
    }
    return conversation.getInputVolume();
  }, [conversation]);

  const getOutputVolume = useCallback(() => {
    if (modeRef.current === "fakeLive") {
      return fakeAdapterRef.current?.getOutputVolume() ?? 0;
    }
    return conversation.getOutputVolume();
  }, [conversation]);

  async function startConversationInternal(trigger: StartTrigger) {
    if (modeRef.current === "mock" || modeRef.current === "visualTest") {
      setStatus("connected");
      setErrorMessage(null);
      return;
    }

    if (
      statusRef.current === "connecting" ||
      isActiveStatus(statusRef.current) ||
      startRef.current
    ) {
      if (startRef.current) {
        await startRef.current.promise;
      }
      return;
    }

    if (
      trigger === "text" &&
      modeRef.current === "live" &&
      !window.confirm(
        "メッセージ送信のため音声セッションを開始します。ブラウザのマイク許可が表示される場合があります。開始しますか？"
      )
    ) {
      throw new Error("session start cancelled");
    }

    setStatus("connecting");
    setErrorMessage(null);
    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;
    const conversationLocalId = localConversationIdRef.current;
    const deferred = createStartDeferred(generation, conversationLocalId);
    startRef.current = deferred;

    if (modeRef.current === "fakeLive") {
      fakeAdapterRef.current = createFakeLiveAdapter({
        onConnect: (eventGeneration) =>
          handleConnect(eventGeneration, conversationLocalId),
        onDisconnect: (eventGeneration) =>
          handleDisconnect(eventGeneration, conversationLocalId),
        onMessage: (event, eventGeneration) =>
          handleNormalizedEvent(event, eventGeneration, conversationLocalId),
      });
      await fakeAdapterRef.current.start(generation);
      await deferred.promise;
      return;
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        for (const track of permissionStream.getTracks()) {
          track.stop();
        }
      }

      const response = await fetch("/api/voice/session-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: ADECCO_SCENARIO_ID,
          participantName: "demo-user",
        }),
      });
      const data = (await response.json()) as {
        conversationToken?: string;
        error?: string;
      };
      if (!response.ok || !data.conversationToken) {
        throw new Error(data.error ?? SAFE_SESSION_ERROR);
      }

      conversation.startSession({
        conversationToken: data.conversationToken,
        connectionType: "webrtc",
        userId: "demo-user",
        onConnect: () => handleConnect(generation, conversationLocalId),
        onDisconnect: () => handleDisconnect(generation, conversationLocalId),
        onError: () => handleError(generation, conversationLocalId),
        onStatusChange: ({ status: sdkStatus }) => {
          if (
            generation !== sessionGenerationRef.current ||
            conversationLocalId !== localConversationIdRef.current
          ) {
            return;
          }
          if (sdkStatus === "connecting") {
            setStatus("connecting");
          }
          if (sdkStatus === "disconnecting") {
            setStatus("ending");
          }
          if (sdkStatus === "disconnected" && statusRef.current !== "error") {
            setStatus("ended");
          }
        },
        onModeChange: ({ mode: sdkMode }) => {
          if (
            generation !== sessionGenerationRef.current ||
            conversationLocalId !== localConversationIdRef.current
          ) {
            return;
          }
          setStatus((current) => {
            if (current === "muted") {
              return current;
            }
            return sdkMode === "speaking" ? "speaking" : "listening";
          });
        },
        onMessage: (event) => {
          const normalized = normalizeConversationEvent(event);
          if (normalized) {
            handleNormalizedEvent(normalized, generation, conversationLocalId);
          }
        },
      });

      await deferred.promise;
    } catch (error) {
      handleError(generation, conversationLocalId);
      throw error;
    }
  }

  async function ensureSessionStarted(trigger: StartTrigger) {
    if (isActiveStatus(statusRef.current)) {
      return;
    }
    if (startRef.current) {
      await startRef.current.promise;
      return;
    }
    await startConversationInternal(trigger);
  }

  function handleConnect(
    generation: number,
    conversationLocalId = localConversationIdRef.current
  ) {
    if (
      generation !== sessionGenerationRef.current ||
      conversationLocalId !== localConversationIdRef.current
    ) {
      return;
    }
    setStatus("connected");
    setErrorMessage(null);
    if (modeRef.current === "live" && isMutedRef.current) {
      conversation.setMuted(true);
    }
    armSessionLimit();
    resolveStartGate(generation);
  }

  function handleDisconnect(
    generation: number,
    conversationLocalId = localConversationIdRef.current
  ) {
    if (
      generation !== -1 &&
      (generation !== sessionGenerationRef.current ||
        conversationLocalId !== localConversationIdRef.current)
    ) {
      return;
    }
    cleanupTimers();
    clearAgentResponseTimer();
    setIsAwaitingAgentResponse(false);
    setStatus((current) => (current === "error" ? current : "ended"));
    clearStartGate();
    persistHistory();
  }

  function handleError(
    generation: number,
    conversationLocalId = localConversationIdRef.current
  ) {
    if (
      generation !== sessionGenerationRef.current ||
      conversationLocalId !== localConversationIdRef.current
    ) {
      return;
    }
    cleanupTimers();
    clearAgentResponseTimer();
    setIsAwaitingAgentResponse(false);
    setStatus("error");
    setErrorMessage(SAFE_SESSION_ERROR);
    rejectStartGate(generation, new Error(SAFE_SESSION_ERROR));
  }

  function createStartDeferred(
    generation: number,
    conversationLocalId: string
  ): DeferredStart {
    let resolve: () => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const promise = new Promise<void>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    promise.catch(() => undefined);
    const timeoutId = window.setTimeout(() => {
      if (
        generation !== sessionGenerationRef.current ||
        conversationLocalId !== localConversationIdRef.current
      ) {
        return;
      }
      setStatus("error");
      setErrorMessage(SAFE_SESSION_ERROR);
      rejectStartGate(generation, new Error("session start timeout"));
    }, CONNECT_TIMEOUT_MS);
    return { generation, conversationLocalId, promise, resolve, reject, timeoutId };
  }

  function resolveStartGate(generation: number) {
    const deferred = startRef.current;
    if (!deferred || deferred.generation !== generation) {
      return;
    }
    window.clearTimeout(deferred.timeoutId);
    deferred.resolve();
    startRef.current = null;
  }

  function rejectStartGate(generation: number, error: Error) {
    const deferred = startRef.current;
    if (!deferred || deferred.generation !== generation) {
      return;
    }
    window.clearTimeout(deferred.timeoutId);
    deferred.reject(error);
    startRef.current = null;
  }

  function clearStartGate() {
    const deferred = startRef.current;
    if (!deferred) {
      return;
    }
    window.clearTimeout(deferred.timeoutId);
    deferred.reject(new Error("session start cancelled"));
    startRef.current = null;
  }

  function armSessionLimit() {
    cleanupTimers();
    sessionWarningRef.current = window.setTimeout(() => {
      setLimitWarning(true);
    }, Math.max(0, SESSION_LIMIT_MS - 60_000));
    sessionTimerRef.current = window.setTimeout(() => {
      void endConversation();
    }, SESSION_LIMIT_MS);
  }

  function cleanupTimers() {
    if (sessionTimerRef.current) {
      window.clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    if (sessionWarningRef.current) {
      window.clearTimeout(sessionWarningRef.current);
      sessionWarningRef.current = null;
    }
  }

  function armAgentResponseTimeout() {
    clearAgentResponseTimer();
    agentResponseTimerRef.current = window.setTimeout(() => {
      setIsAwaitingAgentResponse(false);
      setErrorMessage("応答を受信できませんでした。必要に応じてもう一度お試しください。");
    }, AGENT_RESPONSE_TIMEOUT_MS);
  }

  function clearAgentResponseTimer() {
    if (agentResponseTimerRef.current) {
      window.clearTimeout(agentResponseTimerRef.current);
      agentResponseTimerRef.current = null;
    }
  }

  function persistHistory() {
    const turns = messagesRef.current.filter((message) => message.role !== "system").length;
    if (turns === 0) {
      return;
    }
    const item: RoleplayHistoryItem = {
      id: `history-${Date.now()}`,
      title: "住宅設備メーカー 初回派遣オーダー",
      endedAt: new Date().toISOString(),
      turns,
    };
    setHistory((current) => {
      const next = [item, ...current].slice(0, 12);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  const isConnected = isActiveStatus(status);
  const isConnecting = status === "connecting";

  return useMemo(
    () => ({
      mode,
      status,
      messages,
      history,
      isConnected,
      isConnecting,
      isMuted,
      isAgentSpeaking: status === "speaking",
      isAwaitingAgentResponse,
      errorMessage,
      limitWarning,
      selectedInput,
      setSelectedInput,
      volume,
      startConversation,
      endConversation,
      startNewConversation,
      sendTextMessage,
      toggleMute,
      setOutputVolume,
      changeInputDevice,
      getInputVolume,
      getOutputVolume,
    }),
    [
      mode,
      status,
      messages,
      history,
      isConnected,
      isConnecting,
      isMuted,
      isAwaitingAgentResponse,
      errorMessage,
      limitWarning,
      selectedInput,
      volume,
      startConversation,
      endConversation,
      startNewConversation,
      sendTextMessage,
      toggleMute,
      setOutputVolume,
      changeInputDevice,
      getInputVolume,
      getOutputVolume,
    ]
  );
}

function initialMessagesForMode(mode: RoleplayMode): TranscriptMessage[] {
  if (mode !== "mock" && mode !== "visualTest") {
    return [];
  }
  return MOCK_INITIAL_TRANSCRIPT.map(convertLegacyMockMessage);
}

function convertLegacyMockMessage(message: {
  id: string;
  role: "agent" | "user";
  text: string;
  at: number;
}): TranscriptMessage {
  return {
    id: message.id,
    role: message.role,
    channel: message.role === "user" ? "chat" : "voice",
    text: message.text,
    status: "final",
    source: "mock",
    createdAt: message.at,
  };
}

function createLocalConversationId() {
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createClientMessageId() {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
