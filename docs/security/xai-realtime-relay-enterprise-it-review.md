# xAI Realtime Relay Enterprise IT Review

## Client Connections

User devices connect only to:

```text
https://mendan.biz TCP 443
wss://voice.mendan.biz TCP 443
```

If the app is hosted on the roleplay subdomain, also allow:

```text
https://roleplay.mendan.biz TCP 443
```

User devices do not need direct access to:

```text
wss://api.x.ai
https://api.x.ai
```

## Server-To-Server Connection

The Cloud Run relay connects to xAI:

```text
Cloud Run xai-realtime-relay -> wss://api.x.ai/v1/realtime TCP 443
```

The upstream model is pinned to:

```text
grok-voice-think-fast-1.0
```

## Secrets And Browser Auth

- `XAI_API_KEY` is stored in Google Secret Manager.
- `XAI_RELAY_TICKET_SECRET` is stored in Google Secret Manager.
- The browser never receives the xAI API key.
- v25 does not issue or return xAI ephemeral tokens.
- The browser receives only a signed MENDAN relay ticket with a 60 second TTL.
- The relay ticket is sent in `Sec-WebSocket-Protocol` as
  `mendan-relay-ticket.<ticket>`, not in a URL query parameter.

The browser WebSocket subprotocols are:

```text
mendan-relay-v1
mendan-relay-ticket.<signed-short-lived-ticket>
```

The relay accepts `mendan-relay-v1` and validates the ticket before opening the
upstream xAI WebSocket.

## Logging

The relay logs metadata only:

```text
sessionIdHash
demoSlug
routerVariant
transport
origin
host
closeCode
errorType
phase
```

The relay must not log:

```text
XAI_API_KEY
XAI_RELAY_TICKET_SECRET
relay ticket
Sec-WebSocket-Protocol raw value
raw URL query
raw audio frame
base64 audio
transcript text
user text
assistant text
instructions
prompt
```

For v25, App Hosting event ingestion also drops transcript preview fields even
if preview logging is enabled for other variants:

```text
sttTextPreview
userTextPreview
agentTextPreview
agentSpokenTextPreview
```

## Production Evidence

Completion evidence should include:

```text
/api/v3/session:
  demoSlug = adecco-roleplay-v25
  routerVariant = B_NARROW_FALLBACK_SEMANTIC
  realtimeTransport = mendan_cloud_run_relay_wss
  wsUrl = wss://voice.mendan.biz/api/v3/realtime-relay
  no ephemeralToken

Browser:
  connects to wss://voice.mendan.biz/api/v3/realtime-relay
  does not connect to wss://api.x.ai

Cloud Logging:
  grokVoice.realtimeRelay client.connected
  grokVoice.realtimeRelay ticket.accepted
  grokVoice.realtimeRelay upstream.connected
```

## 2026-05-14 roleplay.mendan.biz Update

The customer-facing v25 target is `https://roleplay.mendan.biz/demo/adecco-roleplay-v25`.
The required customer allowlist is:

```text
https://roleplay.mendan.biz TCP 443
https://voice.mendan.biz TCP 443
wss://voice.mendan.biz TCP 443
Browser permission: microphone
```

The App Hosting `hosted.app` URL is retained only for internal rollback and
verification during the custom-domain transition. It is not part of the v25
customer allowlist.

For ZAP and network checks, passive/baseline scan, TLS inspection, and TCP 443
reachability checks are acceptable. Active scans require an agreed window,
target paths, and request rate. DoS/load testing, WebSocket fuzzing, credential
stuffing, and destructive testing require separate approval.

`/api/v3/realtime-relay` requires WebSocket upgrade, allowed Origin, expected
Host, and a signed short-lived relay ticket. Plain HTTP requests returning
`401`, `403`, or `426` are expected for unauthenticated or non-upgrade access.

For `roleplay.mendan.biz` closeout evidence, `/api/v3/session` must be checked
with `origin=https://roleplay.mendan.biz`, referer
`https://roleplay.mendan.biz/demo/adecco-roleplay-v25`, the demo access cookie,
and body `{"demoSlug":"adecco-roleplay-v25"}`. The response must omit both
`ephemeralToken` and `ephemeralExpiresAt`.
