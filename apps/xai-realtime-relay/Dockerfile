FROM node:22-slim
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @top-performer/xai-realtime-relay build
CMD ["corepack", "pnpm", "--filter", "@top-performer/xai-realtime-relay", "start"]
