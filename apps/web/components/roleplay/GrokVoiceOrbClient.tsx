"use client";

import { useEffect, useMemo, useState } from "react";
import { OrbStage } from "./OrbStage";
import { TranscriptPanel } from "./TranscriptPanel";
import {
  useGrokVoiceConversation,
  type GrokVoiceConversation,
} from "@/lib/roleplay/useGrokVoiceConversation";
import type {
  RoleplayMode,
  RoleplayStatus,
} from "@/lib/roleplay/conversation-types";
import type { AdeccoGrokVoiceDemoSlug } from "@/lib/roleplay/grok-voice-router-variant";

// Customer-facing demo title — no model name, no A/B label, no version
// suffix. The backend identity is intentionally hidden in the UI; all
// model / version metadata stays in server logs (`grokVoice.session.created`)
// and is recoverable via Cloud Logging when needed.
const ROLEPLAY_TITLE =
  "住宅設備メーカー 人事課主任 初回派遣オーダーヒアリング";

type GrokVoiceOrbClientProps = {
  initialMock: boolean;
  visualTest: boolean;
  fakeLive: boolean;
  debugMetrics: boolean;
  demoSlug?: AdeccoGrokVoiceDemoSlug | undefined;
};

export function GrokVoiceOrbClient({
  initialMock,
  visualTest,
  fakeLive,
  debugMetrics,
  demoSlug,
}: GrokVoiceOrbClientProps) {
  const [mode, setMode] = useState<RoleplayMode>(() =>
    initialMode(initialMock, visualTest, fakeLive)
  );
  const roleplay = useGrokVoiceConversation(mode, {
    micEnabled: true,
    demoSlug,
  });

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
      <GrokVoiceTopBar />
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

function GrokVoiceTopBar() {
  return (
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
  );
}

function DebugMetricsPanel({
  metrics,
}: {
  metrics: GrokVoiceConversation["metricsLog"];
}) {
  if (metrics.length === 0) {
    return null;
  }
  return (
    <aside
      data-testid="grok-voice-debug-metrics"
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
          <div>turn #{m.turnIndex} ({m.inputMode})</div>
          <div>1stAud: {fmt(m.firstAudioMs)}</div>
          <div>done: {fmt(m.doneMs)}</div>
          <div>audio: {m.audioBytes}B</div>
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

async function handleCall(roleplay: GrokVoiceConversation) {
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
