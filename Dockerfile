# syntax=docker/dockerfile:1.7

# ── builder ───────────────────────────────────────────────────────────────────
FROM node:25-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# Tests + lint + typecheck run in CI (.github/workflows/ci.yml) — the Docker
# build trusts that and just compiles.
RUN npm run build
RUN npm prune --omit=dev

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:25-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as non-root.
RUN addgroup -S app && adduser -S app -G app
USER app

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./

EXPOSE 3000

# Make sure your orchestrator's grace period is >= SHUTDOWN_TIMEOUT_MS (default 30s).
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
