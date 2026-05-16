---
name: ai-rpg-grok-first-v50-guard-verification
description: Use when verifying or reporting Grok-first v50 fixed guard behavior, guard smoke, assistant-only drain, spreadsheet-defined guard test plans, or browser E2E evidence for `/demo/adecco-roleplay-v50*` and `/api/grok-first-v50*`.
---

# AI RPG Grok-first v50 Guard Verification

Use this skill for v50 fixed guard verification and evidence. Keep prompt
identity, guardrail identity, and runtime guard changes separate.

## Canonical Sources

- `AGENTS.md` `## Secrets` and `## Working Defaults`
- `docs/GROK_VOICE_ROLEPLAY.md`
- `.agents/skills/ai-rpg-acceptance-verification/SKILL.md`

## Preflight First

Before any long-running run:

1. State the denominator: `5-case harness`, `13/13 guard smoke`, `69 P0 guards`,
   or `93-turn full`.
2. If the plan is Excel/Sheets, inspect sheets and confirm a runner exists for
   every required case set. Missing runner is a blocker; do not call a narrower
   harness final DoD.
3. Confirm the runner/package script exists. If a direct node script is used,
   explain why.
4. Confirm secrets without printing values:
   - `DEMO_ACCESS_TOKEN` env or Secret Manager `demo-access-token`
   - `XAI_RELAY_TICKET_SECRET` for relay-ticket v50/v25 routes
   - `XAI_API_KEY` for normal Grok realtime/voice paths
5. Check stale local Next dev servers and target ports before starting. Reuse an
   existing server only after one target event route capture succeeds.

## Browser E2E Rules

- Start Next dev from `apps/web`, not the repo root, so workspace package links
  resolve consistently.
- On Windows, stop only the child process tree for a dev server you started.
  Do not kill arbitrary Node processes; check PID/port first.
- Capture the v50-family event route directly. v50 routes do not emit through
  `/api/v3/event` unless a harness explicitly forwards events there.
- For fixed guard turns, require `guard.detected`,
  `fixed_guard.playback.started`, `fixed_guard.playback.completed`, and
  `turn.completed`.
- Require `routePath=fixed_guard`, expected `guardAction`,
  `audioSource=static_guard_pcm_base64`, `audioBytes > 0`,
  `firstAudibleAudioMs != null`, fixed text exact match, no `<missing>`, and no
  LLM response displayed.

## Reporting

Always distinguish scoped harness evidence from final DoD:

- `5/5 x3 back-to-back fixed_external`
- `13/13 x3 guard smoke`
- `69/69 P0 guards`
- `93-turn full`

If a broader runner is missing, report `NOT COMPLETE: runner missing` and list
the implemented narrower evidence separately.
