import { cookies } from "next/headers";
import { HaikuFishRoleplayShell } from "@/components/roleplay/HaikuFishRoleplayShell";
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
  assertHaikuFishEnvForProduction,
  isHaikuFishRoleplayEnabled,
} from "@/lib/roleplay/server-env";

export type DemoPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function HaikuFishRoleplayPage({
  searchParams,
  accessAction,
}: DemoPageProps & { accessAction: string }) {
  if (!isHaikuFishRoleplayEnabled()) {
    return <ServiceUnavailable />;
  }

  try {
    assertDemoAccessEnvForProduction();
    assertHaikuFishEnvForProduction();
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
    <HaikuFishRoleplayShell
      initialMock={mock || visualTest}
      visualTest={visualTest}
      fakeLive={fakeLive && !mock && !visualTest}
      debugMetrics={debugMetrics}
    />
  );
}
