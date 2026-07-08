# syntax=docker/dockerfile:1

# --- Build-Stage: TypeScript -> dist/ (tsc). Die App hat KEINE Runtime-Dependencies
#     (nur Node-Builtins), daher wird im Runtime-Image kein node_modules benötigt. ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# --- Runtime-Stage: schlank, ohne node_modules ---
FROM node:22-slim
WORKDIR /app
# Server ohne interaktive TUI; fester Port für den Reverse-Proxy.
ENV PORT=8000 \
    HEADLESS=1 \
    NODE_ENV=production
# Kompilierten Server + statische Web-Dateien übernehmen.
COPY --from=build /app/dist ./dist
COPY public ./public
# Hinweis: data/ wird zur Laufzeit ins Volume /app/data geschrieben (siehe docker-compose.yml);
# beim allerersten Start lädt die App die ISR-Daten selbst vom DB-WFS.
EXPOSE 8000
CMD ["node", "dist/main.js"]
