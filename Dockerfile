ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-trixie-slim AS base
WORKDIR /app

ENV HUSKY=0

COPY package.json package-lock.json ./

FROM base AS deps
RUN npm ci

FROM deps AS dev
ENV NODE_ENV=development

COPY tsconfig.json ./
COPY src ./src

USER node
CMD ["npm", "run", "dev"]

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-trixie-slim AS runtime
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

CMD ["dumb-init", "node", "dist/index.js"]
