"use client";

import { useEffect, useMemo, useState } from "react";
import { TopBar } from "./TopBar";
import { OrbStage } from "./OrbStage";
import { TranscriptPanel } from "./TranscriptPanel";
import {
  useRoleplayConversation,
  type RoleplayConversation,
} from "@/lib/roleplay/useRoleplayConversation";
import type { RoleplayMode, RoleplayStatus } from "@/lib/roleplay/conversation-types";

type RoleplayClientProps = {
  initialMock: boolean;
  visualTest: boolean;
  fakeLive: boolean;
};

export function AdeccoOrbClient({
  initialMock,
  visualTest,
  fakeLive,
}: RoleplayClientProps) {
  const [mode, setMode] = useState<RoleplayMode>(() =>
    initialMode(initialMock, visualTest, fakeLive)
  );
  const roleplay = useRoleplayConversation(mode);

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
      <TopBar />
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
          isAwaitingAgentResponse={roleplay.isAwaitingAgentResponse}
          onSend={roleplay.sendTextMessage}
          onRetry={(message) => {
            void roleplay.sendTextMessage(message.text, message.clientMessageId);
          }}
          onNewConversation={() => {
            void roleplay.startNewConversation();
          }}
        />
      </section>
    </main>
  );
}

function initialMode(
  initialMock: boolean,
  visualTest: boolean,
  fakeLive: boolean
): RoleplayMode {
  if (visualTest) {
    return "visualTest";
  }
  if (fakeLive) {
    return "fakeLive";
  }
  return initialMock ? "mock" : "live";
}

async function handleCall(roleplay: RoleplayConversation) {
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
