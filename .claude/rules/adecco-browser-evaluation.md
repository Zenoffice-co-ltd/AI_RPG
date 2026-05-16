# v50/v51 Browser Evaluation — Claude Code rule

**Source of Truth:** repository-root [`AGENTS.md`](../../AGENTS.md)
`## Browser Evaluation / Scoring Delivery SoT`. This file is the Claude-side
surface of that SoT.

## Rule

- Browser evaluation must not call Gmail.
- Keep Claude scoring core separated from delivery.
- Preserve the legacy ElevenLabs post-call webhook → Claude → Gmail path unless
  explicitly changing that workflow.
- Browser result APIs must not expose raw Claude output, API secrets, relay
  tickets, prompt instructions, raw audio, or hidden system prompts.
- Cloud Tasks payload may include only the normalized evaluation transcript
  required for scoring.
- Use the safe mock result route before production checks:
  `/demo/adecco-roleplay-v50-7/result/mock-session?mock=1`.
- For customer criteria v2 / v51 work, use:
  `/demo/adecco-roleplay-v51/result/mock-session?mock=1`.
- Do not run production Gmail smoke unless explicitly requested for the legacy
  email pipeline.
