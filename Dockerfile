# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json ./packages/server/

# The website is the other workspace member and has no business in a server image.
RUN pnpm install --frozen-lockfile --filter @openmeet/server

COPY packages/server/ ./packages/server/

RUN pnpm --filter @openmeet/server build

# Prune dev dependencies
RUN CI=true pnpm prune --prod

# Stage 2: Production
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Marks the container unhealthy if the HTTP server stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3001/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
