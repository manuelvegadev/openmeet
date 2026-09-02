# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/terminal/package.json ./packages/terminal/

# Install only what the server needs (skips the terminal's native WebRTC build)
RUN pnpm install --frozen-lockfile --filter "@openmeet/server..."

# Copy source
COPY packages/shared/ ./packages/shared/
COPY packages/server/ ./packages/server/

# Build in order: shared -> server
RUN pnpm --filter @openmeet/shared build
RUN pnpm --filter @openmeet/server build

# Prune dev dependencies
RUN CI=true pnpm prune --prod

# Stage 2: Production
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "packages/server/dist/index.js"]
