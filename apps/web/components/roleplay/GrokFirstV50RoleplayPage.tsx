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
import {
  VFINAL_ACCESS_COOKIE,
  verifyVFinalAccessCookieValue,
} from "@/lib/grok-first-roleplay/vfinal-auth";
import { assertDemoAccessEnvForProduction } from "@/lib/roleplay/server-env";
import { GrokFirstV50RoleplayShell } from "./GrokFirstV50RoleplayShell";

export type GrokFirstV50RouteProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export type GrokFirstV50PageProps = GrokFirstV50RouteProps & {
  accessAction?: string;
  apiBase?:
    | "/api/grok-first-v50"
    | "/api/grok-first-v50-1"
    | "/api/grok-first-v50-2"
    | "/api/grok-first-v50-3"
    | "/api/grok-first-v50-5"
    | "/api/grok-first-v50-6"
    | "/api/grok-first-v50-7"
    | "/api/grok-first-v50-8"
    | "/api/grok-first-vFinal";
  accessMode?: "demo-token" | "vfinal-invite";
};

export async function GrokFirstV50RoleplayPage({
  searchParams,
  accessAction = "/demo/adecco-roleplay-v50/access",
  apiBase = "/api/grok-first-v50",
  accessMode = "demo-token",
}: GrokFirstV50PageProps) {
  try {
    assertDemoAccessEnvForProduction();
    if (
      !process.env["XAI_RELAY_TICKET_SECRET"] &&
      process.env["NODE_ENV"] === "production"
    ) {
      throw new Error("XAI_RELAY_TICKET_SECRET missing");
    }
  } catch {
    return <ServiceUnavailable />;
  }

  const params = await searchParams;
  const cookieStore = await cookies();
  const hasAccess =
    accessMode === "vfinal-invite"
      ? Boolean(verifyVFinalAccessCookieValue(cookieStore.get(VFINAL_ACCESS_COOKIE)?.value))
      : verifyAccessSignature(cookieStore.get(DEMO_ACCESS_COOKIE)?.value);
  const mock = stringParam(params["mock"]) === "1";
  const visualTest = stringParam(params["visualTest"]) === "1";
  const fakeLive = stringParam(params["fakeLive"]) === "1";
  const debugMetrics = stringParam(params["debugMetrics"]) === "1";

  if (accessMode === "vfinal-invite" && !hasAccess && !visualTest) {
    return <ServiceUnavailable />;
  }

  if (shouldRequireDemoAccess() && !hasAccess && !visualTest) {
    return (
      <AccessGate
        denied={stringParam(params["access"]) === "denied"}
        accessAction={accessAction}
      />
    );
  }

  return (
    <GrokFirstV50RoleplayShell
      initialMock={mock || visualTest}
      visualTest={visualTest}
      fakeLive={fakeLive && !mock && !visualTest}
      debugMetrics={debugMetrics}
      apiBase={apiBase}
    />
  );
}
