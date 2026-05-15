import { describe, expect, it } from "vitest";
import {
  DEFAULT_RELAY_TICKET_PATH,
  createRelayTicket,
  hashRelaySessionId,
  verifyRelayTicket,
  type RelayTicketPayload,
} from "./ticket";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-05-13T00:00:00.000Z");

function payload(
  overrides: Partial<Omit<RelayTicketPayload, "iat" | "exp" | "nonce">> = {},
) {
  return {
    aud: "voice.mendan.biz",
    path: DEFAULT_RELAY_TICKET_PATH,
    transport: "mendan_cloud_run_relay_wss" as const,
    demoSlug: "adecco-roleplay-v25" as const,
    routerVariant: "B_NARROW_FALLBACK_SEMANTIC" as const,
    sessionId: "gv_sess_test",
    ...overrides,
  };
}

function verify(ticket: string) {
  return verifyRelayTicket({
    ticket,
    secret: SECRET,
    expectedAud: "voice.mendan.biz",
    expectedPath: DEFAULT_RELAY_TICKET_PATH,
    now: NOW,
  });
}

describe("relay ticket auth", () => {
  it("accepts a valid ticket", () => {
    const ticket = createRelayTicket({
      secret: SECRET,
      payload: payload(),
      now: NOW,
    });
    const result = verify(ticket.value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sessionId).toBe("gv_sess_test");
    }
  });

  it("accepts valid v50-family relay tickets", () => {
    const v50 = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50",
        routerVariant: undefined,
        backend: "grok-first-v50",
      }),
      now: NOW,
    });
    const v501 = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-1",
        routerVariant: undefined,
        backend: "grok-first-v50-1",
      }),
      now: NOW,
    });
    const v504 = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-4",
        routerVariant: undefined,
        backend: "grok-first-v50-4",
      }),
      now: NOW,
    });
    const v505 = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-5",
        routerVariant: undefined,
        backend: "grok-first-v50-5",
      }),
      now: NOW,
    });
    const v506 = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-6",
        routerVariant: undefined,
        backend: "grok-first-v50-6",
      }),
      now: NOW,
    });

    expect(verify(v50.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50",
        backend: "grok-first-v50",
      },
    });
    expect(verify(v501.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50-1",
        backend: "grok-first-v50-1",
      },
    });
    expect(verify(v504.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50-4",
        backend: "grok-first-v50-4",
      },
    });
    expect(verify(v505.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50-5",
        backend: "grok-first-v50-5",
      },
    });
    expect(verify(v506.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50-6",
        backend: "grok-first-v50-6",
      },
    });
  });

  it("rejects mismatched v50 ticket identity", () => {
    const wrongBackend = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50",
        routerVariant: undefined,
        backend: "grok-first-v50-1",
      }),
      now: NOW,
    });
    const v25MissingRouter = createRelayTicket({
      secret: SECRET,
      payload: payload({ routerVariant: undefined }),
      now: NOW,
    });

    expect(verify(wrongBackend.value)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verify(v25MissingRouter.value)).toEqual({
      ok: false,
      reason: "malformed",
    });
    const v504WrongBackend = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-4",
        routerVariant: undefined,
        backend: "grok-first-v50-1",
      }),
      now: NOW,
    });
    const v506WrongBackend = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-6",
        routerVariant: undefined,
        backend: "grok-first-v50-5",
      }),
      now: NOW,
    });
    expect(verify(v504WrongBackend.value)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verify(v506WrongBackend.value)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects expired tickets", () => {
    const ticket = createRelayTicket({
      secret: SECRET,
      payload: { ...payload(), iat: 100, exp: 110, nonce: "n" },
      now: NOW,
    });
    expect(verify(ticket.value)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects future iat", () => {
    const future = Math.floor(NOW.getTime() / 1000) + 30;
    const ticket = createRelayTicket({
      secret: SECRET,
      payload: { ...payload(), iat: future, exp: future + 60, nonce: "n" },
      now: NOW,
    });
    expect(verify(ticket.value)).toEqual({ ok: false, reason: "future_iat" });
  });

  it("rejects wrong aud and path", () => {
    const wrongAud = createRelayTicket({
      secret: SECRET,
      payload: payload({ aud: "other.example" }),
      now: NOW,
    });
    expect(verify(wrongAud.value)).toEqual({ ok: false, reason: "wrong_aud" });
    const wrongPath = createRelayTicket({
      secret: SECRET,
      payload: payload({ path: "/wrong" }),
      now: NOW,
    });
    expect(verify(wrongPath.value)).toEqual({
      ok: false,
      reason: "wrong_path",
    });
  });

  it("rejects modified payload or signature", () => {
    const ticket = createRelayTicket({
      secret: SECRET,
      payload: payload(),
      now: NOW,
    });
    const [version, body, signature] = ticket.value.split(".");
    expect(verify(`${version}.${body}x.${signature}`)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(verify(`${version}.${body}.${signature}x`)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects malformed tickets without throwing on length differences", () => {
    expect(verify("")).toEqual({ ok: false, reason: "malformed" });
    expect(verify("mra1.only-two")).toEqual({ ok: false, reason: "malformed" });
    const ticket = createRelayTicket({
      secret: SECRET,
      payload: payload(),
      now: NOW,
    });
    const [version, body] = ticket.value.split(".");
    expect(verify(`${version}.${body}.short`)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("hashes session ids for logs", () => {
    expect(hashRelaySessionId("gv_sess_test")).toMatch(/^[a-f0-9]{16}$/);
  });
});
