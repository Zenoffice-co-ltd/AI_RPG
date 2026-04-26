# ElevenLabs Live API / React SDK Smoke Issue

## Summary

We are integrating ElevenLabs Conversational AI through `@elevenlabs/react` in
a Next.js app deployed to Google Cloud Run. The server-side session token
endpoint succeeds and returns a conversation token, but real browser and real
microphone transcript verification is still pending. Headless fake-media checks
showed that pinning `livekit-client` to `2.16.1` avoids the newer `/rtc/v1`
signaling path, but headless media is not sufficient for release acceptance.

## Environment

- App: Next.js / React
- Package: `@elevenlabs/react@1.2.1`
- Package: `@elevenlabs/client@1.3.1`
- Package: `livekit-client@2.16.1`
- Browser: Chrome stable required for pending real-mic smoke
- OS: Windows
- Local URL: `http://127.0.0.1:3000/demo/adecco-roleplay`
- Production URL: `https://mendan-mvk3ouxwza-an.a.run.app/demo/adecco-roleplay`
- GCP Project: `adecco-mendan`
- Cloud Run Service: `roleplay-ui`
- Cloud Run Region: `asia-northeast1`
- Cloud Run Revision: `roleplay-ui-00009-2dw`

## What Works

- Server-side session token endpoint returns 200.
- Conversation token is returned.
- API key is not exposed to browser responses.
- UI renders correctly.
- Mock, visualTest, and fakeLive paths pass tests.
- `/rtc/v1` error was avoided by pinning `livekit-client` to `2.16.1`.
- Production runtime is being moved to `adecco-mendan` Secret Manager for
  `ELEVENLABS_API_KEY`; cross-project `zapier-transfer` fallback is not used in
  `NODE_ENV=production`.

## What Fails Or Remains Pending

- Real browser and real microphone smoke is pending.
- Agent initial audio, Agent transcript, User voice transcript, mute ON/OFF,
  and New Conversation after a real session still require human-operated
  verification.

## Latest Observed Failure Template

- Timestamp:
- Browser:
- OS:
- URL:
- Session token request status:
- LiveKit room connection state:
- Disconnect reason:
- SDK error object summary:
- Browser console summary:
- Network summary:
- Cloud Run log summary:

Do not paste API keys, full conversation tokens, full session IDs, or raw
secret values into this file. Redact any HAR, screenshot, or log before sharing.

## Questions

1. Which `livekit-client` version is officially supported with
   `@elevenlabs/react@1.2.1`?
2. Is `/rtc/v1` expected for the current Conversational AI endpoint?
3. Are there known compatibility issues with Cloud Run hosted Next.js apps?
4. Are there required CSP `connect-src` / WebSocket domains for Conversational
   AI?
5. Is the provided Agent / Branch configuration expected to allow browser Live
   sessions?
6. Are there entitlement, plan, quota, or Agent configuration restrictions that
   can cause immediate session termination?

## Redacted IDs

- Agent ID: `agent_...7zcc`
- Branch ID: `agtbrch_...6b`
- Session ID: not recorded
