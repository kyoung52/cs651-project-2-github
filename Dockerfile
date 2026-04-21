# Roomify — single-container image for Google Cloud Run.
#
# Build locally:   docker build -t roomify .
# Run locally:     docker run -p 8080:8080 --env-file .env roomify

# ---------- Stage 1: build the SPA + server deps ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install client deps (with devDeps for esbuild)
COPY client/package*.json ./client/
RUN cd client && npm ci --no-audit --no-fund

# Install server runtime deps only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund

# Copy source
COPY client ./client
COPY server ./server

# Build the SPA directly into server/public/ via esbuild.
# client/.env.production is honored; overrides via
# --set-build-env-vars "APP_FOO=..." are merged on top.
RUN node client/build.mjs

# ---------- Stage 2: slim runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

# Only the server (includes the built SPA in server/public/)
COPY --from=builder /app/server ./server

# Drop root
RUN addgroup -S roomify && adduser -S roomify -G roomify \
  && chown -R roomify:roomify /app
USER roomify

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8080}/api/health || exit 1

WORKDIR /app/server
CMD ["node", "server.js"]
