---
name: ai-rpg-orb-live-ui
description: Use when changing or verifying the Adecco Orb roleplay web UI in apps/web, especially live/mock/visualTest/fakeLive conversation behavior, transcript rendering, SDK event handling, mute/session lifecycle, visual snapshots, or docs/qa.md live smoke evidence.
---

# AI RPG Orb Live UI

Use this skill for the customer-facing Orb roleplay UI under `apps/web`.

## Canonical Files

- `apps/web/app/demo/adecco-orb/page.tsx`
- `apps/web/components/roleplay/*`
- `apps/web/lib/roleplay/*`
- `apps/web/tests/e2e/app.spec.ts`
- `apps/web/tests/visual/adecco-orb.visual.spec.ts`
- `docs/qa.md`

## Mode Contract

- `live`: initial `messages=[]`; never seed fixed transcript text.
- `mock`: fixed transcript is allowed and must not contact the external voice service.
- `visualTest`: deterministic fixed UI only; freeze animation/scroll/status and keep snapshots stable.
- `fakeLive`: initial `messages=[]`; inject fake adapter events through the same normalize/reducer/MessageList path used by live.

Do not implement `fakeLive` as another static mock. Its purpose is to prove event-driven rendering without external network or microphone dependencies.

## Conversation Architecture

- Keep all SDK operations inside `useRoleplayConversation`.
- Do not call `startSession`, `sendUserMessage`, `endSession`, or `setMuted` directly from UI components.
- Route inbound conversation events through:
  `SDK/fake event -> normalizeConversationEvent -> transcriptReducer -> MessageList`.
- Use only callback names present in `node_modules/@elevenlabs/react` type definitions.
- Keep user-visible errors generic and Japanese; do not expose provider names, IDs, tokens, or upstream URLs.

## Lifecycle Guardrails

- Live and fakeLive start gates must prevent duplicate session starts.
- Session start must have a timeout and release the connecting state on failure.
- Guard every delayed callback with the active `sessionGeneration` and local conversation id.
- `startNewConversation` must end the old session, clear transcript/indicator/error, reset mute, and create a fresh local conversation id.
- Do not use `window.location.reload()` to start a new conversation.
- Failed chat sends must remain visible as failed bubbles and be retryable without duplicate bubbles.

## UI Guardrails

- If a control is requested hidden, remove the visible UI and any dead interactive affordance unless there is a product reason to keep it accessible.
- Avoid decorative controls with no behavior in the customer-facing shell.
- Header and composer changes usually affect visual snapshots; only update baselines for intentional visual changes.
- Do not relax visual thresholds to pass tests.

## Verification

Run the narrowest checks that cover the change:

```bash
pnpm --filter @top-performer/web exec eslint components/roleplay lib/roleplay --ext .ts,.tsx --ignore-pattern '**/*.test.ts' --ignore-pattern '**/*.test.tsx' --no-error-on-unmatched-pattern
pnpm --filter @top-performer/web test:e2e
pnpm --filter @top-performer/web test:visual
pnpm --filter @top-performer/web build
```

For intentional visual changes, regenerate snapshots and immediately rerun visual tests:

```bash
pnpm --filter @top-performer/web test:visual -- --update-snapshots
pnpm --filter @top-performer/web test:visual
```

When root `pnpm lint` or `pnpm typecheck` fails because of unrelated repo-wide blockers, record the exact blocker in `docs/qa.md` and still run targeted evidence for the touched files.

## Browser Evidence

- Use Browser Use for localhost checks when the user references the in-app browser.
- Verify visible removals by checking both the DOM count and the screenshot-visible behavior.
- For `fakeLive=1`, confirm initial transcript rows are `0` before exercising call/chat/mute/new-conversation.

## Live Smoke

Do not mark live complete from fakeLive, mock, or visual tests alone. `docs/qa.md` must record real browser and microphone evidence for:

- call start
- Agent initial utterance displayed
- user voice transcript displayed
- composer send and Agent response
- mute ON blocks transcript and Agent reaction
- mute OFF restores voice input
- new conversation clears old state and starts fresh
- customer-visible provider concealment

If this was not run, state `実装済み・live未検証`.
