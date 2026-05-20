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

export type AdeccoEvaluationResultPageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function AdeccoEvaluationResultPageShell({
  params,
  searchParams,
  accessAction,
  roleplayPath,
  resultEndpoint = "/api/grok-first-v50-7/evaluation/result",
  retryEndpoint = "/api/grok-first-v50-7/evaluation/retry",
}: AdeccoEvaluationResultPageProps & {
  accessAction: string;
  roleplayPath: string;
  resultEndpoint?: string;
  retryEndpoint?: string;
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
    cookieStore.get(DEMO_ACCESS_COOKIE)?.value,
  );

  if (shouldRequireDemoAccess() && !hasAccess && !mock && !visualTest) {
    return (
      <AccessGate
        denied={stringParam(query["access"]) === "denied"}
        accessAction={accessAction}
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
      resultEndpoint={resultEndpoint}
      retryEndpoint={retryEndpoint}
      roleplayPath={roleplayPath}
      mockRuntimeVersion="v50-7"
    />
  );
}
