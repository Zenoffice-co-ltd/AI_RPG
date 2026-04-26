"use client";

import { ConversationProvider } from "@elevenlabs/react";
import { AdeccoOrbClient } from "./AdeccoOrbClient";

export function RoleplayShell({
  initialMock,
  visualTest,
  fakeLive,
}: {
  initialMock: boolean;
  visualTest: boolean;
  fakeLive: boolean;
}) {
  return (
    <ConversationProvider>
      <AdeccoOrbClient
        initialMock={initialMock}
        visualTest={visualTest}
        fakeLive={fakeLive}
      />
    </ConversationProvider>
  );
}
