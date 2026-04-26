"use client";

import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { Orb, type AgentState } from "../ui/orb";
import type { RoleplayStatus } from "@/lib/roleplay/conversation-types";

export function OrbStage({
  state,
  agentState,
  muted,
  visualTest,
  getInputVolume,
  getOutputVolume,
  onCall,
  onMute,
}: {
  state: RoleplayStatus;
  agentState: AgentState;
  muted: boolean;
  visualTest: boolean;
  getInputVolume: () => number;
  getOutputVolume: () => number;
  onCall: () => void;
  onMute: () => void;
}) {
  const connected =
    state === "connected" ||
    state === "listening" ||
    state === "thinking" ||
    state === "speaking" ||
    state === "muted";
  const activeOrStarting = connected || state === "connecting" || state === "ending";

  return (
    <section className="orb-stage" data-testid="left-orb-panel">
      <div className="orb-stage__center">
        <div className="orb-stage__orb-wrap">
          <Orb
            seed={2801}
            agentState={visualTest ? "talking" : agentState}
            visualTest={visualTest}
            volumeMode={visualTest ? "manual" : "auto"}
            getInputVolume={getInputVolume}
            getOutputVolume={getOutputVolume}
            {...(visualTest ? { manualInput: 0.3, manualOutput: 0.62 } : {})}
          />
          <button
            type="button"
            className={
              activeOrStarting
                ? "orb-call-button orb-call-button--active"
                : "orb-call-button"
            }
            onClick={onCall}
            aria-label={activeOrStarting ? "通話を終了" : "通話を開始"}
          >
            {activeOrStarting ? (
              <PhoneOff size={31} />
            ) : (
              <Phone size={31} fill="currentColor" />
            )}
          </button>
        </div>
      </div>
      <button type="button" className="orb-control-pill" onClick={onMute}>
        {muted ? <MicOff size={18} /> : <Mic size={18} />}
        <span>ミュート</span>
      </button>
    </section>
  );
}
