import { cookies } from "next/headers";
import {
  AccessGate,
  ServiceUnavailable,
  stringParam,
} from "@/components/roleplay/access-gate";
import { AdeccoEvaluationResultClient } from "@/components/roleplay/evaluation/AdeccoEvaluationResultClient";
import {
  DEMO_ACCESS_COOKIE,
  shouldRequireDemoAccess,
  verifyAccessSignature,
} from "@/lib/roleplay/auth";
import { assertDemoAccessEnvForProduction } from "@/lib/roleplay/server-env";

export const dynamic = "force-dynamic";

export default async function AdeccoRoleplayV51ResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    assertDemoAccessEnvForProduction();
  } catch {
    return <ServiceUnavailable />;
  }

  const [{ sessionId }, query, cookieStore] = await Promise.all([
    params,
    searchParams,
    cookies(),
  ]);
  const mock = stringParam(query["mock"]) === "1";
  const visualTest = stringParam(query["visualTest"]) === "1";
  const debug = stringParam(query["debug"]) === "1";
  const startFailed = stringParam(query["startFailed"]) === "1";
  const hasAccess = verifyAccessSignature(
    cookieStore.get(DEMO_ACCESS_COOKIE)?.value
  );

  if (shouldRequireDemoAccess() && !hasAccess && !mock && !visualTest) {
    return (
      <AccessGate
        denied={stringParam(query["access"]) === "denied"}
        accessAction="/demo/adecco-roleplay-v51/access"
      />
    );
  }

  return (
    <AdeccoEvaluationResultClient
      sessionId={sessionId}
      mock={mock}
      visualTest={visualTest}
      debug={debug}
      startFailed={startFailed}
      resultEndpoint="/api/grok-first-v51/evaluation/result"
      retryEndpoint="/api/grok-first-v51/evaluation/retry"
      roleplayPath="/demo/adecco-roleplay-v51"
      mockRuntimeVersion="v51"
    />
  );
}
