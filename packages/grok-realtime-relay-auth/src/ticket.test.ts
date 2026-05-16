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
  overrides: Partial<Omit<RelayTicketPayload, "iat" | "exp" | "nonce">> = {}
): Omit<RelayTicketPayload, "iat" | "exp" | "nonce"> {
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
    const ticket = createRelayTicket({ secret: SECRET, payload: payload(), now: NOW });
    const result = verify(ticket.value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sessionId).toBe("gv_sess_test");
    }
  });

  it("accepts Grok-first v50 relay tickets", () => {
    const v50Ticket = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50",
        backend: "grok-first-v50",
        routerVariant: undefined,
        sessionId: "gfv50_sess_test",
      }),
      now: NOW,
    });
    const v501Ticket = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-1",
        backend: "grok-first-v50-1",
        routerVariant: undefined,
        sessionId: "gfv501_sess_test",
      }),
      now: NOW,
    });
    const v504Ticket = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-4",
        backend: "grok-first-v50-4",
        routerVariant: undefined,
        sessionId: "gfv504_sess_test",
      }),
      now: NOW,
    });
    const v505Ticket = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-5",
        backend: "grok-first-v50-5",
        routerVariant: undefined,
        sessionId: "gfv505_sess_test",
      }),
      now: NOW,
    });
    const v506Ticket = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50-6",
        backend: "grok-first-v50-6",
        routerVariant: undefined,
        sessionId: "gfv506_sess_test",
      }),
      now: NOW,
    });
    const vFinalTicket = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-vFinal",
        backend: "grok-first-vFinal",
        routerVariant: undefined,
        sessionId: "gfvfinal_sess_test",
        participantIdHash: "abcdef1234567890",
      }),
      now: NOW,
    });

    expect(verify(v50Ticket.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50",
        backend: "grok-first-v50",
      },
    });
    expect(verify(v501Ticket.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50-1",
        backend: "grok-first-v50-1",
      },
    });
    expect(verify(v504Ticket.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50-4",
        backend: "grok-first-v50-4",
      },
    });
    expect(verify(v505Ticket.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50-5",
        backend: "grok-first-v50-5",
      },
    });
    expect(verify(v506Ticket.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-v50-6",
        backend: "grok-first-v50-6",
      },
    });
    expect(verify(vFinalTicket.value)).toMatchObject({
      ok: true,
      payload: {
        demoSlug: "adecco-roleplay-vFinal",
        backend: "grok-first-vFinal",
        participantIdHash: "abcdef1234567890",
      },
    });
  });

  it("rejects mismatched Grok-first ticket identities", () => {
    const ticket = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-v50",
        backend: "grok-first-v50-1",
        routerVariant: undefined,
      }),
      now: NOW,
    });

    expect(verify(ticket.value)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects vFinal tickets without participantIdHash", () => {
    const ticket = createRelayTicket({
      secret: SECRET,
      payload: payload({
        demoSlug: "adecco-roleplay-vFinal",
        backend: "grok-first-vFinal",
        routerVariant: undefined,
      }),
      now: NOW,
    });

    expect(verify(ticket.value)).toEqual({ ok: false, reason: "malformed" });
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
    expect(verify(wrongPath.value)).toEqual({ ok: false, reason: "wrong_path" });
  });

  it("rejects modified payload or signature", () => {
    const ticket = createRelayTicket({ secret: SECRET, payload: payload(), now: NOW });
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
    const ticket = createRelayTicket({ secret: SECRET, payload: payload(), now: NOW });
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
