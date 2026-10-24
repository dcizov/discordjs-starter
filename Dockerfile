# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS manifests
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json

FROM manifests AS deps
RUN npm ci --no-audit --no-fund

FROM deps AS dev
COPY . .
# Seed writable named volumes before the development bind mount hides /app.
RUN mkdir -p .data apps/web/.next && chown -R node:node /app
USER node
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm","run","dev"]

FROM deps AS builder
COPY . .
ENV DEMO_MODE=true
RUN npm run build

FROM manifests AS production-deps
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=manifests --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=manifests --chown=node:node /app/apps ./apps
COPY --from=manifests --chown=node:node /app/packages ./packages
COPY --from=builder --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /app/apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
CMD ["npm","start"]
