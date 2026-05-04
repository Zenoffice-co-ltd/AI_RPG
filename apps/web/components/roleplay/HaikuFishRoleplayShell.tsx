"use client";

import { HaikuFishOrbClient } from "@/components/roleplay/HaikuFishOrbClient";

export function HaikuFishRoleplayShell({
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
    <HaikuFishOrbClient
      initialMock={initialMock}
      visualTest={visualTest}
      fakeLive={fakeLive}
      debugMetrics={debugMetrics}
    />
  );
}
