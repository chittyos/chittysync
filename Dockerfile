# ChittySync Engine - Dockerfile (Node 20 LTS)
FROM node:20-alpine

WORKDIR /app

# Enable pnpm via Corepack and pin version to match repo
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Install dependencies and build
COPY . .
RUN pnpm install && pnpm --filter @chittyos/engine build

# Runtime
ENV NODE_ENV=production
EXPOSE 3000

# Expect at runtime:
# - ENGINE_PUBKEY_HEX: hex-encoded ed25519 public key for build manifest verification
# - DATABASE_URL: Postgres connection string (e.g., Neon serverless URL)
# - PORT: optional, defaults to 3000
CMD ["node", "packages/engine/dist/server.js"]
