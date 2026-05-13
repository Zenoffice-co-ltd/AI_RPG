export {
  DEFAULT_RELAY_TICKET_PATH,
  DEFAULT_RELAY_TICKET_TTL_SECONDS,
  RELAY_TICKET_VERSION,
  createRelayTicket,
  hashRelaySessionId,
  verifyRelayTicket,
  type CreateRelayTicketInput,
  type RelayTicketPayload,
  type RelayTicketVerificationResult,
  type VerifyRelayTicketInput,
} from "./ticket";
