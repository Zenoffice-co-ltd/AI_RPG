import { NextResponse, type NextRequest } from "next/server";
import { checkVFinalRateLimit } from "@/lib/grok-first-roleplay/vfinal-rate-limit";

export function GET(request: NextRequest) {
  const rate = checkVFinalRateLimit({
    scope: "vfinal.access",
    key: `ip:${clientIp(request)}`,
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: "rate limited" },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  if (request.nextUrl.searchParams.has("invite")) {
    return NextResponse.json(
      { error: "invite query links are no longer supported" },
      {
        status: 410,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  return new NextResponse(inviteFragmentBootstrapHtml(), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function POST() {
  return NextResponse.json({}, { status: 405, headers: { Allow: "GET" } });
}

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function inviteFragmentBootstrapHtml() {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Adecco AI Roleplay</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f8; color: #18181b; }
      main { width: min(92vw, 420px); padding: 24px; border: 1px solid #d4d4d8; background: #fff; border-radius: 8px; }
      p { line-height: 1.7; margin: 0; }
    </style>
  </head>
  <body>
    <main><p id="status">アクセスを確認しています。</p></main>
    <script>
      (async function () {
        const status = document.getElementById("status");
        function fail() {
          if (status) status.textContent = "アクセスを確認できませんでした。招待リンクを確認してください。";
        }
        try {
          const params = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "");
          const invite = params.get("invite");
          history.replaceState(null, "", "/demo/adecco-roleplay-vFinal/access");
          if (!invite) {
            fail();
            return;
          }
          const response = await fetch("/api/grok-first-vFinal/invite/consume", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ invite })
          });
          if (!response.ok) {
            fail();
            return;
          }
          window.location.replace("/demo/adecco-roleplay-vFinal");
        } catch {
          fail();
        }
      })();
    </script>
  </body>
</html>`;
}
