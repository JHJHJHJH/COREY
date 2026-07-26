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

# Install locally (not -g) so prisma.config.ts's `import "prisma/config"` and
# `import "dotenv/config"` resolve from /app/node_modules; `npx prisma` picks up
# the local binary.
RUN npm install --no-audit --no-fund prisma@7.8.0 dotenv

COPY prisma.config.ts ./
COPY prisma ./prisma

CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts source.config.ts tsconfig.json ./
COPY content ./content
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
RUN npm install --no-audit --no-fund prisma@7.8.0 dotenv
# Copy Prisma schema, migrations, and config for pre-deploy command
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./prisma.config.ts

COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/public ./public

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]

FROM node:22-slim AS mcp-runner

ENV NODE_ENV=production
ENV COREY_MCP_BIND=0.0.0.0
ENV COREY_MCP_PORT=4001

WORKDIR /app

# The MCP bundle contains its protocol/runtime dependencies. web-ifc stays
# external so its adjacent Node WASM asset remains discoverable at runtime.
COPY --chown=node:node --from=builder /app/dist/mcp ./dist/mcp
COPY --chown=node:node --from=builder /app/node_modules/web-ifc ./node_modules/web-ifc

USER node

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.COREY_MCP_PORT || 4001) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/mcp/corey-mcp.cjs"]
