import { cookies } from "next/headers";
import { GrokVoiceRoleplayShell } from "@/components/roleplay/GrokVoiceRoleplayShell";
import {
  AccessGate,
  ServiceUnavailable,
  stringParam,
} from "@/components/roleplay/access-gate";
import {
  DEMO_ACCESS_COOKIE,
  shouldRequireDemoAccess,
  verifyAccessSignature,
} from "@/lib/roleplay/auth";
import {
  assertDemoAccessEnvForProduction,
  assertGrokVoiceEnvForProduction,
  isGrokVoiceRoleplayEnabled,
} from "@/lib/roleplay/server-env";

export type DemoPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function GrokVoiceRoleplayPage({
  searchParams,
  accessAction,
}: DemoPageProps & { accessAction: string }) {
  if (!isGrokVoiceRoleplayEnabled()) {
    return <ServiceUnavailable />;
  }

  try {
    assertDemoAccessEnvForProduction();
    assertGrokVoiceEnvForProduction();
  } catch {
    return <ServiceUnavailable />;
  }

  const cookieStore = await cookies();
  const hasAccess = verifyAccessSignature(cookieStore.get(DEMO_ACCESS_COOKIE)?.value);
  const params = await searchParams;
  const mock = stringParam(params["mock"]) === "1";
  const visualTest = stringParam(params["visualTest"]) === "1";
  const fakeLive = stringParam(params["fakeLive"]) === "1";
  const debugMetrics = stringParam(params["debugMetrics"]) === "1";

  if (shouldRequireDemoAccess() && !hasAccess && !visualTest) {
    return (
      <AccessGate
        denied={stringParam(params["access"]) === "denied"}
        accessAction={accessAction}
      />
    );
  }

  return (
    <GrokVoiceRoleplayShell
      initialMock={mock || visualTest}
      visualTest={visualTest}
      fakeLive={fakeLive && !mock && !visualTest}
      debugMetrics={debugMetrics}
    />
  );
}
