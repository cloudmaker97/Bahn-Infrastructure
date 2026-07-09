# syntax=docker/dockerfile:1

# --- Build-Stage: Server (tsc -> dist/) + Web (Next.js -> web/out/). Der Server hat
#     KEINE Runtime-Dependencies (nur Node-Builtins); Next wird nur zum Bauen gebraucht. ---
FROM node:22-slim AS build
WORKDIR /app
# Abhängigkeiten zuerst (Docker-Layer-Cache): Server + Web getrennt.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
# Quellen und bauen (web importiert src/shared -> beide Quellbäume nötig).
COPY src ./src
COPY web ./web
RUN npm run build

# --- Runtime-Stage: schlank, ohne node_modules ---
FROM node:22-slim
WORKDIR /app
# Server ohne interaktive TUI; fester Port für den Reverse-Proxy.
ENV PORT=8000 \
    HEADLESS=1 \
    NODE_ENV=production
# Kompilierter Server + statischer Next-Export.
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/out ./web/out
# package.json für die Basis-Versionsanzeige (kein .git im Image -> ggf. APP_VERSION setzen).
COPY package.json ./
# Hinweis: data/ wird zur Laufzeit ins Volume /app/data geschrieben (siehe docker-compose.yml);
# beim allerersten Start lädt die App die ISR-Daten selbst vom DB-WFS.
EXPOSE 8000
CMD ["node", "dist/main.js"]
