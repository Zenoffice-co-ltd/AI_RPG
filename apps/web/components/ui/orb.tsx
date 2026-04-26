"use client";

import { useEffect, useMemo, useState } from "react";

export type AgentState = null | "thinking" | "listening" | "talking";

export function Orb({
  seed,
  agentState,
  visualTest,
  volumeMode = "auto",
  manualInput,
  manualOutput,
  getInputVolume,
  getOutputVolume,
}: {
  seed: number;
  agentState: AgentState;
  visualTest?: boolean;
  volumeMode?: "auto" | "manual";
  manualInput?: number;
  manualOutput?: number;
  getInputVolume?: () => number;
  getOutputVolume?: () => number;
}) {
  const [input, setInput] = useState(manualInput ?? 0.12);
  const [output, setOutput] = useState(manualOutput ?? 0.36);

  useEffect(() => {
    if (visualTest || volumeMode === "manual") {
      setInput(manualInput ?? 0.3);
      setOutput(manualOutput ?? 0.62);
      return;
    }
    const timer = window.setInterval(() => {
      setInput(clamp(getInputVolume?.() ?? 0.12));
      setOutput(clamp(getOutputVolume?.() ?? 0.22));
    }, 120);
    return () => window.clearInterval(timer);
  }, [getInputVolume, getOutputVolume, manualInput, manualOutput, visualTest, volumeMode]);

  const style = useMemo(
    () =>
      ({
        "--orb-rotate": `${(seed % 360) - 42}deg`,
        "--orb-input": String(input),
        "--orb-output": String(output),
      }) as React.CSSProperties,
    [input, output, seed]
  );

  return (
    <div
      className={`orb ${visualTest ? "orb--still" : ""} orb--${agentState ?? "idle"}`}
      style={style}
      aria-hidden="true"
    >
      <span className="orb__layer orb__layer--base" />
      <span className="orb__layer orb__layer--fan-a" />
      <span className="orb__layer orb__layer--fan-b" />
      <span className="orb__layer orb__layer--fan-c" />
      <span className="orb__layer orb__layer--shine" />
      <span className="orb__core" />
    </div>
  );
}

function clamp(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
