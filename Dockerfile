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

RUN install -d -o node -g node /data/whatsapp /data/mcp

USER node

EXPOSE 4100 4200

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
