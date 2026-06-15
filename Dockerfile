# syntax=docker/dockerfile:1.7

FROM node:22-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.32.1 --activate

FROM base AS tools

RUN npm install --no-audit --no-fund prisma@7.8.0 dotenv

COPY prisma.config.ts ./
COPY prisma ./prisma

CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma

RUN mkdir -p src && pnpm install --frozen-lockfile

FROM deps AS builder

COPY . .

# Next imports API route modules during build; Prisma only needs a parseable URL here.
ENV DATABASE_URL=postgresql://docker-build:docker-build@localhost:5432/docker-build?schema=public

RUN pnpm prisma generate
RUN pnpm build

FROM node:22-slim AS runner

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/public ./public

USER node

EXPOSE 4000

CMD ["node", "server.js"]
