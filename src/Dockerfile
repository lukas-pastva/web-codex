# --- Shared build deps ---
FROM node:20-alpine AS build-base
RUN apk add --no-cache bash git g++ make python3 linux-headers

# --- Build frontend ---
FROM build-base AS fe
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* frontend/ .
RUN npm ci || npm i
COPY frontend/ .
RUN npm run build

# --- Build backend ---
FROM build-base AS be
WORKDIR /app
COPY backend/package.json backend/package-lock.json* backend/ .
RUN npm ci || npm i
COPY backend/ ./backend
# Bring built FE into backend/dist/frontend
COPY --from=fe /app/dist ./frontend/dist
RUN npm --prefix backend run build

# --- Runtime ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Build deps for node-pty; shell tools; optional git
RUN apk add --no-cache bash git g++ make python3 linux-headers
# Optional: install Codex CLI if available in your registry
# If your Codex CLI package name differs, set CODEX_CMD accordingly
RUN npm i -g @openai/codex || true
COPY --from=be /app/backend/dist ./backend/dist
COPY backend/package.json backend/package-lock.json* ./backend/
RUN npm --prefix backend ci --omit=dev || npm --prefix backend i --omit=dev
# Data directory for repos
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
