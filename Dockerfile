# ── Stage 1: build the frontend ───────────────────────────────────────────────
# web/ is a Vite build, so the image cannot serve a single page without it.
# It runs in its own stage so Vite, React and TypeScript never reach the
# runtime image.
FROM node:22-bookworm-slim AS web

# This stage installs dev dependencies too, which pulls puppeteer in. Without
# this it would download a Chromium the build stage never runs.
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY web ./web
RUN npm run build:web


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates dumb-init fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node assets ./assets
COPY --chown=node:node knowledge ./knowledge
COPY --chown=node:node db ./db
COPY --from=web --chown=node:node /build/dist ./dist

RUN install -d -o node -g node /data/whatsapp /data/mcp

USER node

EXPOSE 4100 4200

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
