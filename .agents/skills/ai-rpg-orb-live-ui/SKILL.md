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

## Manual Orb Test 1〜8 Protocol (Adecco Manufacturer Order Hearing)

For the Adecco staffing roleplay scenario, manual orb verification follows a standardized 8-test script tied to Final Release DoD v2 §10. Use this script every time the prompt or voice profile changes.

### Pre-conditions (gate before running orb)

Manual orb is only meaningful AFTER all of the following:

- `pnpm publish:scenario -- --scenario staffing_order_hearing_adecco_manufacturer_busy_manager_medium` PASSED with `passed=true`, vendor smoke 8/8, non-null `binding`.
- `pnpm test` (local regression including `priorOrbFailure.regression.test.ts` + `gradeStaffingSession.test.ts`) PASSED.
- `pnpm smoke:eleven` PASSED (≤ 3 retries within a session for vendor flake).
- post-publish SAP grep clean.
- voice mirror parity confirmed against accounting profile.

If any pre-condition fails, do NOT run manual orb — the test results will not be diagnostic.

### Test execution

URL: `https://elevenlabs.io/app/talk-to?agent_id=agent_2801kpj49tj1f43sr840cvy17zcc`

Environment: Chrome, quiet room, microphone permission granted, transcript recorder ready.

1. **Test 1 — Opening line**: just open the URL; the agent should self-initiate with the natural opening (`新しい派遣会社` + `要件整理` cues), no AI/採点 self-naming.
2. **Test 2 — Shallow overview**: ask `今回の募集について概要を教えてください。` Agent must stay at `営業事務一名 / 要件整理` level only; no leak of competition / 単価 / decision / 月600〜700件.
3. **Test 3 — Background staged disclosure**: Q1 `募集背景を教えてください。` → expect 増員 / 比較したい only. Q2 `なぜ新しい派遣会社にも声かけたんですか？` → expect 供給/レスポンス課題 reveal.
4. **Test 4 — Business task staged disclosure**: Q1 `営業事務ですよね？` → 受発注/納期調整 program. Q2 `主業務はどれ？` → 受発注入力+納期調整中心. Q3 `件数や繁忙サイクルは？` → 月600〜700件 + ピーク.
5. **Test 5 — Competition/decision staged**: Q1 `他社にも並行で？` → もう一社の大手. Q2 `先行提案期間は？` → 三営業日. Q3 `決定者は？` → 人事+現場課長 二段.
6. **Test 6 — Closing summary + Adecco reverse question**: read learner's full numeric summary turn (1名/6/1/8:45-17:30/月10-15h/1750-1900円/受発注経験/水曜まで). Agent must (a) acknowledge/correct, (b) ask ONE Adecco strength/違い question.
7. **Test 7 — No coaching**: ask `何を聞けば良いですか？` Agent must give short deflection (`ご確認したい点からで大丈夫です。`); no item enumeration.
8. **Test 8 — Natural Japanese (whole-conversation observation)**: 1〜3 sentences per reply; no bullet points; `どの点についてですか` ≤ 2 in session, never 2 turns consecutive; `まだご検討中でしょうか` zero in regular replies.

### P0 blockers (immediate release stop)

If ANY of these occur during Test 1〜8, release is blocked and the agent must NOT go to production:

1. Hidden facts leaked at overview level
2. Reply lags one turn ahead
3. Agent ignores learner summary or returns generic catch-all
4. Adecco reverse question fires before learner summary
5. Adecco reverse question never fires
6. Adecco reverse question repeats 2+ times
7. `どの点についてですか` loops (2 turns consecutive, or 3+ in session)
8. SAP / Oracle / ERP / AP / 経費精算 / 支払 appears in any reply
9. Voice does not match accounting current Publish (sound check)

### Recording rule

Record actual utterances in `docs/references/adecco_manufacturer_order_hearing_memo.md` under "Post-fix orb verification" — replace any `<blocked: human orb utterance not captured>` markers with verbatim quotes.

Do NOT mark DoD H complete with `<blocked>` placeholders remaining. Real utterance evidence is required.

If a P0 blocker fires, write the failure utterance, the test number, and a one-line root cause hypothesis into the memo before closing the orb session — that becomes the next prompt-iteration input.
