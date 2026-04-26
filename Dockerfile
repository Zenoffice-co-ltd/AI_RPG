FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/firestore/package.json packages/firestore/package.json
COPY packages/vendors/package.json packages/vendors/package.json
COPY packages/scenario-engine/package.json packages/scenario-engine/package.json
COPY packages/scoring/package.json packages/scoring/package.json
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=deps /app/packages/firestore/node_modules ./packages/firestore/node_modules
COPY --from=deps /app/packages/vendors/node_modules ./packages/vendors/node_modules
COPY --from=deps /app/packages/scenario-engine/node_modules ./packages/scenario-engine/node_modules
COPY --from=deps /app/packages/scoring/node_modules ./packages/scoring/node_modules
COPY . .
RUN pnpm --filter @top-performer/web build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
