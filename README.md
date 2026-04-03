# Top Performer Roleplay MVP

派遣営業トップパフォーマーのオーダーヒアリングを、`transcript -> playbook -> scenario -> roleplay -> scorecard` の流れで再現する monorepo です。

## Stack

- Frontend: Next.js 16 / React 19 / TypeScript / Tailwind CSS 4
- Hosting: Firebase App Hosting
- Data: Firestore
- Queue: Cloud Tasks
- Voice / Avatar: ElevenLabs Agents + LiveAvatar + LiveKit client
- Mining / Scoring: OpenAI Responses API + strict structured outputs
- Tooling: pnpm workspace + Turborepo + Vitest + Playwright

## Workspace

```text
apps/web
packages/domain
packages/firestore
packages/vendors
packages/scenario-engine
packages/scoring
scripts
data
docs
```

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy env sample and fill secrets:

```bash
cp .env.local.example .env.local
```

3. Bootstrap vendor connectivity and runtime settings:

```bash
pnpm bootstrap:vendors
```

Acceptance の前に不足入力だけを確認したい場合:

```bash
pnpm verify:acceptance -- --preflight
```

4. Start local app:

```bash
pnpm dev
```

## Core Scripts

```bash
pnpm import:transcripts
pnpm build:playbooks
pnpm compile:scenarios
pnpm publish:scenario --scenario staffing_order_hearing_busy_manager_medium
pnpm smoke:eleven
pnpm smoke:liveavatar
pnpm verify:acceptance
```

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Notes

- Admin pages and `/api/admin/*` are protected by basic auth via `proxy.ts`.
- Runtime settings are stored in Firestore at `/settings/runtime`.
- Session transcripts are stored in `/sessions/{sessionId}/turns/*`, scorecards in `/sessions/{sessionId}/artifacts/scorecard`.
- `ENABLE_ELEVEN_WEBHOOKS=false` keeps Eleven webhook endpoints optional and out of the critical path.
- `pnpm bootstrap:vendors` is idempotent by default. If `/settings/runtime.liveAvatarElevenSecretId` already exists, it is reused unless `--refresh-secret` is passed.
- `pnpm smoke:eleven -- --preflight`, `pnpm smoke:liveavatar -- --preflight`, and `pnpm verify:acceptance -- --preflight` print the exact required input block before touching vendor APIs.
- `pnpm verify:acceptance` is the canonical acceptance entrypoint. When `APP_BASE_URL` is local, it can start the local web app and directly deliver `/api/internal/analyze-session` after queue enqueue so the scorecard path can still be verified.

詳細は [docs/IMPLEMENTATION.md](/C:/AI_RPG/docs/IMPLEMENTATION.md)、[docs/OPERATIONS.md](/C:/AI_RPG/docs/OPERATIONS.md)、[docs/DELIVERY_STATUS.md](/C:/AI_RPG/docs/DELIVERY_STATUS.md)、[docs/PROMPTS.md](/C:/AI_RPG/docs/PROMPTS.md) を参照してください。
