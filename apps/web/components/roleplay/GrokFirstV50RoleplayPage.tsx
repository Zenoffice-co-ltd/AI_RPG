import { cookies } from "next/headers";
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
import { assertDemoAccessEnvForProduction } from "@/lib/roleplay/server-env";
import { GrokFirstV50RoleplayShell } from "./GrokFirstV50RoleplayShell";

export type GrokFirstV50PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function GrokFirstV50RoleplayPage({
  searchParams,
}: GrokFirstV50PageProps) {
  try {
    assertDemoAccessEnvForProduction();
    const browserDodE2E =
      process.env["GROK_FIRST_V50_BROWSER_DOD_E2E"] === "1";
    if (
      !browserDodE2E &&
      !process.env["XAI_API_KEY"] &&
      process.env["NODE_ENV"] === "production"
    ) {
      throw new Error("XAI_API_KEY missing");
    }
  } catch {
    return <ServiceUnavailable />;
  }

  const params = await searchParams;
  const cookieStore = await cookies();
  const hasAccess = verifyAccessSignature(
    cookieStore.get(DEMO_ACCESS_COOKIE)?.value
  );
  const mock = stringParam(params["mock"]) === "1";
  const visualTest = stringParam(params["visualTest"]) === "1";
  const fakeLive = stringParam(params["fakeLive"]) === "1";
  const debugMetrics = stringParam(params["debugMetrics"]) === "1";

  if (shouldRequireDemoAccess() && !hasAccess && !visualTest) {
    return (
      <AccessGate
        denied={stringParam(params["access"]) === "denied"}
        accessAction="/demo/adecco-roleplay-v50/access"
      />
    );
  }

  return (
    <GrokFirstV50RoleplayShell
      initialMock={mock || visualTest}
      visualTest={visualTest}
      fakeLive={fakeLive && !mock && !visualTest}
      debugMetrics={debugMetrics}
    />
  );
}
