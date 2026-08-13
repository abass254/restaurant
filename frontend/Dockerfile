# syntax=docker/dockerfile:1.7

# DukAI Next.js frontend.
# Listens on port 7070 inside the container.
# Server-side rewrites in next.config.ts proxy /api, /auth, /sanctum,
# /webhooks, /mpesa and /uploads to ${BACKEND_URL} (default
# http://backend:7071 under docker compose).

###############################################################################
# 1. Install dependencies (cached layer)
###############################################################################
FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

###############################################################################
# 2. Build the production bundle
###############################################################################
FROM node:20-bookworm-slim AS builder
WORKDIR /app

ARG BACKEND_URL=http://backend:7071
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    BACKEND_URL=${BACKEND_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

###############################################################################
# 3. Minimal runtime image
###############################################################################
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=7070 \
    HOSTNAME=0.0.0.0 \
    BACKEND_URL=http://backend:7071

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nextjs

# Copy only the artifacts needed to run `next start`.
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/loadRootEnv.ts ./loadRootEnv.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/next-env.d.ts ./next-env.d.ts

USER nextjs

EXPOSE 7070

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/" || exit 1

CMD ["npx", "next", "start", "-p", "7070", "-H", "0.0.0.0"]
