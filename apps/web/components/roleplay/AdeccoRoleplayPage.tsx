import { cookies } from "next/headers";
import { RoleplayShell } from "@/components/roleplay/RoleplayShell";
import {
  DEMO_ACCESS_COOKIE,
  shouldRequireDemoAccess,
  verifyAccessSignature,
} from "@/lib/roleplay/auth";
import { assertDemoAccessEnvForProduction } from "@/lib/roleplay/server-env";

export type DemoPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function AdeccoRoleplayPage({
  searchParams,
  accessAction,
}: DemoPageProps & { accessAction: string }) {
  try {
    assertDemoAccessEnvForProduction();
  } catch {
    return <ServiceUnavailable />;
  }

  const cookieStore = await cookies();
  const hasAccess = verifyAccessSignature(cookieStore.get(DEMO_ACCESS_COOKIE)?.value);
  const params = await searchParams;
  const mock = stringParam(params["mock"]) === "1";
  const visualTest = stringParam(params["visualTest"]) === "1";
  const fakeLive = stringParam(params["fakeLive"]) === "1";

  if (shouldRequireDemoAccess() && !hasAccess && !visualTest) {
    return (
      <AccessGate
        denied={stringParam(params["access"]) === "denied"}
        accessAction={accessAction}
      />
    );
  }

  return (
    <RoleplayShell
      initialMock={mock || visualTest}
      visualTest={visualTest}
      fakeLive={fakeLive && !mock && !visualTest}
    />
  );
}

function AccessGate({
  denied,
  accessAction,
}: {
  denied: boolean;
  accessAction: string;
}) {
  return (
    <main className="roleplay-access">
      <form action={accessAction} method="post" className="roleplay-access__panel">
        <h1>MENDAN AIロープレ</h1>
        <p>デモを開始するにはアクセスコードを入力してください。</p>
        <input
          className="roleplay-access__input"
          name="token"
          type="password"
          autoComplete="current-password"
          aria-label="アクセスコード"
          placeholder="アクセスコード"
        />
        {denied ? <span role="alert">アクセスコードを確認してください。</span> : null}
        <button type="submit">開始</button>
      </form>
    </main>
  );
}

function ServiceUnavailable() {
  return (
    <main className="roleplay-access">
      <section className="roleplay-access__panel">
        <h1>MENDAN AIロープレ</h1>
        <p>ただいまデモを利用できません。時間をおいて再試行してください。</p>
      </section>
    </main>
  );
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
