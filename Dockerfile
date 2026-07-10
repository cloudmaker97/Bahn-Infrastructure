# syntax=docker/dockerfile:1

# --- Build stage: server (tsc -> dist/) + web (Next.js -> web/out/). The server
#     has NO runtime dependencies (Node builtins only); Next is build-time only. ---
FROM node:22-slim AS build
WORKDIR /app
# Dependencies first (Docker layer cache): server + web separately.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
# Sources and build (web imports src/shared -> both source trees are needed).
COPY src ./src
COPY web ./web
RUN npm run build

# --- Runtime stage: slim, without node_modules ---
FROM node:22-slim
WORKDIR /app
# Server without the interactive TUI; fixed port for the reverse proxy.
ENV PORT=8000 \
    HEADLESS=1 \
    NODE_ENV=production
# Compiled server + static Next export.
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/out ./web/out
# package.json for the base version display (no .git in the image -> set APP_VERSION if needed).
COPY package.json ./
# Note: data/ is written into the /app/data volume at runtime (see docker-compose.yml);
# on the very first start the app loads the ISR data from the DB WFS itself.
EXPOSE 8000
CMD ["node", "dist/main.js"]
