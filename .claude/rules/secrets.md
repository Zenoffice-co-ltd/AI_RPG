# Secrets — Claude Code rule

**Source of Truth:** repository-root [`AGENTS.md`](../../AGENTS.md) `## Secrets`. This file is the Claude-side surface of that SoT and intentionally re-states the contract so Claude Code instances can find it without parsing AGENTS.md.

## Rule

All API keys, tokens, and credentials are sourced from Google Secret Manager. Never hard-code keys. Never commit them to `.env*`, `config/*`, `scripts/*`, PR descriptions, issue comments, commit messages, or chat transcripts. Never write keys to disk anywhere outside the user's local-only `apps/web/.env.local` (which is gitignored).

## Resolution precedence

When code or a tool needs a key:

1. `process.env["<NAME>"]` if already set in the current shell.
2. `apps/web/.env.local` (gitignored — local-only — never commit).
3. Secret Manager via:
   ```bash
   gcloud secrets versions access latest --secret=<NAME> --project=<PROJECT>
   ```
   Project order: `SECRET_SOURCE_PROJECT_ID` env var → `zapier-transfer` (default) → `adecco-mendan` (per-tenant fallback for `XAI_API_KEY`, `ELEVENLABS_API_KEY`, etc.).

## Canonical retrieval pattern (for ad-hoc local use)

```bash
gcloud secrets versions access latest --secret=XAI_API_KEY --project=zapier-transfer
```

Pull into the current shell only — do not write the value into any tracked file.

## Reference resolver implementation

`scripts/grok-voice-v21-scenario-e2e.ts` → `loadXaiKeyFromSecretManagerIfNeeded()` is the canonical resolver shape: env first, then Secret Manager (`zapier-transfer` then `adecco-mendan`), with an explicit `BLOCKED: <NAME> not available` error if no source yields a real key (length ≥ 32, not a `test-…` placeholder).

## Codex command-approval guards

Mutating Secret Manager operations (`delete`, `versions destroy`, `versions add`, `create`, `set-iam-policy`) are gated by [`/.codex/rules/secrets.rules`](../../.codex/rules/secrets.rules). Any change to the retrieval contract above must also update that file.

## Cursor mirror

Cursor projects with this repo open will also see [`.cursor/rules/secrets.mdc`](../../.cursor/rules/secrets.mdc), which carries the same rule with Cursor `alwaysApply` frontmatter so the rule is loaded into every Cursor session.
