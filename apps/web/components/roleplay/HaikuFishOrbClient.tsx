"use client";

import { useEffect, useMemo, useState } from "react";
import { OrbStage } from "./OrbStage";
import { TranscriptPanel } from "./TranscriptPanel";
import {
  useHaikuFishConversation,
  type HaikuFishConversation,
} from "@/lib/roleplay/useHaikuFishConversation";
import {
  HAIKU_FISH_BACKEND_BADGE,
} from "@/lib/roleplay/haiku-fish-types";
import type {
  RoleplayMode,
  RoleplayStatus,
} from "@/lib/roleplay/conversation-types";

const ROLEPLAY_TITLE_HAIKU_FISH =
  "[A/B] 住宅設備メーカー 人事課主任 初回派遣オーダーヒアリング — Claude Haiku + Fish";

type HaikuFishOrbClientProps = {
  initialMock: boolean;
  visualTest: boolean;
  fakeLive: boolean;
  debugMetrics: boolean;
};

export function HaikuFishOrbClient({
  initialMock,
  visualTest,
  fakeLive,
  debugMetrics,
}: HaikuFishOrbClientProps) {
  const [mode, setMode] = useState<RoleplayMode>(() =>
    initialMode(initialMock, visualTest, fakeLive)
  );
  const roleplay = useHaikuFishConversation(mode, { micEnabled: true });

  useEffect(() => {
    setMode(initialMode(initialMock, visualTest, fakeLive));
  }, [initialMock, visualTest, fakeLive]);

  useEffect(() => {
    if (visualTest) {
      document.documentElement.dataset["visualTest"] = "1";
    }
    return () => {
      document.documentElement.removeAttribute("data-visual-test");
    };
  }, [visualTest]);

  const orbState = useMemo(() => toOrbState(roleplay.status), [roleplay.status]);

  return (
    <main className="roleplay-root">
      <HaikuFishTopBar />
      <section className="roleplay-grid">
        <OrbStage
          state={roleplay.status}
          agentState={visualTest ? "talking" : orbState}
          muted={roleplay.isMuted}
          visualTest={visualTest}
          getInputVolume={roleplay.getInputVolume}
          getOutputVolume={roleplay.getOutputVolume}
          onCall={() => {
            void handleCall(roleplay);
          }}
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

function HaikuFishTopBar() {
  return (
    <header className="roleplay-topbar" data-testid="roleplay-header">
      <nav className="roleplay-topbar__left" aria-label="会話ナビゲーション">
        <a className="roleplay-topbar__logo" href="https://mendan.biz/" aria-label="MENDAN">
          MENDAN
        </a>
      </nav>

      <div
        className="roleplay-topbar__title"
        title={ROLEPLAY_TITLE_HAIKU_FISH}
      >
        {ROLEPLAY_TITLE_HAIKU_FISH}
      </div>

      <div className="roleplay-topbar__branch">
        <div
          className="roleplay-branch-button"
          aria-label={HAIKU_FISH_BACKEND_BADGE}
          data-testid="haiku-fish-backend-badge"
        >
          <span>A/B</span>
          <span className="roleplay-live-badge">{HAIKU_FISH_BACKEND_BADGE}</span>
        </div>
      </div>

      <div className="roleplay-topbar__right" aria-hidden="true" />
    </header>
  );
}

function DebugMetricsPanel({
  metrics,
}: {
  metrics: HaikuFishConversation["metricsLog"];
}) {
  if (metrics.length === 0) {
    return null;
  }
  return (
    <aside
      data-testid="haiku-fish-debug-metrics"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        maxWidth: 360,
        maxHeight: 280,
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
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Latency (ms)</div>
      {metrics.slice(-5).map((m) => (
        <div key={`${m.sessionId}-${m.turnIndex}`} style={{ marginBottom: 6 }}>
          <div>turn #{m.turnIndex}</div>
          <div>llm 1stTok: {fmt(m.llmFirstTokenMs)}</div>
          <div>llm 1stSent: {fmt(m.llmFirstSentenceMs)}</div>
          <div>tts 1stAud: {fmt(m.ttsFirstAudioMs)}</div>
          <div>e2e 1stAud: {fmt(m.e2eFirstAudioMs)}</div>
          <div>e2e done: {fmt(m.e2eDoneMs)}</div>
        </div>
      ))}
    </aside>
  );
}

function fmt(value: number | null) {
  return value === null ? "—" : String(value);
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

async function handleCall(roleplay: HaikuFishConversation) {
  if (roleplay.isConnected || roleplay.isConnecting) {
    await roleplay.endConversation();
    return;
  }
  await roleplay.startConversation();
}

function toOrbState(state: RoleplayStatus) {
  if (state === "thinking" || state === "connecting") {
    return "thinking" as const;
  }
  if (state === "listening" || state === "muted") {
    return "listening" as const;
  }
  if (state === "speaking" || state === "connected") {
    return "talking" as const;
  }
  return null;
}
