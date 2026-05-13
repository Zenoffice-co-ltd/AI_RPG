import { WebSocket } from "ws";

export type CreateUpstreamInput = {
  base: string;
  model: string;
  apiKey: string;
};

export function createUpstream(input: CreateUpstreamInput): WebSocket {
  const url = new URL(input.base);
  url.searchParams.set("model", input.model);
  return new WebSocket(url.toString(), {
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    maxPayload: 8 * 1024 * 1024,
  });
}
