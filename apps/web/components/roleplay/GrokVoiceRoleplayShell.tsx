"use client";

import { GrokVoiceOrbClient } from "@/components/roleplay/GrokVoiceOrbClient";
import type { AdeccoGrokVoiceDemoSlug } from "@/lib/roleplay/grok-voice-router-variant";

export function GrokVoiceRoleplayShell({
  initialMock,
  visualTest,
  fakeLive,
  debugMetrics,
  demoSlug,
}: {
  initialMock: boolean;
  visualTest: boolean;
  fakeLive: boolean;
  debugMetrics: boolean;
  demoSlug?: AdeccoGrokVoiceDemoSlug | undefined;
}) {
  return (
    <GrokVoiceOrbClient
      initialMock={initialMock}
      visualTest={visualTest}
      fakeLive={fakeLive}
      debugMetrics={debugMetrics}
      demoSlug={demoSlug}
    />
  );
}
