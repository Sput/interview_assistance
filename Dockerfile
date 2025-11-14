# Multi-stage Dockerfile for Next.js 15 (standalone output)

# --- Build stage ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .

# Disable Sentry at build unless explicitly enabled via --build-arg
ARG NEXT_PUBLIC_SENTRY_DISABLED=true
ENV NEXT_PUBLIC_SENTRY_DISABLED=$NEXT_PUBLIC_SENTRY_DISABLED

# Build Next app (produces .next/standalone)
RUN npm run build

# --- Runtime stage ---
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Use non-root user for security
USER node

# Copy standalone server and static assets
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]

