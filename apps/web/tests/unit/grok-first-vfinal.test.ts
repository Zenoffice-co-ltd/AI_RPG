import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RELAY_TICKET_PATH,
  verifyRelayTicket,
} from "@top-performer/grok-realtime-relay-auth";
import {
  VFINAL_API_ACCESS_COOKIE,
  VFINAL_ACCESS_COOKIE,
  createVFinalInviteToken,
  createVFinalSessionToken,
} from "../../lib/grok-first-roleplay/vfinal-auth";
import { clearVFinalRateLimitForTests } from "../../lib/grok-first-roleplay/vfinal-rate-limit";

const SECRET = "0123456789abcdef0123456789abcdef";
const PARTICIPANT_HASH = "abcdef1234567890";

vi.mock("server-only", () => ({}));

function sessionCookie() {
  return createVFinalSessionToken({
    participantIdHash: PARTICIPANT_HASH,
    exp: Math.floor(Date.now() / 1000) + 3600,
    signingSecret: `${SECRET}\n`,
  });
}

function validSessionRequest() {
  return new NextRequest("http://127.0.0.1:3000/api/grok-first-vFinal/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
      referer: "http://127.0.0.1:3000/demo/adecco-roleplay-vFinal",
      cookie: `${VFINAL_API_ACCESS_COOKIE}=${sessionCookie()}`,
    },
    body: JSON.stringify({}),
  });
}

function validEventRequest(body: Record<string, unknown>) {
  return new NextRequest("http://127.0.0.1:3000/api/grok-first-vFinal/event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
      referer: "http://127.0.0.1:3000/demo/adecco-roleplay-vFinal",
      cookie: `${VFINAL_API_ACCESS_COOKIE}=${sessionCookie()}`,
    },
    body: JSON.stringify(body),
  });
}

function validInviteConsumeRequest(invite: string) {
  return new NextRequest("http://127.0.0.1:3000/api/grok-first-vFinal/invite/consume", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
      referer: "http://127.0.0.1:3000/demo/adecco-roleplay-vFinal/access",
    },
    body: JSON.stringify({ invite }),
  });
}

function signedInviteWithPayload(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `mvi1.${encoded}.${signature}`;
}

describe("grok-first vFinal security contract", () => {
  beforeEach(() => {
    vi.stubEnv("XAI_RELAY_TICKET_SECRET", SECRET);
    vi.stubEnv("GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET", `${SECRET}\n`);
    vi.stubEnv("GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET", `${SECRET}\n`);
    vi.stubEnv("GROK_VOICE_RELAY_WS_URL", "wss://voice.mendan.biz/api/v3/realtime-relay");
    vi.stubEnv("GROK_VOICE_RELAY_EXPECTED_AUD", "voice.mendan.biz");
    clearVFinalRateLimitForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    clearVFinalRateLimitForTests();
  });

  it("returns relay auth and public metadata without prompt or hidden history", async () => {
    const { POST } = await import("../../app/api/grok-first-vFinal/session/route");
    const response = await POST(validSessionRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body["demoSlug"]).toBe("adecco-roleplay-vFinal");
    expect(body["backend"]).toBe("grok-first-vFinal");
    expect(body["realtimeTransport"]).toBe("mendan_cloud_run_relay_wss");
    expect(body["wsUrl"]).toBe("wss://voice.mendan.biz/api/v3/realtime-relay");
    expect(body["publicGreeting"]).toBeTypeOf("string");
    expect(body["instructions"]).toBeUndefined();
    expect(body["firstMessage"]).toBeUndefined();
    expect(body["hiddenAssistantHistory"]).toBeUndefined();
    expect(body["tools"]).toBeUndefined();
    expect(body["ephemeralToken"]).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("あなたは常に");
    expect(JSON.stringify(body)).not.toContain("0123456789abcdef");

    const auth = body["realtimeAuth"] as Record<string, unknown>;
    expect(auth).toMatchObject({
      mode: "mendan_relay_subprotocol",
      protocol: "mendan-relay-v1",
    });
    const verification = verifyRelayTicket({
      ticket: String(auth["ticket"]),
      secret: SECRET,
      expectedAud: "voice.mendan.biz",
      expectedPath: DEFAULT_RELAY_TICKET_PATH,
    });
    expect(verification).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-vFinal",
        backend: "grok-first-vFinal",
        participantIdHash: PARTICIPANT_HASH,
      },
    });
  });

  it("serves fragment bootstrap and rejects legacy query invite access", async () => {
    const { GET } = await import("../../app/demo/adecco-roleplay-vFinal/access/route");
    const bootstrap = GET(
      new NextRequest("http://127.0.0.1:3000/demo/adecco-roleplay-vFinal/access", {
        method: "GET",
      })
    );
    expect(bootstrap.status).toBe(200);
    const html = await bootstrap.text();
    expect(html).toContain("window.location.hash");
    expect(html).toContain("/api/grok-first-vFinal/invite/consume");
    expect(html).not.toContain("mvi1.");

    const legacy = GET(
      new NextRequest(
        "http://127.0.0.1:3000/demo/adecco-roleplay-vFinal/access?invite=mvi1.raw-token",
        { method: "GET" }
      )
    );
    expect(legacy.status).toBe(410);
    expect(await legacy.text()).not.toContain("mvi1.raw-token");
  });

  it("sets vFinal-scoped invite cookies from POST body without raw participant id", async () => {
    const invite = createVFinalInviteToken({
      participantId: "adecco-user-001@example.test",
      exp: Math.floor(Date.now() / 1000) + 3600,
      signingSecret: `${SECRET}\n`,
    });
    const { POST } = await import("../../app/api/grok-first-vFinal/invite/consume/route");
    const response = await POST(validInviteConsumeRequest(invite));

    expect(response.status).toBe(307);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(VFINAL_ACCESS_COOKIE);
    expect(setCookie).toContain(VFINAL_API_ACCESS_COOKIE);
    expect(setCookie).toContain("Path=/demo/adecco-roleplay-vFinal");
    expect(setCookie).toContain("Path=/api/grok-first-vFinal");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
    expect(setCookie).not.toContain("adecco-user-001");
    expect(setCookie).not.toContain(invite);
  });

  it("logs only safe invite failure reason codes", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const invite = `${createVFinalInviteToken({
      participantId: "adecco-user-001@example.test",
      exp: Math.floor(Date.now() / 1000) + 3600,
      signingSecret: SECRET,
    })}tampered`;
    const { POST } = await import("../../app/api/grok-first-vFinal/invite/consume/route");
    const response = await POST(validInviteConsumeRequest(invite));

    expect(response.status).toBe(403);
    const output = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("invite.invalid_signature");
    expect(output).not.toContain(invite);
    expect(output).not.toContain("adecco-user-001");
  });

  it("rejects expired, wrong tenant, and wrong purpose invite tokens", async () => {
    const { POST } = await import("../../app/api/grok-first-vFinal/invite/consume/route");
    const base = {
      participantId: "adecco-user-001@example.test",
      tenant: "adecco",
      purpose: "ai_roleplay",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    await expect(
      POST(validInviteConsumeRequest(signedInviteWithPayload({ ...base, exp: 1 }))).then(
        (response) => response.status
      )
    ).resolves.toBe(403);
    await expect(
      POST(
        validInviteConsumeRequest(
          signedInviteWithPayload({ ...base, tenant: "other-tenant" })
        )
      ).then((response) => response.status)
    ).resolves.toBe(403);
    await expect(
      POST(
        validInviteConsumeRequest(
          signedInviteWithPayload({ ...base, purpose: "other-purpose" })
        )
      ).then((response) => response.status)
    ).resolves.toBe(403);
  });

  it("fails closed in production when invite/hash secrets are not separated", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GROK_FIRST_VFINAL_INVITE_SIGNING_SECRET", "");
    vi.stubEnv("GROK_FIRST_VFINAL_PARTICIPANT_HASH_SECRET", "");
    const invite = createVFinalInviteToken({
      participantId: "adecco-user-001@example.test",
      exp: Math.floor(Date.now() / 1000) + 3600,
      signingSecret: SECRET,
    });
    const { POST } = await import("../../app/api/grok-first-vFinal/invite/consume/route");
    const response = await POST(validInviteConsumeRequest(invite));

    expect(response.status).toBe(403);
  });

  it("allowlists event details and drops text/transcript/instructions", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { POST } = await import("../../app/api/grok-first-vFinal/event/route");
    const response = await POST(
      validEventRequest({
        kind: "turn.completed",
        sessionId: "gfvfinal_test",
        details: {
          turnIndex: 1,
          inputMode: "text",
          userTextLen: 12,
          agentTextLen: 8,
          promptHash: "abc123def456",
          transcript: "ログ禁止",
          text: "ログ禁止",
          instructions: "ログ禁止",
          unknownKey: "ログ禁止",
        },
      })
    );

    expect(response.status).toBe(200);
    const output = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("grokFirstVFinal");
    expect(output).toContain("turnIndex");
    expect(output).toContain("userTextLen");
    expect(output).not.toContain("ログ禁止");
    expect(output).not.toContain("unknownKey");
    expect(output).not.toContain("instructions");
  });
});
