"use client";

import { Mic, MicOff, Phone } from "lucide-react";
import { Orb, type AgentState } from "../ui/orb";
import type { RoleplayStatus } from "@/lib/roleplay/conversation-types";

export function OrbStage({
  state,
  agentState,
  muted,
  visualTest,
  isStarting,
  getInputVolume,
  getOutputVolume,
  onCall,
  onMute,
}: {
  state: RoleplayStatus;
  agentState: AgentState;
  muted: boolean;
  visualTest: boolean;
  isStarting: boolean;
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
            className="orb-call-button"
            onClick={onCall}
            disabled={isStarting}
            aria-label={connected ? "通話を終了" : "通話を開始"}
          >
            <Phone size={31} fill="currentColor" />
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
