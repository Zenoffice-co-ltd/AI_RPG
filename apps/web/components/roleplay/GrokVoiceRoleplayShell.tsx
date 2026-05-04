"use client";

import { GrokVoiceOrbClient } from "@/components/roleplay/GrokVoiceOrbClient";

export function GrokVoiceRoleplayShell({
  initialMock,
  visualTest,
  fakeLive,
  debugMetrics,
}: {
  initialMock: boolean;
  visualTest: boolean;
  fakeLive: boolean;
  debugMetrics: boolean;
}) {
  return (
    <GrokVoiceOrbClient
      initialMock={initialMock}
      visualTest={visualTest}
      fakeLive={fakeLive}
      debugMetrics={debugMetrics}
    />
  );
}
