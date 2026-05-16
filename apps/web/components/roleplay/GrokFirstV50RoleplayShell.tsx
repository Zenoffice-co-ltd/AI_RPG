"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OrbStage } from "./OrbStage";
import { TranscriptPanel } from "./TranscriptPanel";
import {
  fetchGrokFirstV50Session,
  postGrokFirstV50Event,
} from "@/lib/grok-first-roleplay/client";
import { useGrokFirstRoleplayConversation } from "@/lib/grok-first-roleplay/useGrokFirstRoleplayConversation";
import type { GrokFirstV50Metric } from "@/lib/grok-first-roleplay/types";
import type {
  RoleplayMode,
  RoleplayStatus,
  TranscriptMessage,
} from "@/lib/roleplay/conversation-types";

const ROLEPLAY_TITLE =
  "住宅設備メーカー 人事課主任 初回派遣オーダーヒアリング";

export function GrokFirstV50RoleplayShell({
  initialMock,
  visualTest,
  fakeLive,
  debugMetrics,
  apiBase = "/api/grok-first-v50",
}: {
  initialMock: boolean;
  visualTest: boolean;
  fakeLive: boolean;
  debugMetrics: boolean;
  apiBase?:
    | "/api/grok-first-v50"
    | "/api/grok-first-v50-1"
    | "/api/grok-first-v50-2"
    | "/api/grok-first-v50-3"
    | "/api/grok-first-v50-5"
    | "/api/grok-first-v50-6"
    | "/api/grok-first-v50-7"
    | "/api/grok-first-v50-8"
    | "/api/grok-first-vFinal";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<RoleplayMode>(() =>
    initialMode(initialMock, visualTest, fakeLive)
  );
  const [isEndingAndRedirecting, setIsEndingAndRedirecting] = useState(false);
  const apiDeps = useMemo(
    () => ({
      fetchSession: () => fetchGrokFirstV50Session(`${apiBase}/session`),
      postEvent: (input: Parameters<typeof postGrokFirstV50Event>[0]) =>
        postGrokFirstV50Event(input, `${apiBase}/event`),
      micEnabled: true,
    }),
    [apiBase]
  );
  const roleplay = useGrokFirstRoleplayConversation(mode, apiDeps);

  useEffect(() => {
    setMode(initialMode(initialMock, visualTest, fakeLive));
  }, [initialMock, visualTest, fakeLive]);

  const orbState = useMemo(() => toOrbState(roleplay.status), [roleplay.status]);
  const browserEvaluationEnabled = apiBase === "/api/grok-first-v50-7";

  const handleCall = () => {
    if (roleplay.isConnected || roleplay.isConnecting) {
      if (browserEvaluationEnabled) {
        void endAndStartBrowserEvaluation({
          roleplay,
          router,
          isEndingAndRedirecting,
          setIsEndingAndRedirecting,
        });
        return;
      }
      void roleplay.endConversation();
      return;
    }
    void roleplay.startConversation();
  };

  return (
    <main className="roleplay-root">
      <header className="roleplay-topbar" data-testid="roleplay-header">
        <nav className="roleplay-topbar__left" aria-label="会話ナビゲーション">
          <a className="roleplay-topbar__logo" href="https://mendan.biz/" aria-label="MENDAN">
            MENDAN
          </a>
        </nav>
        <div className="roleplay-topbar__title" title={ROLEPLAY_TITLE}>
          {ROLEPLAY_TITLE}
        </div>
        <div className="roleplay-topbar__right" aria-hidden="true" />
      </header>

      <section className="roleplay-grid">
        <OrbStage
          state={roleplay.status}
          agentState={visualTest ? "talking" : orbState}
          muted={roleplay.isMuted}
          visualTest={visualTest}
          getInputVolume={roleplay.getInputVolume}
          getOutputVolume={roleplay.getOutputVolume}
          onCall={handleCall}
          onMute={() => {
            void roleplay.toggleMute();
          }}
        />
        <TranscriptPanel
          mode={mode}
          state={roleplay.status}
          messages={roleplay.messages}
          error={roleplay.errorMessage}
          limitWarning={roleplay.limitWarning}
          onSend={roleplay.sendTextMessage}
          onRetry={(message) => {
            void roleplay.sendTextMessage(message.text, message.clientMessageId);
          }}
          onNewConversation={() => {
            void roleplay.startNewConversation();
          }}
        />
      </section>
      {debugMetrics ? <DebugMetricsPanel metrics={roleplay.metricsLog} /> : null}
    </main>
  );
}

async function endAndStartBrowserEvaluation({
  roleplay,
  router,
  isEndingAndRedirecting,
  setIsEndingAndRedirecting,
}: {
  roleplay: ReturnType<typeof useGrokFirstRoleplayConversation>;
  router: ReturnType<typeof useRouter>;
  isEndingAndRedirecting: boolean;
  setIsEndingAndRedirecting: (next: boolean) => void;
}) {
  if (isEndingAndRedirecting) return;
  const session = roleplay.session;
  const messages = [...roleplay.messages];
  setIsEndingAndRedirecting(true);

  try {
    await roleplay.endConversation();
    if (!session?.sessionId) {
      setIsEndingAndRedirecting(false);
      return;
    }

    const transcript = toEvaluationTranscript(messages);
    let startFailed = transcript.length < 2;
    if (!startFailed) {
      const response = await fetch("/api/grok-first-v50-7/evaluation/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          transcript,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          source: "grok_first_v50_7_browser",
        }),
      }).catch(() => null);
      startFailed = !response?.ok;
    }

    const resultPath = `/demo/adecco-roleplay-v50-7/result/${encodeURIComponent(
      session.sessionId
    )}${startFailed ? "?startFailed=1" : ""}`;
    router.push(resultPath as Parameters<typeof router.push>[0]);
  } finally {
    setIsEndingAndRedirecting(false);
  }
}

function toEvaluationTranscript(messages: TranscriptMessage[]) {
  return messages
    .filter((message) => message.status !== "interim")
    .map((message, index) => ({
      turn_id:
        message.sdkMessageId ??
        message.clientMessageId ??
        `t${String(index + 1).padStart(3, "0")}`,
      role: message.role === "user" ? ("user" as const) : ("agent" as const),
      text: message.text.trim(),
    }))
    .filter((message) => message.text.length > 0);
}

function DebugMetricsPanel({ metrics }: { metrics: GrokFirstV50Metric[] }) {
  if (metrics.length === 0) return null;
  return (
    <aside
      data-testid="grok-first-v50-debug-metrics"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        maxWidth: 390,
        maxHeight: 320,
        overflow: "auto",
        background: "rgba(10, 14, 24, 0.92)",
        color: "#e6edf3",
        font: "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        padding: "10px 12px",
        borderRadius: 8,
        zIndex: 9999,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>v50 latency / guard</div>
      {metrics.slice(-5).map((m) => (
        <div key={`${m.sessionId}-${m.turnIndex}`} style={{ marginBottom: 6 }}>
          <div>turn #{m.turnIndex} ({m.inputMode})</div>
          <div>firstAudible: {fmt(m.firstAudibleAudioMs)}</div>
          <div>firstDelta: {fmt(m.firstAudioDeltaMs)}</div>
          <div>audioSource: {m.audioSource}</div>
          <div>sttToGuard: {fmt(m.sttCompletedToGuardDetectedMs)}</div>
          <div>guardToPlayback: {fmt(m.guardDetectedToPlaybackStartedMs)}</div>
          <div>fixedPlayback: {fmt(m.fixedPlaybackDurationMs)}</div>
          <div>tailHold: {m.tailGuardHoldMs}</div>
          <div>guard: {m.guardAction}</div>
        </div>
      ))}
    </aside>
  );
}

function initialMode(
  initialMock: boolean,
  visualTest: boolean,
  fakeLive: boolean
): RoleplayMode {
  if (visualTest) return "visualTest";
  if (fakeLive) return "fakeLive";
  return initialMock ? "mock" : "live";
}

function toOrbState(state: RoleplayStatus) {
  if (state === "thinking" || state === "connecting") return "thinking" as const;
  if (state === "listening" || state === "muted") return "listening" as const;
  if (state === "speaking" || state === "connected") return "talking" as const;
  return null;
}

function fmt(value: number | null) {
  return value === null ? "-" : String(value);
}
